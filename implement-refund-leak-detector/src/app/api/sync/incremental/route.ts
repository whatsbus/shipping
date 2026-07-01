/**
 * POST /api/sync/incremental
 *
 * Triggers an incremental data synchronization for the authenticated shop.
 *
 * Only downloads records that have been updated since the last successful
 * sync for each resource. Much faster than a full sync — suitable for
 * scheduled polling (e.g. every 15 minutes via a cron job).
 *
 * Authorization:
 * - Requires a valid iron-session cookie (shop must be authenticated)
 * - For server-to-server calls (e.g. cron jobs), pass X-Sync-Secret header
 *
 * Request body (optional JSON):
 *   { "shopId": "uuid" }  — server-to-server only
 *
 * Response:
 *   200 { ok: true, summary: SyncSummary }
 *   401 { error: "..." }
 *   500 { error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionShop } from "@/lib/shopify/session";
import { findActiveShopByDomain } from "@/lib/shopify/shop-repository";
import { runIncrementalSync } from "@/lib/sync/sync-coordinator";
import { db } from "@/db";
import { shops } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const SYNC_SECRET = process.env.SYNC_SECRET;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Authorization ──────────────────────────────────────────────────────────

  const authHeader = request.headers.get("x-sync-secret");
  const isServerCall = SYNC_SECRET && authHeader === SYNC_SECRET;

  let shopId: string;
  let shopDomain: string;
  let accessToken: string;

  if (isServerCall) {
    let body: { shopId?: string } = {};
    try {
      body = (await request.json()) as { shopId?: string };
    } catch {
      // No body
    }

    if (!body.shopId) {
      return NextResponse.json(
        { error: "shopId is required for server-to-server sync calls" },
        { status: 400 },
      );
    }

    const [shop] = await db
      .select()
      .from(shops)
      .where(eq(shops.id, body.shopId))
      .limit(1);

    if (!shop || !shop.isActive || !shop.accessToken) {
      return NextResponse.json(
        { error: "Shop not found or not active" },
        { status: 404 },
      );
    }

    shopId = shop.id;
    shopDomain = shop.myshopifyDomain;
    accessToken = shop.accessToken;
  } else {
    const sessionData = await getSessionShop();
    if (!sessionData) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shop = await findActiveShopByDomain(sessionData.shop);
    if (!shop || !shop.accessToken) {
      return NextResponse.json(
        { error: "Shop not found or access token missing" },
        { status: 404 },
      );
    }

    shopId = shop.id;
    shopDomain = shop.myshopifyDomain;
    accessToken = shop.accessToken;
  }

  // ── Run the sync ───────────────────────────────────────────────────────────

  try {
    console.log(
      `[api/sync/incremental] Starting incremental sync for ${shopDomain}`,
    );
    const summary = await runIncrementalSync(shopId, shopDomain, accessToken);

    return NextResponse.json({
      ok: true,
      summary: {
        shopId: summary.shopId,
        shop: summary.shop,
        syncType: summary.syncType,
        startedAt: summary.startedAt.toISOString(),
        completedAt: summary.completedAt.toISOString(),
        results: summary.results,
        totalSynced: summary.totalSynced,
        hasErrors: summary.hasErrors,
        durationMs:
          summary.completedAt.getTime() - summary.startedAt.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[api/sync/incremental] Sync failed for ${shopDomain}:`,
      message,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
