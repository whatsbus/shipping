/**
 * Shopify OAuth Install Route
 *
 * Entry point for the OAuth install flow. Shopify redirects merchants here
 * when they install the app from the Shopify App Store or a direct install link.
 *
 * Flow:
 *   1. Validate the `shop` query parameter.
 *   2. Verify the HMAC signature from Shopify (if present).
 *   3. Check if the shop already has a valid access token.
 *   4. Generate a nonce (anti-CSRF state parameter).
 *   5. Persist the nonce in the database.
 *   6. Redirect the merchant to Shopify's OAuth authorization page.
 *
 * GET /api/auth/install?shop=mystore.myshopify.com&hmac=...&timestamp=...
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isValidShopDomain,
  buildOAuthAuthorizationUrl,
  getShopifyApiSecret,
} from "@/lib/shopify/config";
import { verifyOAuthHmac, generateNonce } from "@/lib/shopify/crypto";
import {
  findActiveShopByDomain,
  storeOAuthNonce,
} from "@/lib/shopify/shop-repository";
import { setSessionShop } from "@/lib/shopify/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const shop = searchParams.get("shop");
  const hmac = searchParams.get("hmac");
  const timestamp = searchParams.get("timestamp");

  // ── 1. Validate shop parameter ──────────────────────────────────────────

  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter." },
      { status: 400 },
    );
  }

  // ── 2. Verify HMAC if provided (Shopify always includes it) ─────────────

  if (hmac) {
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const isValid = verifyOAuthHmac(params, getShopifyApiSecret());
    if (!isValid) {
      return NextResponse.json(
        { error: "HMAC validation failed. Request may have been tampered." },
        { status: 401 },
      );
    }
  }

  // ── 3. Check for existing valid installation ─────────────────────────────

  try {
    const existingShop = await findActiveShopByDomain(shop);

    if (existingShop?.accessToken) {
      // Shop is already installed and active — establish session and redirect
      // to the embedded app dashboard
      await setSessionShop({
        shop: existingShop.myshopifyDomain,
        shopId: existingShop.id,
      });

      const host = searchParams.get("host");
      const dashboardUrl = host
        ? `/dashboard?shop=${shop}&host=${host}`
        : `/dashboard?shop=${shop}`;

      return NextResponse.redirect(new URL(dashboardUrl, request.url));
    }
  } catch (error) {
    console.error("[auth/install] DB lookup failed:", error);
    // Non-fatal — proceed with OAuth
  }

  // ── 4. Generate nonce and start OAuth ───────────────────────────────────

  const nonce = generateNonce();

  try {
    await storeOAuthNonce(nonce, shop);
  } catch (error) {
    console.error("[auth/install] Failed to store nonce:", error);
    return NextResponse.json(
      { error: "Internal error. Please try again." },
      { status: 500 },
    );
  }

  // ── 5. Redirect to Shopify OAuth authorization page ─────────────────────

  const authorizationUrl = buildOAuthAuthorizationUrl(shop, nonce);

  return NextResponse.redirect(authorizationUrl);
}
