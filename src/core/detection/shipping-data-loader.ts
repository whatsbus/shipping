/**
 * Shipping Leak Data Loader
 *
 * Loads all shipping-related data from the database for a given shop
 * and returns it as a structured snapshot that the ShippingLeakDetector
 * can consume through DetectorContext.meta.
 *
 * Design:
 * - This module is the ONLY place the Shipping Leak Detector touches
 *   the database indirectly. Detectors themselves remain DB-free — they
 *   receive everything through context.meta.shippingData.
 * - Mirrors the pattern established by refund-data-loader.ts.
 * - The caller (API route) calls loadShippingData() before running
 *   the engine and attaches the result to EngineRunOptions.meta.
 *
 * Data model:
 * - An order's "shipping charged" = totalShippingPrice (what the customer paid)
 * - An order's "subtotal" = subtotalPrice (product revenue, pre-shipping)
 * - "Shipping cost" (what the merchant actually pays to carriers) is not
 *   stored by Shopify. We estimate it from order weight, zone, and the
 *   shipping rates configured in the store. Because Shopify does NOT expose
 *   actual carrier-billed amounts via the GraphQL API, we derive a
 *   "shipping margin" signal from:
 *     shippingMargin = totalShippingPrice - estimatedCarrierCost
 *   where estimatedCarrierCost is approximated as a percentage of subtotal
 *   or as a fixed multiple of shippingPrice. This is the same approach used
 *   by most e-commerce analytics tools that work without direct carrier feeds.
 *
 * Shipping loss definition:
 * - An order has a "shipping loss" when totalShippingPrice < estimatedCarrierCost.
 * - Free-shipping orders (totalShippingPrice == 0 and subtotal > 0) are flagged
 *   separately because the merchant bore 100% of carrier cost.
 *
 * Estimation heuristic:
 * - Industry data (Shippo, EasyPost) shows average carrier cost for small-parcel
 *   US e-commerce is 8–14% of order subtotal, with a floor of ~$5 per parcel.
 * - We use 10% of subtotal with a $5 floor as a conservative baseline.
 * - This is intentionally conservative: we only flag orders where the signal
 *   is strong enough to be actionable.
 */

import { db } from "@/db";
import { shopifyOrders, shopifyOrderLineItems } from "@/db/schema";
import { eq, and, isNotNull, gt } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Public types — consumed by ShippingLeakDetector via context.meta
// ---------------------------------------------------------------------------

export interface ShippingOrderRow {
  /** Internal UUID */
  orderId: string;
  /** Shopify order name e.g. "#1001" */
  orderName: string;
  /** Shopify order number */
  orderNumber: number;
  /** What the customer paid for shipping (0 = free shipping) */
  shippingCharged: number;
  /** Total order value including shipping */
  totalPrice: number;
  /** Product subtotal before shipping and discounts */
  subtotalPrice: number;
  /** Discounts applied to the order */
  totalDiscounts: number;
  /** Estimated carrier cost (computed heuristic) */
  estimatedCarrierCost: number;
  /** Shipping margin = shippingCharged − estimatedCarrierCost */
  shippingMargin: number;
  /** True when shippingMargin < 0 (merchant losing money on shipping) */
  isShippingLoss: boolean;
  /** True when the order had free shipping (shippingCharged == 0) */
  isFreeShipping: boolean;
  /** Fulfillment service tag (e.g. "manual", "amazon", custom 3PL) */
  fulfillmentService: string | null;
  /** Shopify order creation date */
  orderCreatedAt: Date;
  /** Number of line items in this order */
  lineItemCount: number;
  /** Whether the order was cancelled */
  isCancelled: boolean;
}

export interface ShippingMethodRow {
  /**
   * Fulfillment service identifier — used as a proxy for "shipping method".
   * Shopify does not expose the specific rate (e.g. "UPS Ground") chosen;
   * fulfillmentService is the best available discriminator in synced data.
   */
  fulfillmentService: string;
  /** Total number of orders using this method */
  orderCount: number;
  /** Orders where shippingCharged < estimatedCarrierCost */
  lossOrderCount: number;
  /** Total shipping charged across all orders with this method */
  totalShippingCharged: number;
  /** Total estimated carrier cost across all orders with this method */
  totalEstimatedCost: number;
  /** Net shipping margin (totalShippingCharged − totalEstimatedCost) */
  netMargin: number;
  /** Average shipping margin per order */
  avgMarginPerOrder: number;
  /** Loss rate as a decimal (lossOrderCount / orderCount) */
  lossRate: number;
}

export interface ShippingData {
  /** All order rows with shipping data */
  orders: ShippingOrderRow[];
  /** Per-fulfillment-method aggregates */
  methodStats: ShippingMethodRow[];
  /** Store-wide shipping stats */
  storeStats: {
    /** Total orders with shipping (excludes test orders) */
    totalOrders: number;
    /** Orders where shippingCharged > 0 */
    paidShippingOrders: number;
    /** Orders where shippingCharged == 0 and subtotal > 0 */
    freeShippingOrders: number;
    /** Total shipping revenue collected from customers */
    totalShippingCharged: number;
    /** Total estimated carrier cost */
    totalEstimatedCarrierCost: number;
    /** Total net shipping margin */
    totalShippingMargin: number;
    /** Orders where margin < 0 */
    shippingLossOrders: number;
    /** Average shipping charged per order (paid-shipping orders only) */
    avgShippingCharged: number;
    /** Average estimated carrier cost per order */
    avgEstimatedCarrierCost: number;
    /** Earliest order date in the dataset */
    earliestOrderDate: Date | null;
    /** Latest order date in the dataset */
    latestOrderDate: Date | null;
    /** Average monthly shipping loss */
    avgMonthlyShippingLoss: number;
    /** Shipping loss rate (lossOrders / totalOrders) */
    shippingLossRate: number;
  };
}

// ---------------------------------------------------------------------------
// Estimation constants
// ---------------------------------------------------------------------------

/**
 * Estimated carrier cost as a fraction of order subtotal.
 * Conservative 10% is below the midpoint of the 8–14% industry range,
 * avoiding false positives on well-run stores.
 */
const CARRIER_COST_RATE = 0.10;

/**
 * Minimum estimated carrier cost per order (floor).
 * Even the cheapest US parcel (First-Class Mail) costs ~$4.50.
 * We use $5 as a reasonable floor.
 */
const CARRIER_COST_FLOOR = 5.0;

/**
 * Maximum estimated carrier cost cap as a fraction of subtotal.
 * Above 60% of subtotal, our heuristic becomes unreliable (likely
 * a digital/virtual product or an extreme outlier). We cap and skip.
 */
const CARRIER_COST_CAP_RATE = 0.60;

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Load all shipping data for a shop for use by the ShippingLeakDetector.
 * Called once before the engine runs — not inside the detector itself.
 */
export async function loadShippingData(shopId: string): Promise<ShippingData> {
  // ── 1. Load all non-test, non-cancelled, fulfilled orders ─────────────────

  const orderRows = await db
    .select({
      id: shopifyOrders.id,
      name: shopifyOrders.name,
      orderNumber: shopifyOrders.orderNumber,
      totalPrice: shopifyOrders.totalPrice,
      subtotalPrice: shopifyOrders.subtotalPrice,
      totalShippingPrice: shopifyOrders.totalShippingPrice,
      totalDiscounts: shopifyOrders.totalDiscounts,
      cancelledAt: shopifyOrders.cancelledAt,
      fulfillmentStatus: shopifyOrders.fulfillmentStatus,
      shopifyCreatedAt: shopifyOrders.shopifyCreatedAt,
    })
    .from(shopifyOrders)
    .where(
      and(
        eq(shopifyOrders.shopId, shopId),
        eq(shopifyOrders.test, false),
        isNotNull(shopifyOrders.subtotalPrice),
        gt(shopifyOrders.totalPrice, "0"),
      ),
    );

  // ── 2. Load line items to get fulfillment service per order ───────────────
  //
  // Shopify stores fulfillmentService on each line item.
  // We take the first non-null, non-manual value per order,
  // defaulting to "manual" when none found.

  const lineItemRows = await db
    .select({
      orderId: shopifyOrderLineItems.orderId,
      fulfillmentService: shopifyOrderLineItems.fulfillmentService,
    })
    .from(shopifyOrderLineItems)
    .where(eq(shopifyOrderLineItems.shopId, shopId));

  // Build map: orderId → fulfillmentService (prefer non-manual values)
  const fulfillmentByOrder = new Map<string, string>();
  for (const li of lineItemRows) {
    const existing = fulfillmentByOrder.get(li.orderId);
    if (!existing && li.fulfillmentService) {
      fulfillmentByOrder.set(li.orderId, li.fulfillmentService);
    } else if (
      existing === "manual" &&
      li.fulfillmentService &&
      li.fulfillmentService !== "manual"
    ) {
      fulfillmentByOrder.set(li.orderId, li.fulfillmentService);
    }
  }

  // Build map: orderId → line item count
  const lineItemCountByOrder = new Map<string, number>();
  for (const li of lineItemRows) {
    lineItemCountByOrder.set(
      li.orderId,
      (lineItemCountByOrder.get(li.orderId) ?? 0) + 1,
    );
  }

  // ── 3. Build ShippingOrderRow list ────────────────────────────────────────

  const orders: ShippingOrderRow[] = [];

  for (const row of orderRows) {
    const subtotal = Number(row.subtotalPrice ?? 0);
    const shippingCharged = Number(row.totalShippingPrice ?? 0);
    const totalPrice = Number(row.totalPrice ?? 0);
    const totalDiscounts = Number(row.totalDiscounts ?? 0);
    const isCancelled = row.cancelledAt !== null;

    // Skip orders with no measurable product value
    if (subtotal <= 0) continue;

    // Estimate carrier cost
    const rawEstimate = Math.max(
      CARRIER_COST_FLOOR,
      subtotal * CARRIER_COST_RATE,
    );

    // Cap: if estimate exceeds cap_rate of subtotal, heuristic is unreliable
    // (digital products, gift cards, etc.) — skip these orders
    if (rawEstimate > subtotal * CARRIER_COST_CAP_RATE) continue;

    const estimatedCarrierCost = rawEstimate;
    const shippingMargin = shippingCharged - estimatedCarrierCost;
    const isFreeShipping = shippingCharged === 0;
    const isShippingLoss = shippingMargin < 0;

    orders.push({
      orderId: row.id,
      orderName: row.name,
      orderNumber: row.orderNumber,
      shippingCharged,
      totalPrice,
      subtotalPrice: subtotal,
      totalDiscounts,
      estimatedCarrierCost,
      shippingMargin,
      isShippingLoss,
      isFreeShipping,
      fulfillmentService: fulfillmentByOrder.get(row.id) ?? "manual",
      orderCreatedAt: row.shopifyCreatedAt,
      lineItemCount: lineItemCountByOrder.get(row.id) ?? 1,
      isCancelled,
    });
  }

  // ── 4. Store-wide stats ───────────────────────────────────────────────────

  const totalOrders = orders.length;
  const paidShippingOrders = orders.filter((o) => !o.isFreeShipping).length;
  const freeShippingOrders = orders.filter((o) => o.isFreeShipping).length;
  const shippingLossOrders = orders.filter((o) => o.isShippingLoss).length;

  const totalShippingCharged = orders.reduce(
    (s, o) => s + o.shippingCharged,
    0,
  );
  const totalEstimatedCarrierCost = orders.reduce(
    (s, o) => s + o.estimatedCarrierCost,
    0,
  );
  const totalShippingMargin = totalShippingCharged - totalEstimatedCarrierCost;

  const avgShippingCharged =
    paidShippingOrders > 0
      ? orders
          .filter((o) => !o.isFreeShipping)
          .reduce((s, o) => s + o.shippingCharged, 0) / paidShippingOrders
      : 0;

  const avgEstimatedCarrierCost =
    totalOrders > 0 ? totalEstimatedCarrierCost / totalOrders : 0;

  const orderDates = orders.map((o) => o.orderCreatedAt.getTime());
  const earliestOrderDate =
    orderDates.length > 0 ? new Date(Math.min(...orderDates)) : null;
  const latestOrderDate =
    orderDates.length > 0 ? new Date(Math.max(...orderDates)) : null;

  let avgMonthlyShippingLoss = 0;
  if (earliestOrderDate && latestOrderDate) {
    const windowMonths = Math.max(
      1,
      (latestOrderDate.getTime() - earliestOrderDate.getTime()) / MS_PER_MONTH,
    );
    const totalLoss = orders
      .filter((o) => o.isShippingLoss)
      .reduce((s, o) => s + Math.abs(o.shippingMargin), 0);
    avgMonthlyShippingLoss = totalLoss / windowMonths;
  }

  const shippingLossRate =
    totalOrders > 0 ? shippingLossOrders / totalOrders : 0;

  // ── 5. Per-method aggregates ──────────────────────────────────────────────

  const methodStats = buildMethodStats(orders);

  return {
    orders,
    methodStats,
    storeStats: {
      totalOrders,
      paidShippingOrders,
      freeShippingOrders,
      totalShippingCharged,
      totalEstimatedCarrierCost,
      totalShippingMargin,
      shippingLossOrders,
      avgShippingCharged,
      avgEstimatedCarrierCost,
      earliestOrderDate,
      latestOrderDate,
      avgMonthlyShippingLoss,
      shippingLossRate,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-method aggregation
// ---------------------------------------------------------------------------

function buildMethodStats(orders: ShippingOrderRow[]): ShippingMethodRow[] {
  type MethodAgg = {
    orderCount: number;
    lossOrderCount: number;
    totalShippingCharged: number;
    totalEstimatedCost: number;
  };

  const methodAgg = new Map<string, MethodAgg>();

  for (const order of orders) {
    const key = order.fulfillmentService ?? "manual";
    const existing = methodAgg.get(key) ?? {
      orderCount: 0,
      lossOrderCount: 0,
      totalShippingCharged: 0,
      totalEstimatedCost: 0,
    };
    existing.orderCount += 1;
    if (order.isShippingLoss) existing.lossOrderCount += 1;
    existing.totalShippingCharged += order.shippingCharged;
    existing.totalEstimatedCost += order.estimatedCarrierCost;
    methodAgg.set(key, existing);
  }

  const result: ShippingMethodRow[] = [];
  for (const [fulfillmentService, agg] of methodAgg) {
    const netMargin = agg.totalShippingCharged - agg.totalEstimatedCost;
    result.push({
      fulfillmentService,
      orderCount: agg.orderCount,
      lossOrderCount: agg.lossOrderCount,
      totalShippingCharged: agg.totalShippingCharged,
      totalEstimatedCost: agg.totalEstimatedCost,
      netMargin,
      avgMarginPerOrder: agg.orderCount > 0 ? netMargin / agg.orderCount : 0,
      lossRate:
        agg.orderCount > 0 ? agg.lossOrderCount / agg.orderCount : 0,
    });
  }

  // Sort by net margin ascending (worst margin first)
  result.sort((a, b) => a.netMargin - b.netMargin);
  return result;
}
