/**
 * Mandatory GDPR Webhook: customers/data_request
 *
 * Shopify requires this webhook for App Store approval.
 * Triggered when a customer requests their data from a merchant.
 *
 * ProfitLens stores only order-level analytics — no PII beyond order numbers.
 * This webhook acknowledges receipt and logs the request.
 *
 * POST /api/webhooks/customers-data-request
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
  console.info(`[webhook/customers-data-request] Received for shop: ${shopDomain}`);

  // ProfitLens does not store personal customer data — acknowledge receipt
  return NextResponse.json({ received: true }, { status: 200 });
}
