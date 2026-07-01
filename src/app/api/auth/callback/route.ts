/**
 * Shopify OAuth Callback Route
 *
 * Shopify redirects merchants here after they approve the app installation.
 *
 * Flow:
 *   1. Validate all required query parameters are present.
 *   2. Verify HMAC signature to confirm request authenticity.
 *   3. Validate the state (nonce) to prevent CSRF attacks.
 *   4. Exchange the authorization code for a permanent access token.
 *   5. Fetch shop details from Shopify API.
 *   6. Upsert the shop record in the database.
 *   7. Register required webhooks (e.g., app/uninstalled).
 *   8. Establish a session cookie.
 *   9. Redirect merchant to the embedded app dashboard.
 *
 * GET /api/auth/callback?code=...&hmac=...&shop=...&state=...&timestamp=...
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isValidShopDomain,
  getShopifyApiKey,
  getShopifyApiSecret,
  getAppUrl,
} from "@/lib/shopify/config";
import { verifyOAuthHmac } from "@/lib/shopify/crypto";
import {
  exchangeCodeForAccessToken,
  createShopifyClient,
  ShopifyApiError,
} from "@/lib/shopify/client";
import {
  upsertShopAfterOAuth,
  consumeOAuthNonce,
} from "@/lib/shopify/shop-repository";
import { setSessionShop } from "@/lib/shopify/session";
import { runFullSync } from "@/lib/sync/sync-coordinator";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  const shop = searchParams.get("shop");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const hmac = searchParams.get("hmac");
  const timestamp = searchParams.get("timestamp");

  // ── 1. Validate required parameters ─────────────────────────────────────

  if (!shop || !isValidShopDomain(shop)) {
    return errorResponse("Missing or invalid shop parameter.", 400);
  }

  if (!code) {
    return errorResponse("Missing authorization code.", 400);
  }

  if (!state) {
    return errorResponse("Missing state (nonce) parameter.", 400);
  }

  if (!hmac) {
    return errorResponse("Missing HMAC parameter.", 400);
  }

  if (!timestamp) {
    return errorResponse("Missing timestamp parameter.", 400);
  }

  // Reject requests older than 10 minutes (replay attack prevention)
  const requestAge = Date.now() / 1000 - Number(timestamp);
  if (requestAge > 600) {
    return errorResponse("Request timestamp is too old.", 401);
  }

  // ── 2. Verify HMAC signature ─────────────────────────────────────────────

  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const isHmacValid = verifyOAuthHmac(params, getShopifyApiSecret());
  if (!isHmacValid) {
    return errorResponse(
      "HMAC validation failed. Request may have been tampered.",
      401,
    );
  }

  // ── 3. Validate nonce (anti-CSRF) ────────────────────────────────────────

  try {
    const isNonceValid = await consumeOAuthNonce(state, shop);
    if (!isNonceValid) {
      return errorResponse(
        "Invalid or expired state parameter. Please retry the installation.",
        401,
      );
    }
  } catch (error) {
    console.error("[auth/callback] Nonce validation error:", error);
    return errorResponse("Internal error validating state.", 500);
  }

  // ── 4. Exchange authorization code for access token ──────────────────────

  let accessToken: string;
  let grantedScopes: string;

  try {
    const tokenResponse = await exchangeCodeForAccessToken(
      shop,
      code,
      getShopifyApiKey(),
      getShopifyApiSecret(),
    );
    accessToken = tokenResponse.access_token;
    grantedScopes = tokenResponse.scope;
  } catch (error) {
    console.error("[auth/callback] Token exchange failed:", error);
    if (error instanceof ShopifyApiError) {
      return errorResponse(
        `Shopify token exchange failed: ${error.message}`,
        502,
      );
    }
    return errorResponse("Failed to obtain access token.", 500);
  }

  // ── 5. Fetch shop details from Shopify API ───────────────────────────────

  let shopName: string;
  let shopCurrency: string;

  try {
    const client = createShopifyClient(shop, accessToken);
    const shopInfo = await client.getShop();
    shopName = shopInfo.name;
    shopCurrency = shopInfo.currency ?? "USD";
  } catch (error) {
    console.error("[auth/callback] Failed to fetch shop info:", error);
    // Non-fatal — use domain as fallback name
    shopName = shop.replace(".myshopify.com", "");
    shopCurrency = "USD";
  }

  // ── 6. Upsert shop in database ───────────────────────────────────────────

  let shopRecord: Awaited<ReturnType<typeof upsertShopAfterOAuth>>;

  try {
    shopRecord = await upsertShopAfterOAuth({
      myshopifyDomain: shop,
      name: shopName,
      currency: shopCurrency,
      accessToken,
      installedScopes: grantedScopes,
    });
  } catch (error) {
    console.error("[auth/callback] Failed to upsert shop:", error);
    return errorResponse("Failed to save shop data.", 500);
  }

  // ── 7. Register required webhooks ────────────────────────────────────────

  try {
    const client = createShopifyClient(shop, accessToken);
    const appUrl = getAppUrl();

    await client.ensureWebhook(
      "app/uninstalled",
      `${appUrl}/api/webhooks/app-uninstalled`,
    );
  } catch (error) {
    // Non-fatal — webhooks can be registered on a subsequent request
    console.warn("[auth/callback] Webhook registration failed:", error);
  }

  // ── 8. Establish session ──────────────────────────────────────────────────

  try {
    await setSessionShop({
      shop: shopRecord.myshopifyDomain,
      shopId: shopRecord.id,
    });
  } catch (error) {
    console.error("[auth/callback] Failed to establish session:", error);
    return errorResponse("Failed to create session.", 500);
  }

  // ── 9. Kick off initial full data sync (non-blocking) ────────────────────
  // We fire-and-forget the sync so the OAuth redirect completes immediately.
  // The sync runs in the background and updates shop.lastSyncedAt when done.

  void runFullSync(
    shopRecord.id,
    shopRecord.myshopifyDomain,
    accessToken,
  ).catch((err) => {
    console.error("[auth/callback] Initial full sync failed:", err);
  });

  // ── 10. Redirect to embedded app ─────────────────────────────────────────

  const host = searchParams.get("host");
  const dashboardUrl = host
    ? `/dashboard?shop=${shop}&host=${host}`
    : `/dashboard?shop=${shop}`;

  return NextResponse.redirect(new URL(dashboardUrl, request.url));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
