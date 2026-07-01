/**
 * Sync Coordinator
 *
 * Orchestrates the full and incremental synchronization of Shopify data
 * for one or all shops. This is the single entry point for triggering syncs.
 *
 * Sync order matters:
 *   1. Customers — orders reference customers, so sync customers first
 *   2. Products  — line items reference variants, so sync products second
 *   3. Orders    — with embedded refunds (line items + refunds upserted inline)
 *
 * The "refunds" resource is always synced inline with orders.
 * A dedicated `syncRefunds()` exists for targeted refresh only.
 *
 * Multi-tenant: all sync methods accept a shopId so they work for any shop.
 * Error isolation: a failure in one resource does not abort other resources.
 */

import { db } from "@/db";
import { shops } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { syncCustomers } from "./customers-sync";
import { syncProducts } from "./products-sync";
import { syncOrders } from "./orders-sync";
import { syncRefunds } from "./refunds-sync";
import { getSyncHistory, isSyncRunning } from "./sync-log-repository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  resource: string;
  synced: number;
  error?: string;
  skipped?: boolean;
}

export interface SyncSummary {
  shopId: string;
  shop: string;
  syncType: "full" | "incremental";
  startedAt: Date;
  completedAt: Date;
  results: SyncResult[];
  totalSynced: number;
  hasErrors: boolean;
}

// ---------------------------------------------------------------------------
// Per-shop sync
// ---------------------------------------------------------------------------

/**
 * Run a full synchronization for a single shop.
 *
 * Downloads ALL records from Shopify for customers, products, and orders
 * (with embedded refunds). Use this after initial installation or when
 * you need a complete data reset.
 *
 * @param shopId  Internal UUID
 * @param shop    myshopify.com domain
 * @param accessToken  OAuth access token
 */
export async function runFullSync(
  shopId: string,
  shop: string,
  accessToken: string,
): Promise<SyncSummary> {
  const startedAt = new Date();
  const results: SyncResult[] = [];

  console.log(`[sync-coordinator][${shop}] Starting FULL sync`);

  // 1. Customers
  try {
    const isRunning = await isSyncRunning(shopId, "customers");
    if (isRunning) {
      console.warn(`[sync-coordinator][${shop}] Customer sync already running, skipping`);
      results.push({ resource: "customers", synced: 0, skipped: true });
    } else {
      const { synced } = await syncCustomers(shopId, shop, accessToken, "full");
      results.push({ resource: "customers", synced });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync-coordinator][${shop}] Customer sync failed:`, message);
    results.push({ resource: "customers", synced: 0, error: message });
  }

  // 2. Products
  try {
    const isRunning = await isSyncRunning(shopId, "products");
    if (isRunning) {
      console.warn(`[sync-coordinator][${shop}] Product sync already running, skipping`);
      results.push({ resource: "products", synced: 0, skipped: true });
    } else {
      const { synced } = await syncProducts(shopId, shop, accessToken, "full");
      results.push({ resource: "products", synced });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync-coordinator][${shop}] Product sync failed:`, message);
    results.push({ resource: "products", synced: 0, error: message });
  }

  // 3. Orders (includes refunds inline)
  try {
    const isRunning = await isSyncRunning(shopId, "orders");
    if (isRunning) {
      console.warn(`[sync-coordinator][${shop}] Order sync already running, skipping`);
      results.push({ resource: "orders", synced: 0, skipped: true });
      results.push({ resource: "refunds", synced: 0, skipped: true });
    } else {
      const { synced } = await syncOrders(shopId, shop, accessToken, "full");
      results.push({ resource: "orders", synced });
      // Refunds are embedded in orders — count is tracked per-order
      results.push({ resource: "refunds", synced: 0, skipped: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync-coordinator][${shop}] Order sync failed:`, message);
    results.push({ resource: "orders", synced: 0, error: message });
  }

  // Update shop.lastSyncedAt
  await db
    .update(shops)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(shops.id, shopId));

  const completedAt = new Date();
  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const hasErrors = results.some((r) => !!r.error);

  console.log(
    `[sync-coordinator][${shop}] Full sync completed: ${totalSynced} total records, hasErrors=${hasErrors}`,
  );

  return {
    shopId,
    shop,
    syncType: "full",
    startedAt,
    completedAt,
    results,
    totalSynced,
    hasErrors,
  };
}

/**
 * Run an incremental synchronization for a single shop.
 *
 * Only downloads records updated since the last successful sync for each
 * resource. Much faster than a full sync for routine updates.
 *
 * @param shopId  Internal UUID
 * @param shop    myshopify.com domain
 * @param accessToken  OAuth access token
 */
export async function runIncrementalSync(
  shopId: string,
  shop: string,
  accessToken: string,
): Promise<SyncSummary> {
  const startedAt = new Date();
  const results: SyncResult[] = [];

  console.log(`[sync-coordinator][${shop}] Starting INCREMENTAL sync`);

  // 1. Customers
  try {
    const isRunning = await isSyncRunning(shopId, "customers");
    if (isRunning) {
      results.push({ resource: "customers", synced: 0, skipped: true });
    } else {
      const { synced } = await syncCustomers(
        shopId,
        shop,
        accessToken,
        "incremental",
      );
      results.push({ resource: "customers", synced });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync-coordinator][${shop}] Customer sync failed:`, message);
    results.push({ resource: "customers", synced: 0, error: message });
  }

  // 2. Products
  try {
    const isRunning = await isSyncRunning(shopId, "products");
    if (isRunning) {
      results.push({ resource: "products", synced: 0, skipped: true });
    } else {
      const { synced } = await syncProducts(
        shopId,
        shop,
        accessToken,
        "incremental",
      );
      results.push({ resource: "products", synced });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync-coordinator][${shop}] Product sync failed:`, message);
    results.push({ resource: "products", synced: 0, error: message });
  }

  // 3. Orders (includes refunds inline)
  try {
    const isRunning = await isSyncRunning(shopId, "orders");
    if (isRunning) {
      results.push({ resource: "orders", synced: 0, skipped: true });
    } else {
      const { synced } = await syncOrders(
        shopId,
        shop,
        accessToken,
        "incremental",
      );
      results.push({ resource: "orders", synced });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync-coordinator][${shop}] Order sync failed:`, message);
    results.push({ resource: "orders", synced: 0, error: message });
  }

  // Update shop.lastSyncedAt
  await db
    .update(shops)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(shops.id, shopId));

  const completedAt = new Date();
  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const hasErrors = results.some((r) => !!r.error);

  console.log(
    `[sync-coordinator][${shop}] Incremental sync completed: ${totalSynced} records, hasErrors=${hasErrors}`,
  );

  return {
    shopId,
    shop,
    syncType: "incremental",
    startedAt,
    completedAt,
    results,
    totalSynced,
    hasErrors,
  };
}

// ---------------------------------------------------------------------------
// Multi-shop sync (runs all active shops)
// ---------------------------------------------------------------------------

/**
 * Run full sync for all active shops in the database.
 * Errors in one shop do not abort other shops.
 */
export async function runFullSyncAllShops(): Promise<SyncSummary[]> {
  const activeShops = await db
    .select({
      id: shops.id,
      myshopifyDomain: shops.myshopifyDomain,
      accessToken: shops.accessToken,
    })
    .from(shops)
    .where(and(eq(shops.isActive, true)));

  const summaries: SyncSummary[] = [];

  for (const shop of activeShops) {
    if (!shop.accessToken) {
      console.warn(
        `[sync-coordinator] Shop ${shop.myshopifyDomain} has no access token, skipping`,
      );
      continue;
    }

    try {
      const summary = await runFullSync(
        shop.id,
        shop.myshopifyDomain,
        shop.accessToken,
      );
      summaries.push(summary);
    } catch (error) {
      console.error(
        `[sync-coordinator] Full sync failed for ${shop.myshopifyDomain}:`,
        error,
      );
    }
  }

  return summaries;
}

/**
 * Run incremental sync for all active shops.
 */
export async function runIncrementalSyncAllShops(): Promise<SyncSummary[]> {
  const activeShops = await db
    .select({
      id: shops.id,
      myshopifyDomain: shops.myshopifyDomain,
      accessToken: shops.accessToken,
    })
    .from(shops)
    .where(and(eq(shops.isActive, true)));

  const summaries: SyncSummary[] = [];

  for (const shop of activeShops) {
    if (!shop.accessToken) {
      console.warn(
        `[sync-coordinator] Shop ${shop.myshopifyDomain} has no access token, skipping`,
      );
      continue;
    }

    try {
      const summary = await runIncrementalSync(
        shop.id,
        shop.myshopifyDomain,
        shop.accessToken,
      );
      summaries.push(summary);
    } catch (error) {
      console.error(
        `[sync-coordinator] Incremental sync failed for ${shop.myshopifyDomain}:`,
        error,
      );
    }
  }

  return summaries;
}

// ---------------------------------------------------------------------------
// Sync status query
// ---------------------------------------------------------------------------

/**
 * Get recent sync history for a shop.
 */
export async function getShopSyncHistory(shopId: string, limit = 20) {
  return getSyncHistory(shopId, limit);
}
