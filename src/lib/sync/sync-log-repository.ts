/**
 * Sync Log Repository
 *
 * Manages the sync_logs table which tracks every sync job:
 * - When it started and completed
 * - How many records were synced
 * - Any errors that occurred
 * - The cursor used for incremental sync (so we know what "since" means)
 *
 * The last successful sync log for each resource is used by incremental
 * sync to determine the updatedAt filter to apply.
 */

import { db } from "@/db";
import { syncLogs } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export type SyncResource = "orders" | "products" | "customers" | "refunds";
export type SyncType = "full" | "incremental";

// ---------------------------------------------------------------------------
// Create a new sync log entry (marks sync as "running")
// ---------------------------------------------------------------------------

export async function startSyncLog(
  shopId: string,
  resource: SyncResource,
  syncType: SyncType,
): Promise<string> {
  const [log] = await db
    .insert(syncLogs)
    .values({
      shopId,
      resource,
      syncType,
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: syncLogs.id });

  return log!.id;
}

// ---------------------------------------------------------------------------
// Mark a sync log as completed successfully
// ---------------------------------------------------------------------------

export async function completeSyncLog(
  logId: string,
  recordsSynced: number,
  cursorUpdatedAt?: Date,
): Promise<void> {
  await db
    .update(syncLogs)
    .set({
      status: "completed",
      recordsSynced,
      completedAt: new Date(),
      ...(cursorUpdatedAt ? { cursorUpdatedAt } : {}),
    })
    .where(eq(syncLogs.id, logId));
}

// ---------------------------------------------------------------------------
// Mark a sync log as failed
// ---------------------------------------------------------------------------

export async function failSyncLog(
  logId: string,
  errorMessage: string,
  recordsSynced = 0,
): Promise<void> {
  await db
    .update(syncLogs)
    .set({
      status: "failed",
      errorMessage,
      recordsSynced,
      completedAt: new Date(),
    })
    .where(eq(syncLogs.id, logId));
}

// ---------------------------------------------------------------------------
// Increment the records-synced counter on a running log
// ---------------------------------------------------------------------------

export async function incrementSyncLogCount(
  logId: string,
  additionalCount: number,
): Promise<void> {
  // Read current count then update (drizzle doesn't support in-place increment
  // without sql template — keep it simple for now)
  const [current] = await db
    .select({ recordsSynced: syncLogs.recordsSynced })
    .from(syncLogs)
    .where(eq(syncLogs.id, logId))
    .limit(1);

  if (!current) return;

  await db
    .update(syncLogs)
    .set({ recordsSynced: current.recordsSynced + additionalCount })
    .where(eq(syncLogs.id, logId));
}

// ---------------------------------------------------------------------------
// Get the last successful sync log for a shop + resource
// Used by incremental sync to determine the "since" date
// ---------------------------------------------------------------------------

export async function getLastSuccessfulSync(
  shopId: string,
  resource: SyncResource,
): Promise<{ completedAt: Date | null; cursorUpdatedAt: Date | null } | null> {
  const [log] = await db
    .select({
      completedAt: syncLogs.completedAt,
      cursorUpdatedAt: syncLogs.cursorUpdatedAt,
    })
    .from(syncLogs)
    .where(
      and(
        eq(syncLogs.shopId, shopId),
        eq(syncLogs.resource, resource),
        eq(syncLogs.status, "completed"),
      ),
    )
    .orderBy(desc(syncLogs.completedAt))
    .limit(1);

  return log ?? null;
}

// ---------------------------------------------------------------------------
// Get sync history for a shop (for display in the UI)
// ---------------------------------------------------------------------------

export async function getSyncHistory(
  shopId: string,
  limit = 20,
) {
  return db
    .select()
    .from(syncLogs)
    .where(eq(syncLogs.shopId, shopId))
    .orderBy(desc(syncLogs.startedAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Check if a sync is currently running for a shop + resource
// Prevents parallel syncs from interfering with each other
// ---------------------------------------------------------------------------

export async function isSyncRunning(
  shopId: string,
  resource: SyncResource,
): Promise<boolean> {
  const [running] = await db
    .select({ id: syncLogs.id })
    .from(syncLogs)
    .where(
      and(
        eq(syncLogs.shopId, shopId),
        eq(syncLogs.resource, resource),
        eq(syncLogs.status, "running"),
      ),
    )
    .limit(1);

  return !!running;
}
