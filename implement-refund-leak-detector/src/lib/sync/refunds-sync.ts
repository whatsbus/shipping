/**
 * Shopify Refunds Sync Service
 *
 * Refunds in Shopify are embedded within orders — there is no standalone
 * "refunds" top-level query in the GraphQL API. This service provides
 * a dedicated entry point for syncing refund data specifically, which is
 * useful when:
 *
 *  1. You want to refresh only refunds without re-downloading all orders
 *  2. The Detection Engine needs fresh refund data between full order syncs
 *
 * Implementation: Re-uses the orders sync with a targeted filter that only
 * returns orders that have had refunds created/updated in the window.
 * The orders-sync module handles the actual upsert of refund records.
 *
 * Multi-tenant, idempotent, and respects rate limits via the GraphQL client.
 */

import { db } from "@/db";
import { shopifyRefunds } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { createGraphQLClient } from "@/lib/shopify/graphql-client";
import {
  ORDERS_QUERY,
  extractShopifyId,
  buildUpdatedAtQuery,
  type OrdersQueryResult,
} from "./queries";
import { upsertOrderWithRefunds } from "./orders-refund-bridge";
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

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Core sync function
// ---------------------------------------------------------------------------

/**
 * Sync refunds for a single shop by fetching orders that have been
 * updated (which includes newly-created refunds) since the last sync.
 *
 * This shares the order query infrastructure and upserts refund records
 * as a side effect of processing each order page.
 *
 * @param shopId  Internal UUID of the shop
 * @param shop    myshopify.com domain
 * @param accessToken  Shopify Admin API access token
 * @param syncType  "full" | "incremental"
 */
export async function syncRefunds(
  shopId: string,
  shop: string,
  accessToken: string,
  syncType: "full" | "incremental" = "incremental",
): Promise<{ synced: number }> {
  const logId = await startSyncLog(shopId, "refunds", syncType);
  const client = createGraphQLClient(shop, accessToken);

  let totalRefundsSynced = 0;
  let cursor: string | null = null;
  let hasNextPage = true;
  let lastUpdatedAt: Date | null = null;

  let queryFilter: string | undefined;
  if (syncType === "incremental") {
    // For refunds, we look at the last successful "refunds" sync.
    // If none, look at the last orders sync. If none, do a full scan.
    const lastSync =
      (await getLastSuccessfulSync(shopId, "refunds")) ??
      (await getLastSuccessfulSync(shopId, "orders"));

    if (lastSync?.cursorUpdatedAt) {
      // Filter to orders updated since last sync (refunds cause order updated_at to change)
      queryFilter = buildUpdatedAtQuery(lastSync.cursorUpdatedAt);
      console.log(
        `[refunds-sync][${shop}] Incremental sync since ${lastSync.cursorUpdatedAt.toISOString()}`,
      );
    } else {
      console.log(
        `[refunds-sync][${shop}] No previous successful sync found, fetching all refunded orders`,
      );
      // Filter to orders that have any refunds
      queryFilter = "financial_status:refunded OR financial_status:partially_refunded";
    }
  }

  console.log(`[refunds-sync][${shop}] Starting ${syncType} refund sync`);

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
        const refundCount = node.refunds.length;
        if (refundCount > 0) {
          // Delegate to the shared upsert utility
          await upsertOrderWithRefunds(shopId, node);
          totalRefundsSynced += refundCount;
        }

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
        `[refunds-sync][${shop}] Page: ${edges.length} orders (${totalRefundsSynced} refunds total, hasNextPage: ${hasNextPage})`,
      );
    }

    await completeSyncLog(logId, totalRefundsSynced, lastUpdatedAt ?? undefined);
    console.log(
      `[refunds-sync][${shop}] Completed: ${totalRefundsSynced} refunds synced`,
    );

    return { synced: totalRefundsSynced };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[refunds-sync][${shop}] Failed:`, message);
    await failSyncLog(logId, message, totalRefundsSynced);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Query refunds from local DB (for Detection Engine use)
// ---------------------------------------------------------------------------

/**
 * Get the most recent N refunds for a shop.
 * Used by the Detection Engine to analyze refund patterns.
 */
export async function getRecentRefunds(shopId: string, limit = 500) {
  return db
    .select()
    .from(shopifyRefunds)
    .where(eq(shopifyRefunds.shopId, shopId))
    .orderBy(desc(shopifyRefunds.shopifyCreatedAt))
    .limit(limit);
}

/**
 * Get refund stats for a shop.
 * Returns total refunded amount and refund count.
 */
export async function getRefundStats(shopId: string) {
  const rows = await db
    .select({
      shopifyId: shopifyRefunds.shopifyId,
      totalRefunded: shopifyRefunds.totalRefunded,
      shopifyCreatedAt: shopifyRefunds.shopifyCreatedAt,
    })
    .from(shopifyRefunds)
    .where(
      and(
        eq(shopifyRefunds.shopId, shopId),
      ),
    );

  const totalAmount = rows.reduce(
    (sum, r) => sum + Number(r.totalRefunded ?? 0),
    0,
  );

  return {
    count: rows.length,
    totalAmount,
  };
}
