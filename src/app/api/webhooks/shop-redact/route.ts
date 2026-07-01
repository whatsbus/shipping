/**
 * Mandatory GDPR Webhook: shop/redact
 *
 * Shopify requires this webhook for App Store approval.
 * Triggered 48 hours after a shop uninstalls the app, requesting
 * that all shop data be permanently deleted.
 *
 * Implementation note: Actual data deletion should be handled carefully
 * in production — consider a soft-delete with a scheduled hard-delete
 * to allow for re-installs within the 48-hour window.
 *
 * POST /api/webhooks/shop-redact
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify/crypto";
import { getShopifyApiSecret } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.arrayBuffer();
  const rawBodyBuffer = Buffer.from(rawBody);

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const isValid = verifyWebhookHmac(rawBodyBuffer, hmacHeader, getShopifyApiSecret());

  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopDomain = request.headers.get("x-shopify-shop-domain");

  let payload: { shop_domain?: string } = {};
  try {
    payload = JSON.parse(rawBodyBuffer.toString("utf-8")) as { shop_domain?: string };
  } catch {
    // Non-fatal — shop domain from header is sufficient
  }

  const shop = payload.shop_domain ?? shopDomain;
  console.info(`[webhook/shop-redact] Received for shop: ${shop}`);

  // TODO: In production, schedule permanent deletion of all shop data
  // after verifying the shop has been uninstalled for 48+ hours.
  // The cascade delete on `shops` table will remove all related records.

  return NextResponse.json({ received: true }, { status: 200 });
}
