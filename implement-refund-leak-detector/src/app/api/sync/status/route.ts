/**
 * GET /api/sync/status
 *
 * Returns the sync status and history for the authenticated shop.
 *
 * Response:
 *   200 {
 *     ok: true,
 *     lastSyncedAt: string | null,
 *     history: SyncLog[],
 *     stats: {
 *       customers: { lastSynced: string | null, status: string }
 *       products: { lastSynced: string | null, status: string }
 *       orders: { lastSynced: string | null, status: string }
 *       refunds: { lastSynced: string | null, status: string }
 *     }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionShop } from "@/lib/shopify/session";
import { findActiveShopByDomain } from "@/lib/shopify/shop-repository";
import { getSyncHistory, getLastSuccessfulSync } from "@/lib/sync/sync-log-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Authorize
  const sessionData = await getSessionShop();
  if (!sessionData) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await findActiveShopByDomain(sessionData.shop);
  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  const shopId = shop.id;

  // Fetch sync history (last 20 sync jobs)
  const history = await getSyncHistory(shopId, 20);

  // Fetch last successful sync per resource
  const [customersSync, productsSync, ordersSync, refundsSync] =
    await Promise.all([
      getLastSuccessfulSync(shopId, "customers"),
      getLastSuccessfulSync(shopId, "products"),
      getLastSuccessfulSync(shopId, "orders"),
      getLastSuccessfulSync(shopId, "refunds"),
    ]);

  return NextResponse.json({
    ok: true,
    lastSyncedAt: shop.lastSyncedAt?.toISOString() ?? null,
    history: history.map((log) => ({
      id: log.id,
      resource: log.resource,
      syncType: log.syncType,
      status: log.status,
      recordsSynced: log.recordsSynced,
      errorMessage: log.errorMessage,
      startedAt: log.startedAt.toISOString(),
      completedAt: log.completedAt?.toISOString() ?? null,
      cursorUpdatedAt: log.cursorUpdatedAt?.toISOString() ?? null,
    })),
    stats: {
      customers: {
        lastSynced: customersSync?.completedAt?.toISOString() ?? null,
        cursorUpdatedAt: customersSync?.cursorUpdatedAt?.toISOString() ?? null,
      },
      products: {
        lastSynced: productsSync?.completedAt?.toISOString() ?? null,
        cursorUpdatedAt: productsSync?.cursorUpdatedAt?.toISOString() ?? null,
      },
      orders: {
        lastSynced: ordersSync?.completedAt?.toISOString() ?? null,
        cursorUpdatedAt: ordersSync?.cursorUpdatedAt?.toISOString() ?? null,
      },
      refunds: {
        lastSynced: refundsSync?.completedAt?.toISOString() ?? null,
        cursorUpdatedAt: refundsSync?.cursorUpdatedAt?.toISOString() ?? null,
      },
    },
  });
}
