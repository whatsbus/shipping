/**
 * Shopify Orders Sync Service
 *
 * Downloads all orders with their line items and embedded refunds from the
 * Shopify Admin GraphQL API, then upserts them into:
 *   - shopify_orders
 *   - shopify_order_line_items
 *   - shopify_refunds
 *
 * Refunds are fetched inline with orders (embedded in the order query)
 * to minimize API round-trips and reduce query cost consumption.
 *
 * Supports:
 * - Full sync (all orders)
 * - Incremental sync (orders updated since the last sync)
 * - Multi-tenant: all records scoped by shopId
 * - Idempotent: re-running is always safe (upsert on shopify_id)
 */

import { db } from "@/db";
import {
  shopifyOrders,
  shopifyOrderLineItems,
  shopifyRefunds,
  shopifyCustomers,
  shopifyProductVariants,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createGraphQLClient } from "@/lib/shopify/graphql-client";
import {
  ORDERS_QUERY,
  extractShopifyId,
  buildUpdatedAtQuery,
  type OrdersQueryResult,
  type ShopifyOrderNode,
  type ShopifyLineItemNode,
  type ShopifyRefundNode,
  type ShopifyAddress,
} from "./queries";
import {
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  incrementSyncLogCount,
  getLastSuccessfulSync,
} from "./sync-log-repository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Orders per GraphQL page. Keep at 10 because orders include nested
 * line items (up to 50) and refunds, making them high-cost queries. */
const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addressToRecord(
  address: ShopifyAddress | null,
): Record<string, string> | undefined {
  if (!address) return undefined;
  const record: Record<string, string> = {};
  for (const [k, v] of Object.entries(address)) {
    if (v !== null && v !== undefined) record[k] = String(v);
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

/**
 * Look up the internal DB id for a customer by shopify_customer_id.
 * Returns null if the customer hasn't been synced yet.
 */
async function findCustomerDbId(
  shopId: string,
  shopifyCustomerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: shopifyCustomers.id })
    .from(shopifyCustomers)
    .where(
      and(
        eq(shopifyCustomers.shopId, shopId),
        eq(shopifyCustomers.shopifyId, shopifyCustomerId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Look up the internal DB id for a variant by shopify_variant_id.
 * Returns null if the variant hasn't been synced yet.
 */
async function findVariantDbId(
  shopId: string,
  shopifyVariantId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: shopifyProductVariants.id })
    .from(shopifyProductVariants)
    .where(
      and(
        eq(shopifyProductVariants.shopId, shopId),
        eq(shopifyProductVariants.shopifyId, shopifyVariantId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Upsert line item
// ---------------------------------------------------------------------------

async function upsertLineItem(
  shopId: string,
  orderDbId: string,
  shopifyOrderId: string,
  node: ShopifyLineItemNode,
): Promise<void> {
  const shopifyId = extractShopifyId(node.id);

  let variantDbId: string | null = null;
  const shopifyVariantId = node.variant?.id
    ? extractShopifyId(node.variant.id)
    : null;
  if (shopifyVariantId) {
    variantDbId = await findVariantDbId(shopId, shopifyVariantId);
  }

  const shopifyProductId = node.product?.id
    ? extractShopifyId(node.product.id)
    : null;

  const values = {
    shopId,
    orderId: orderDbId,
    shopifyId,
    shopifyOrderId,
    variantId: variantDbId ?? undefined,
    shopifyVariantId,
    shopifyProductId,
    title: node.title,
    variantTitle: node.variantTitle ?? null,
    sku: node.sku ?? null,
    vendor: node.vendor ?? null,
    quantity: node.quantity,
    price: node.originalUnitPrice?.amount ?? "0",
    totalDiscount: node.totalDiscount?.amount ?? null,
    taxable: node.taxable,
    requiresShipping: node.requiresShipping,
    fulfillmentStatus: node.fulfillmentStatus ?? null,
    fulfillmentService: node.fulfillmentService?.handle ?? null,
    giftCard: node.giftCard,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select({ id: shopifyOrderLineItems.id })
    .from(shopifyOrderLineItems)
    .where(
      and(
        eq(shopifyOrderLineItems.shopId, shopId),
        eq(shopifyOrderLineItems.shopifyId, shopifyId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(shopifyOrderLineItems)
      .set(values)
      .where(eq(shopifyOrderLineItems.id, existing.id));
  } else {
    await db.insert(shopifyOrderLineItems).values(values);
  }
}

// ---------------------------------------------------------------------------
// Upsert refund
// ---------------------------------------------------------------------------

async function upsertRefund(
  shopId: string,
  orderDbId: string,
  shopifyOrderId: string,
  node: ShopifyRefundNode,
): Promise<void> {
  const shopifyId = extractShopifyId(node.id);

  // Build refund line items array
  const refundLineItems = node.refundLineItems.edges.map(({ node: rli }) => ({
    lineItemId: extractShopifyId(rli.lineItem.id),
    quantity: rli.quantity,
    restockType: rli.restockType,
    subtotal: rli.subtotal.amount,
    totalTax: rli.totalTax.amount,
  }));

  // Build transactions array
  const transactions = node.transactions.edges.map(({ node: tx }) => ({
    id: extractShopifyId(tx.id),
    amount: tx.amount,
    currency: tx.currency,
    gateway: tx.gateway ?? "",
    kind: tx.kind,
    status: tx.status,
  }));

  const values = {
    shopId,
    orderId: orderDbId,
    shopifyId,
    shopifyOrderId,
    note: node.note ?? null,
    restock: refundLineItems.some((rli) =>
      rli.restockType === "return" || rli.restockType === "restock",
    ),
    totalRefunded: node.totalRefunded?.amount ?? null,
    refundLineItems,
    transactions,
    shopifyCreatedAt: new Date(node.createdAt),
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select({ id: shopifyRefunds.id })
    .from(shopifyRefunds)
    .where(
      and(
        eq(shopifyRefunds.shopId, shopId),
        eq(shopifyRefunds.shopifyId, shopifyId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(shopifyRefunds)
      .set(values)
      .where(eq(shopifyRefunds.id, existing.id));
  } else {
    await db.insert(shopifyRefunds).values(values);
  }
}

// ---------------------------------------------------------------------------
// Upsert order (with line items and refunds)
// ---------------------------------------------------------------------------

async function upsertOrder(
  shopId: string,
  node: ShopifyOrderNode,
): Promise<void> {
  const shopifyId = extractShopifyId(node.id);

  // Resolve customer FK if present
  let customerDbId: string | null = null;
  const shopifyCustomerId = node.customer?.id
    ? extractShopifyId(node.customer.id)
    : null;
  if (shopifyCustomerId) {
    customerDbId = await findCustomerDbId(shopId, shopifyCustomerId);
  }

  const orderValues = {
    shopId,
    shopifyId,
    customerId: customerDbId ?? undefined,
    shopifyCustomerId,
    name: node.name,
    orderNumber: node.orderNumber,
    email: node.email ?? null,
    phone: node.phone ?? null,
    financialStatus: node.financialStatus ?? null,
    fulfillmentStatus: node.displayFulfillmentStatus ?? null,
    totalPrice: node.totalPriceSet.shopMoney.amount,
    subtotalPrice: node.subtotalPriceSet?.shopMoney.amount ?? null,
    totalTax: node.totalTaxSet?.shopMoney.amount ?? null,
    totalDiscounts: node.totalDiscountsSet?.shopMoney.amount ?? null,
    totalShippingPrice: node.totalShippingPriceSet?.shopMoney.amount ?? null,
    totalRefunded: node.totalRefundedSet?.shopMoney.amount ?? null,
    currency: node.currencyCode,
    shippingAddress: addressToRecord(node.shippingAddress) ?? null,
    billingAddress: addressToRecord(node.billingAddress) ?? null,
    tags: node.tags.join(",") || null,
    note: node.note ?? null,
    sourceIdentifier: node.sourceIdentifier ?? null,
    cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
    cancelReason: node.cancelReason ?? null,
    test: node.test,
    shopifyCreatedAt: new Date(node.createdAt),
    shopifyUpdatedAt: node.updatedAt ? new Date(node.updatedAt) : null,
    shopifyProcessedAt: node.processedAt ? new Date(node.processedAt) : null,
    updatedAt: new Date(),
  };

  let orderDbId: string;

  const [existing] = await db
    .select({ id: shopifyOrders.id })
    .from(shopifyOrders)
    .where(
      and(
        eq(shopifyOrders.shopId, shopId),
        eq(shopifyOrders.shopifyId, shopifyId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(shopifyOrders)
      .set(orderValues)
      .where(eq(shopifyOrders.id, existing.id));
    orderDbId = existing.id;
  } else {
    const [created] = await db
      .insert(shopifyOrders)
      .values(orderValues)
      .returning({ id: shopifyOrders.id });
    orderDbId = created!.id;
  }

  // Upsert line items
  for (const { node: lineItemNode } of node.lineItems.edges) {
    await upsertLineItem(shopId, orderDbId, shopifyId, lineItemNode);
  }

  // Upsert refunds (embedded in the order query)
  for (const refundNode of node.refunds) {
    await upsertRefund(shopId, orderDbId, shopifyId, refundNode);
  }
}

// ---------------------------------------------------------------------------
// Core sync function
// ---------------------------------------------------------------------------

/**
 * Sync orders (with line items and refunds) for a single shop.
 *
 * @param shopId  Internal UUID of the shop
 * @param shop    myshopify.com domain
 * @param accessToken  Shopify Admin API access token
 * @param syncType  "full" | "incremental"
 */
export async function syncOrders(
  shopId: string,
  shop: string,
  accessToken: string,
  syncType: "full" | "incremental" = "full",
): Promise<{ synced: number }> {
  // Orders sync also covers refunds — we log them under "orders"
  const logId = await startSyncLog(shopId, "orders", syncType);
  const client = createGraphQLClient(shop, accessToken);

  let totalSynced = 0;
  let cursor: string | null = null;
  let hasNextPage = true;
  let lastUpdatedAt: Date | null = null;

  let queryFilter: string | undefined;
  if (syncType === "incremental") {
    const lastSync = await getLastSuccessfulSync(shopId, "orders");
    if (lastSync?.cursorUpdatedAt) {
      queryFilter = buildUpdatedAtQuery(lastSync.cursorUpdatedAt);
      console.log(
        `[orders-sync][${shop}] Incremental sync since ${lastSync.cursorUpdatedAt.toISOString()}`,
      );
    } else {
      console.log(
        `[orders-sync][${shop}] No previous successful sync found, falling back to full sync`,
      );
    }
  }

  console.log(`[orders-sync][${shop}] Starting ${syncType} sync`);

  try {
    while (hasNextPage) {
      const variables: Record<string, unknown> = {
        first: PAGE_SIZE,
        after: cursor ?? null,
        query: queryFilter ?? null,
      };

      const result = await client.query<OrdersQueryResult>(
        ORDERS_QUERY,
        variables,
      );

      const { edges, pageInfo } = result.orders;

      for (const { node } of edges) {
        await upsertOrder(shopId, node);
        totalSynced++;

        if (node.updatedAt) {
          const nodeUpdatedAt = new Date(node.updatedAt);
          if (!lastUpdatedAt || nodeUpdatedAt > lastUpdatedAt) {
            lastUpdatedAt = nodeUpdatedAt;
          }
        }
      }

      await incrementSyncLogCount(logId, edges.length);

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor ?? null;

      console.log(
        `[orders-sync][${shop}] Page synced: ${edges.length} orders (total: ${totalSynced}, hasNextPage: ${hasNextPage})`,
      );
    }

    await completeSyncLog(logId, totalSynced, lastUpdatedAt ?? undefined);
    console.log(
      `[orders-sync][${shop}] Completed: ${totalSynced} orders synced`,
    );

    return { synced: totalSynced };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[orders-sync][${shop}] Failed:`, message);
    await failSyncLog(logId, message, totalSynced);
    throw error;
  }
}
