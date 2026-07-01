/**
 * Shopify Customers Sync Service
 *
 * Downloads all customer records from the Shopify Admin GraphQL API
 * and upserts them into the shopify_customers table.
 *
 * Supports:
 * - Full sync (all customers)
 * - Incremental sync (only customers updated since the last sync)
 * - Multi-tenant: scoped by shopId
 * - Idempotent: re-running is always safe (upsert on shopify_id)
 * - Pagination: follows cursor until all pages are consumed
 */

import { db } from "@/db";
import { shopifyCustomers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createGraphQLClient } from "@/lib/shopify/graphql-client";
import {
  CUSTOMERS_QUERY,
  extractShopifyId,
  buildUpdatedAtQuery,
  type CustomersQueryResult,
  type ShopifyCustomerNode,
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

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Internal helpers
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
 * Upsert a single customer record.
 * Uses shopId + shopifyId as the idempotency key.
 */
async function upsertCustomer(
  shopId: string,
  node: ShopifyCustomerNode,
): Promise<void> {
  const shopifyId = extractShopifyId(node.id);

  const values = {
    shopId,
    shopifyId,
    email: node.email ?? null,
    firstName: node.firstName ?? null,
    lastName: node.lastName ?? null,
    phone: node.phone ?? null,
    state: node.state ?? null,
    totalSpent: node.amountSpent?.amount ?? null,
    ordersCount: node.numberOfOrders ?? 0,
    verifiedEmail: node.verifiedEmail ?? false,
    taxExempt: node.taxExempt ?? false,
    tags: node.tags.join(",") || null,
    note: node.note ?? null,
    defaultAddress: addressToRecord(node.defaultAddress) ?? null,
    shopifyCreatedAt: node.createdAt ? new Date(node.createdAt) : null,
    shopifyUpdatedAt: node.updatedAt ? new Date(node.updatedAt) : null,
    updatedAt: new Date(),
  };

  // Check if record exists
  const [existing] = await db
    .select({ id: shopifyCustomers.id })
    .from(shopifyCustomers)
    .where(
      and(
        eq(shopifyCustomers.shopId, shopId),
        eq(shopifyCustomers.shopifyId, shopifyId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(shopifyCustomers)
      .set(values)
      .where(eq(shopifyCustomers.id, existing.id));
  } else {
    await db.insert(shopifyCustomers).values(values);
  }
}

// ---------------------------------------------------------------------------
// Core sync function
// ---------------------------------------------------------------------------

/**
 * Sync customers for a single shop.
 *
 * @param shopId  Internal UUID of the shop
 * @param shop    myshopify.com domain (e.g. "my-store.myshopify.com")
 * @param accessToken  Shopify Admin API access token
 * @param syncType  "full" | "incremental"
 */
export async function syncCustomers(
  shopId: string,
  shop: string,
  accessToken: string,
  syncType: "full" | "incremental" = "full",
): Promise<{ synced: number }> {
  const logId = await startSyncLog(shopId, "customers", syncType);
  const client = createGraphQLClient(shop, accessToken);

  let totalSynced = 0;
  let cursor: string | null = null;
  let hasNextPage = true;
  let lastUpdatedAt: Date | null = null;

  // For incremental sync, filter by updated_at
  let queryFilter: string | undefined;
  if (syncType === "incremental") {
    const lastSync = await getLastSuccessfulSync(shopId, "customers");
    if (lastSync?.cursorUpdatedAt) {
      queryFilter = buildUpdatedAtQuery(lastSync.cursorUpdatedAt);
      console.log(
        `[customers-sync][${shop}] Incremental sync since ${lastSync.cursorUpdatedAt.toISOString()}`,
      );
    } else {
      console.log(
        `[customers-sync][${shop}] No previous successful sync found, falling back to full sync`,
      );
    }
  }

  console.log(`[customers-sync][${shop}] Starting ${syncType} sync`);

  try {
    while (hasNextPage) {
      const variables: Record<string, unknown> = {
        first: PAGE_SIZE,
        after: cursor ?? null,
        query: queryFilter ?? null,
      };

      const result = await client.query<CustomersQueryResult>(
        CUSTOMERS_QUERY,
        variables,
      );

      const { edges, pageInfo } = result.customers;

      // Process each customer in this page
      for (const { node } of edges) {
        await upsertCustomer(shopId, node);
        totalSynced++;

        // Track the latest updatedAt for the cursor
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
        `[customers-sync][${shop}] Page synced: ${edges.length} customers (total: ${totalSynced}, hasNextPage: ${hasNextPage})`,
      );
    }

    await completeSyncLog(logId, totalSynced, lastUpdatedAt ?? undefined);
    console.log(
      `[customers-sync][${shop}] Completed: ${totalSynced} customers synced`,
    );

    return { synced: totalSynced };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.error(`[customers-sync][${shop}] Failed:`, message);
    await failSyncLog(logId, message, totalSynced);
    throw error;
  }
}
