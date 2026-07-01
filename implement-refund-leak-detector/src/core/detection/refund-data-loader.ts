/**
 * Refund Leak Data Loader
 *
 * Loads all refund-related data from the database for a given shop
 * and returns it as a structured snapshot that the RefundLeakDetector
 * can consume through DetectorContext.meta.
 *
 * Design: This module is the ONLY place the Refund Leak Detector touches
 * the database indirectly. Detectors themselves remain DB-free — they
 * receive everything through context.meta.refundData.
 *
 * The caller (API route or engine wrapper) calls loadRefundData() before
 * running the engine and attaches the result to EngineRunOptions.meta.
 */

import { db } from "@/db";
import {
  shopifyOrders,
  shopifyRefunds,
  shopifyOrderLineItems,
  shopifyCustomers,
} from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Public types — consumed by RefundLeakDetector via context.meta
// ---------------------------------------------------------------------------

export interface RefundOrderRow {
  /** Internal UUID of the order */
  orderId: string;
  /** Shopify order name e.g. "#1001" */
  orderName: string;
  /** Shopify order number */
  orderNumber: number;
  /** Internal UUID of the refund */
  refundId: string;
  /** Total amount refunded in this refund event */
  totalRefunded: number;
  /** Order total price */
  orderTotal: number;
  /** Shopify customer ID (numeric string) — null for guest orders */
  shopifyCustomerId: string | null;
  /** Customer email for display */
  customerEmail: string | null;
  /** Customer first name */
  customerFirstName: string | null;
  /** Customer last name */
  customerLastName: string | null;
  /** When this refund was created in Shopify */
  refundCreatedAt: Date;
  /** When the original order was created */
  orderCreatedAt: Date;
  /** Refund note */
  refundNote: string | null;
  /** Whether items were restocked */
  restock: boolean;
  /**
   * Line items involved in this refund.
   * lineItemId is the Shopify ID (numeric string) of the order line item.
   */
  refundLineItems: Array<{
    lineItemId: string;
    quantity: number;
    restockType: string;
    subtotal: string;
    totalTax: string;
  }>;
}

export interface RefundProductRow {
  /** Shopify product ID */
  shopifyProductId: string | null;
  /** Product title from line item */
  productTitle: string;
  /** SKU */
  sku: string | null;
  /** Number of distinct orders refunded for this product */
  refundCount: number;
  /** Total refunded amount across all refunds for this product */
  totalRefunded: number;
  /** Total distinct orders containing this product */
  totalOrders: number;
  /** Refund rate as a decimal (0.0–1.0) */
  refundRate: number;
}

export interface RefundCustomerRow {
  /** Shopify customer ID (numeric string) */
  shopifyCustomerId: string;
  /** Customer email */
  email: string | null;
  /** First name */
  firstName: string | null;
  /** Last name */
  lastName: string | null;
  /** Number of distinct orders refunded for this customer */
  refundCount: number;
  /** Total refunded amount */
  totalRefunded: number;
  /** Total distinct orders by this customer */
  totalOrders: number;
}

export interface RefundData {
  /** All refund rows joined with order data */
  refunds: RefundOrderRow[];
  /** Per-product refund aggregates */
  productRefunds: RefundProductRow[];
  /** Per-customer refund aggregates */
  customerRefunds: RefundCustomerRow[];
  /** Store-wide stats */
  storeStats: {
    totalOrders: number;
    totalRefundedOrders: number;
    totalRefundAmount: number;
    overallRefundRate: number;
    avgRefundAmount: number;
    /** Average monthly refund amount (based on data window) */
    avgMonthlyRefundAmount: number;
    /** Date of earliest order in the dataset */
    earliestOrderDate: Date | null;
    /** Date of latest order in the dataset */
    latestOrderDate: Date | null;
  };
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

/**
 * Load all refund data for a shop for use by the RefundLeakDetector.
 * This is called once before the engine runs — not inside the detector.
 */
export async function loadRefundData(shopId: string): Promise<RefundData> {
  // ── 1. Load all orders (non-test) ─────────────────────────────────────────

  const allOrderRows = await db
    .select({
      id: shopifyOrders.id,
      name: shopifyOrders.name,
      orderNumber: shopifyOrders.orderNumber,
      totalPrice: shopifyOrders.totalPrice,
      shopifyCustomerId: shopifyOrders.shopifyCustomerId,
      email: shopifyOrders.email,
      shopifyCreatedAt: shopifyOrders.shopifyCreatedAt,
    })
    .from(shopifyOrders)
    .where(and(eq(shopifyOrders.shopId, shopId), eq(shopifyOrders.test, false)));

  const totalOrders = allOrderRows.length;

  // Build order lookup by id
  const orderById = new Map(allOrderRows.map((o) => [o.id, o]));

  // ── 2. Load all refunds ────────────────────────────────────────────────────

  const refundRows = await db
    .select({
      id: shopifyRefunds.id,
      orderId: shopifyRefunds.orderId,
      totalRefunded: shopifyRefunds.totalRefunded,
      shopifyCreatedAt: shopifyRefunds.shopifyCreatedAt,
      note: shopifyRefunds.note,
      restock: shopifyRefunds.restock,
      refundLineItems: shopifyRefunds.refundLineItems,
    })
    .from(shopifyRefunds)
    .where(
      and(
        eq(shopifyRefunds.shopId, shopId),
        isNotNull(shopifyRefunds.totalRefunded),
      ),
    );

  // ── 3. Load customers for name enrichment ─────────────────────────────────

  const customerRows = await db
    .select({
      shopifyId: shopifyCustomers.shopifyId,
      firstName: shopifyCustomers.firstName,
      lastName: shopifyCustomers.lastName,
      email: shopifyCustomers.email,
    })
    .from(shopifyCustomers)
    .where(eq(shopifyCustomers.shopId, shopId));

  const customerMap = new Map(customerRows.map((c) => [c.shopifyId, c]));

  // ── 4. Build RefundOrderRow list ───────────────────────────────────────────

  const refunds: RefundOrderRow[] = [];

  for (const row of refundRows) {
    const order = orderById.get(row.orderId);
    if (!order) continue; // refund for an order that was filtered (test order, etc.)

    const customer = order.shopifyCustomerId
      ? customerMap.get(order.shopifyCustomerId)
      : undefined;

    refunds.push({
      orderId: row.orderId,
      orderName: order.name,
      orderNumber: order.orderNumber,
      orderTotal: Number(order.totalPrice ?? 0),
      shopifyCustomerId: order.shopifyCustomerId,
      customerEmail: customer?.email ?? order.email,
      customerFirstName: customer?.firstName ?? null,
      customerLastName: customer?.lastName ?? null,
      orderCreatedAt: order.shopifyCreatedAt,
      refundId: row.id,
      totalRefunded: Number(row.totalRefunded ?? 0),
      refundCreatedAt: row.shopifyCreatedAt,
      refundNote: row.note,
      restock: row.restock,
      refundLineItems: (row.refundLineItems as RefundOrderRow["refundLineItems"]) ?? [],
    });
  }

  // ── 5. Store-wide stats ────────────────────────────────────────────────────

  const ordersWithRefunds = new Set(refunds.map((r) => r.orderId));
  const totalRefundedOrders = ordersWithRefunds.size;
  const totalRefundAmount = refunds.reduce((sum, r) => sum + r.totalRefunded, 0);
  const overallRefundRate = totalOrders > 0 ? totalRefundedOrders / totalOrders : 0;
  const avgRefundAmount = refunds.length > 0 ? totalRefundAmount / refunds.length : 0;

  const orderDates = allOrderRows.map((o) => o.shopifyCreatedAt.getTime());
  const earliestOrderDate =
    orderDates.length > 0 ? new Date(Math.min(...orderDates)) : null;
  const latestOrderDate =
    orderDates.length > 0 ? new Date(Math.max(...orderDates)) : null;

  let avgMonthlyRefundAmount = 0;
  if (earliestOrderDate && latestOrderDate) {
    const windowMonths = Math.max(
      1,
      (latestOrderDate.getTime() - earliestOrderDate.getTime()) / MS_PER_MONTH,
    );
    avgMonthlyRefundAmount = totalRefundAmount / windowMonths;
  }

  // ── 6. Per-product refund aggregates ──────────────────────────────────────

  const productRefunds = await buildProductRefunds(shopId, refunds, allOrderRows);

  // ── 7. Per-customer refund aggregates ─────────────────────────────────────

  const customerRefunds = buildCustomerRefunds(refunds, allOrderRows);

  return {
    refunds,
    productRefunds,
    customerRefunds,
    storeStats: {
      totalOrders,
      totalRefundedOrders,
      totalRefundAmount,
      overallRefundRate,
      avgRefundAmount,
      avgMonthlyRefundAmount,
      earliestOrderDate,
      latestOrderDate,
    },
  };
}

// ---------------------------------------------------------------------------
// Product-level aggregation
// ---------------------------------------------------------------------------

async function buildProductRefunds(
  shopId: string,
  refunds: RefundOrderRow[],
  allOrders: Array<{ id: string }>,
): Promise<RefundProductRow[]> {
  if (refunds.length === 0) return [];

  // Load all line items for this shop
  const allLineItems = await db
    .select({
      shopifyId: shopifyOrderLineItems.shopifyId,
      orderId: shopifyOrderLineItems.orderId,
      shopifyProductId: shopifyOrderLineItems.shopifyProductId,
      title: shopifyOrderLineItems.title,
      sku: shopifyOrderLineItems.sku,
    })
    .from(shopifyOrderLineItems)
    .where(eq(shopifyOrderLineItems.shopId, shopId));

  // Build map: shopify line item ID → line item
  const lineItemByShopifyId = new Map(
    allLineItems.map((li) => [li.shopifyId, li]),
  );

  // Build map: product key → { orderIds, refundedOrderIds, totalRefunded }
  type ProductAgg = {
    shopifyProductId: string | null;
    productTitle: string;
    sku: string | null;
    orderIds: Set<string>;
    refundedOrderIds: Set<string>;
    totalRefunded: number;
  };

  const productAgg = new Map<string, ProductAgg>();

  // First pass: build orderIds for every product from ALL line items
  for (const li of allLineItems) {
    const key = li.shopifyProductId ?? li.title;
    const existing = productAgg.get(key) ?? {
      shopifyProductId: li.shopifyProductId,
      productTitle: li.title,
      sku: li.sku,
      orderIds: new Set<string>(),
      refundedOrderIds: new Set<string>(),
      totalRefunded: 0,
    };
    existing.orderIds.add(li.orderId);
    productAgg.set(key, existing);
  }

  // Second pass: accumulate refunds
  for (const refund of refunds) {
    for (const rli of refund.refundLineItems) {
      const li = lineItemByShopifyId.get(rli.lineItemId);
      if (!li) continue;

      const key = li.shopifyProductId ?? li.title;
      const agg = productAgg.get(key);
      if (!agg) continue;

      agg.refundedOrderIds.add(refund.orderId);
      agg.totalRefunded += Number(rli.subtotal);
    }
  }

  const result: RefundProductRow[] = [];
  for (const [, agg] of productAgg) {
    if (agg.refundedOrderIds.size === 0) continue; // no refunds for this product
    result.push({
      shopifyProductId: agg.shopifyProductId,
      productTitle: agg.productTitle,
      sku: agg.sku,
      refundCount: agg.refundedOrderIds.size,
      totalRefunded: agg.totalRefunded,
      totalOrders: agg.orderIds.size,
      refundRate:
        agg.orderIds.size > 0
          ? agg.refundedOrderIds.size / agg.orderIds.size
          : 0,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Customer-level aggregation
// ---------------------------------------------------------------------------

function buildCustomerRefunds(
  refunds: RefundOrderRow[],
  allOrders: Array<{
    id: string;
    shopifyCustomerId: string | null;
  }>,
): RefundCustomerRow[] {
  // Count all orders per customer
  const allOrderCountByCustomer = new Map<string, number>();
  for (const order of allOrders) {
    if (!order.shopifyCustomerId) continue;
    allOrderCountByCustomer.set(
      order.shopifyCustomerId,
      (allOrderCountByCustomer.get(order.shopifyCustomerId) ?? 0) + 1,
    );
  }

  type CustomerAgg = {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    refundedOrderIds: Set<string>;
    totalRefunded: number;
  };

  const customerAgg = new Map<string, CustomerAgg>();

  for (const refund of refunds) {
    if (!refund.shopifyCustomerId) continue;
    const key = refund.shopifyCustomerId;
    const existing = customerAgg.get(key) ?? {
      email: refund.customerEmail,
      firstName: refund.customerFirstName,
      lastName: refund.customerLastName,
      refundedOrderIds: new Set<string>(),
      totalRefunded: 0,
    };
    existing.refundedOrderIds.add(refund.orderId);
    existing.totalRefunded += refund.totalRefunded;
    customerAgg.set(key, existing);
  }

  const result: RefundCustomerRow[] = [];
  for (const [shopifyCustomerId, agg] of customerAgg) {
    result.push({
      shopifyCustomerId,
      email: agg.email,
      firstName: agg.firstName,
      lastName: agg.lastName,
      refundCount: agg.refundedOrderIds.size,
      totalRefunded: agg.totalRefunded,
      totalOrders: allOrderCountByCustomer.get(shopifyCustomerId) ?? agg.refundedOrderIds.size,
    });
  }

  return result;
}
