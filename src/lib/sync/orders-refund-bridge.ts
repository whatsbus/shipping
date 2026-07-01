/**
 * Orders–Refunds Bridge
 *
 * Shared upsert utility used by both orders-sync.ts and refunds-sync.ts
 * to process an order node and upsert its embedded refund records.
 *
 * This avoids circular imports between the two sync modules.
 */

import { db } from "@/db";
import {
  shopifyOrders,
  shopifyRefunds,
  shopifyCustomers,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  extractShopifyId,
  type ShopifyOrderNode,
  type ShopifyRefundNode,
  type ShopifyAddress,
} from "./queries";

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

// ---------------------------------------------------------------------------
// Refund upsert
// ---------------------------------------------------------------------------

export async function upsertRefundRecord(
  shopId: string,
  orderDbId: string,
  shopifyOrderId: string,
  node: ShopifyRefundNode,
): Promise<void> {
  const shopifyId = extractShopifyId(node.id);

  const refundLineItems = node.refundLineItems.edges.map(({ node: rli }) => ({
    lineItemId: extractShopifyId(rli.lineItem.id),
    quantity: rli.quantity,
    restockType: rli.restockType,
    subtotal: rli.subtotal.amount,
    totalTax: rli.totalTax.amount,
  }));

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
    restock: refundLineItems.some(
      (rli) => rli.restockType === "return" || rli.restockType === "restock",
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
// Order upsert (only order record + refunds, no line items)
// Used by refunds-sync to avoid re-processing line items
// ---------------------------------------------------------------------------

export async function upsertOrderWithRefunds(
  shopId: string,
  node: ShopifyOrderNode,
): Promise<void> {
  const shopifyId = extractShopifyId(node.id);

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

  // Upsert refunds
  for (const refundNode of node.refunds) {
    await upsertRefundRecord(shopId, orderDbId, shopifyId, refundNode);
  }
}
