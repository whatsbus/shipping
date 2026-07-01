/**
 * POST /api/detect/run
 *
 * Triggers the Detection Engine for the authenticated shop.
 * Loads synchronized Shopify data from the database, runs all registered
 * detectors, and persists any findings produced.
 *
 * This endpoint is the bridge between the sync layer and the detection layer:
 *   1. Load data pre-loaded from DB (via refund-data-loader)
 *   2. Inject data into DetectorContext.meta
 *   3. Run the engine
 *   4. Persist findings produced by each detector
 *
 * Authorization:
 *   - Session cookie (merchant-facing) OR
 *   - X-Sync-Secret header (server-to-server / cron)
 *
 * Request body (optional JSON):
 *   { "shopId": "uuid", "detectorTypes": ["refund_leak"] }
 *
 * Response:
 *   200 { ok: true, run: DetectionRunSummary, persistence: PersistenceSummary }
 *   401 { error: "..." }
 *   500 { error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionShop } from "@/lib/shopify/session";
import { db } from "@/db";
import { shops } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DetectionEngine } from "@/core/detection/engine";
import { defaultRegistry } from "@/core/detection/registry";
import { setupDetectors } from "@/core/detection/setup";
import { loadRefundData } from "@/core/detection/refund-data-loader";
import { persistFindings } from "@/core/detection/findings-repository";
import type { RefundLeakPayload } from "@/core/detection/finding-payload";
import type { EngineRunOptions, DetectorType } from "@/core/detection/types";

export const dynamic = "force-dynamic";

const SYNC_SECRET = process.env.SYNC_SECRET;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Authorization ──────────────────────────────────────────────────────────

  const authHeader = request.headers.get("x-sync-secret");
  const isServerCall = SYNC_SECRET && authHeader === SYNC_SECRET;

  let shopId: string;
  let shopDomain: string;
  let currency: string;
  let requestedDetectorTypes: DetectorType[] | undefined;

  if (isServerCall) {
    // Server-to-server: shopId must be in the request body
    let body: { shopId?: string; detectorTypes?: DetectorType[] } = {};
    try {
      body = (await request.json()) as {
        shopId?: string;
        detectorTypes?: DetectorType[];
      };
    } catch {
      // no body
    }

    if (!body.shopId) {
      return NextResponse.json(
        { error: "shopId is required for server-to-server calls" },
        { status: 400 },
      );
    }

    const [shop] = await db
      .select()
      .from(shops)
      .where(eq(shops.id, body.shopId))
      .limit(1);

    if (!shop || !shop.isActive) {
      return NextResponse.json(
        { error: "Shop not found or not active" },
        { status: 404 },
      );
    }

    shopId = shop.id;
    shopDomain = shop.myshopifyDomain;
    currency = shop.currency;
    requestedDetectorTypes = body.detectorTypes;
  } else {
    // Session-based
    const sessionData = await getSessionShop();

    if (!sessionData) {
      // Development fallback: use first shop in DB
      const [firstShop] = await db.select().from(shops).limit(1);
      if (!firstShop) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      shopId = firstShop.id;
      shopDomain = firstShop.myshopifyDomain;
      currency = firstShop.currency;
    } else {
      const [shop] = await db
        .select()
        .from(shops)
        .where(eq(shops.id, sessionData.shopId))
        .limit(1);

      if (!shop) {
        return NextResponse.json({ error: "Shop not found" }, { status: 404 });
      }

      shopId = shop.id;
      shopDomain = shop.myshopifyDomain;
      currency = shop.currency;
    }

    // Parse optional body for session callers too
    try {
      const body = (await request.json()) as {
        detectorTypes?: DetectorType[];
      };
      requestedDetectorTypes = body.detectorTypes;
    } catch {
      // no body or not JSON
    }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  setupDetectors();
  const engine = new DetectionEngine(defaultRegistry);

  // ── Load data for registered detectors ────────────────────────────────────

  console.log(`[api/detect/run] Loading refund data for ${shopDomain}`);
  const refundData = await loadRefundData(shopId);
  console.log(
    `[api/detect/run] Loaded ${refundData.refunds.length} refunds, ` +
      `${refundData.productRefunds.length} product aggregates, ` +
      `${refundData.customerRefunds.length} customer aggregates`,
  );

  // ── Run the engine ─────────────────────────────────────────────────────────

  const options: EngineRunOptions = {
    detectorTypes: requestedDetectorTypes,
    meta: {
      refundData,
      triggeredBy: isServerCall ? "server" : "merchant",
    },
  };

  const run = await engine.run(shopId, shopDomain, currency, options);

  // ── Persist findings ───────────────────────────────────────────────────────

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalEvidenceRows = 0;

  for (const result of run.results) {
    if (result.status !== "ok" || !result.anomaliesFound) continue;
    if (!result.payload) continue;

    try {
      if (result.detectorType === "refund_leak") {
        const payload = result.payload as RefundLeakPayload;
        const persistResult = await persistFindings(
          shopId,
          result.detectorType,
          payload.findings,
        );
        totalInserted += persistResult.inserted;
        totalUpdated += persistResult.updated;
        totalEvidenceRows += persistResult.evidenceRows;
        console.log(
          `[api/detect/run] Persisted refund_leak findings: ` +
            `${persistResult.inserted} inserted, ${persistResult.updated} updated, ` +
            `${persistResult.evidenceRows} evidence rows`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[api/detect/run] Failed to persist findings for ${result.detectorType}:`,
        message,
      );
    }
  }

  // ── Response ───────────────────────────────────────────────────────────────

  return NextResponse.json({
    ok: true,
    run: {
      shopId: run.shopId,
      shopDomain: run.shopDomain,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt.toISOString(),
      durationMs: run.durationMs,
      hasErrors: run.hasErrors,
      anomalyCount: run.anomalyCount,
      results: run.results.map((r) => ({
        detectorType: r.detectorType,
        status: r.status,
        anomaliesFound: r.anomaliesFound,
        message: r.message,
        durationMs: r.durationMs,
      })),
    },
    persistence: {
      inserted: totalInserted,
      updated: totalUpdated,
      evidenceRows: totalEvidenceRows,
    },
  });
}
