/**
 * Shopify App Uninstall Webhook
 *
 * Handles the `app/uninstalled` webhook topic from Shopify.
 * Triggered when a merchant uninstalls the app from their Shopify admin.
 *
 * Security:
 *   - HMAC-SHA256 verification using raw request body (base64-encoded header).
 *   - Returns 401 immediately on signature mismatch.
 *   - Must consume and respond to the raw body BEFORE any JSON parsing.
 *
 * Business logic:
 *   - Marks the shop as inactive in the database.
 *   - Clears the stored access token (no longer valid after uninstall).
 *   - Preserves all historical data (findings, billing, settings) for compliance.
 *   - Returns 200 quickly — webhook processing is synchronous but fast.
 *
 * Mandatory webhooks (required by Shopify for App Store approval):
 *   - customers/data_request  → /api/webhooks/customers-data-request
 *   - customers/redact        → /api/webhooks/customers-redact
 *   - shop/redact             → /api/webhooks/shop-redact
 *
 * POST /api/webhooks/app-uninstalled
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify/crypto";
import { getShopifyApiSecret } from "@/lib/shopify/config";
import { markShopUninstalled } from "@/lib/shopify/shop-repository";

export const dynamic = "force-dynamic";

/**
 * Disable Next.js body parsing — we need the raw bytes for HMAC verification.
 * The body must be read as a Buffer before any JSON parsing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Read raw body for HMAC verification ───────────────────────────────

  const rawBody = await request.arrayBuffer();
  const rawBodyBuffer = Buffer.from(rawBody);

  // ── 2. Verify HMAC signature ─────────────────────────────────────────────

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256") ?? "";

  const isValid = verifyWebhookHmac(
    rawBodyBuffer,
    hmacHeader,
    getShopifyApiSecret(),
  );

  if (!isValid) {
    console.warn("[webhook/app-uninstalled] HMAC verification failed.");
    return NextResponse.json(
      { error: "Unauthorized: HMAC verification failed." },
      { status: 401 },
    );
  }

  // ── 3. Extract webhook metadata ──────────────────────────────────────────

  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const topic = request.headers.get("x-shopify-topic");

  if (!shopDomain) {
    console.warn("[webhook/app-uninstalled] Missing shop domain header.");
    return NextResponse.json(
      { error: "Missing X-Shopify-Shop-Domain header." },
      { status: 400 },
    );
  }

  if (topic !== "app/uninstalled") {
    console.warn(
      `[webhook/app-uninstalled] Unexpected topic: ${topic}. Expected app/uninstalled.`,
    );
    // Still return 200 to prevent Shopify retries for wrong-route delivery
    return NextResponse.json({ received: true });
  }

  // ── 4. Parse body (already verified) ────────────────────────────────────

  let payload: { myshopify_domain?: string } = {};

  try {
    payload = JSON.parse(rawBodyBuffer.toString("utf-8")) as {
      myshopify_domain?: string;
    };
  } catch {
    // Malformed JSON is non-fatal here — we already have the shop domain
    // from the request headers
  }

  const shop = payload.myshopify_domain ?? shopDomain;

  // ── 5. Mark shop as uninstalled ──────────────────────────────────────────

  try {
    await markShopUninstalled(shop);
    console.info(`[webhook/app-uninstalled] Shop ${shop} marked as inactive.`);
  } catch (error) {
    console.error(
      `[webhook/app-uninstalled] Failed to mark shop ${shop} as inactive:`,
      error,
    );
    // Return 500 so Shopify retries the webhook
    return NextResponse.json(
      { error: "Failed to process uninstall event." },
      { status: 500 },
    );
  }

  // ── 6. Respond ───────────────────────────────────────────────────────────

  // Shopify expects a 200 response within 5 seconds
  return NextResponse.json({ received: true }, { status: 200 });
}
