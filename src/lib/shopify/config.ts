/**
 * Shopify App Configuration
 *
 * Central configuration module for all Shopify-related constants.
 * Validates required environment variables at startup — fail fast.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Ensure it is set in your .env file or deployment environment.`,
    );
  }
  return value;
}

function getEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

// ---------------------------------------------------------------------------
// Shopify App constants
// ---------------------------------------------------------------------------

/** The API version ProfitLens targets. Bump intentionally during upgrades. */
export const SHOPIFY_API_VERSION = "2024-10" as const;

/** Comma-separated list of Shopify OAuth scopes required by the app. */
export const SHOPIFY_SCOPES = getEnv(
  "SHOPIFY_SCOPES",
  "read_orders,read_products,read_fulfillments,read_shipping",
);

/** Public Shopify API key (safe to expose in the browser for App Bridge). */
export function getShopifyApiKey(): string {
  return requireEnv("SHOPIFY_API_KEY");
}

/** Secret key — server-side only. Never expose to the client. */
export function getShopifyApiSecret(): string {
  return requireEnv("SHOPIFY_API_SECRET");
}

/** The publicly accessible URL of this app (used for OAuth redirect URIs). */
export function getAppUrl(): string {
  return getEnv("APP_URL", "http://localhost:3000");
}

/** The OAuth redirect URI Shopify should return to after authorization. */
export function getOAuthRedirectUri(): string {
  return `${getAppUrl()}/api/auth/callback`;
}

/** Session cookie secret for iron-session. Must be ≥ 32 chars. */
export function getSessionSecret(): string {
  return requireEnv("SESSION_SECRET");
}

// ---------------------------------------------------------------------------
// Shopify URL helpers
// ---------------------------------------------------------------------------

/** Validate that a shop domain looks like a real myshopify.com store. */
export function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop);
}

/** Build the base URL for Shopify Admin API calls. */
export function buildShopifyAdminUrl(shop: string): string {
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;
}

/** Build the Shopify OAuth authorization URL. */
export function buildOAuthAuthorizationUrl(
  shop: string,
  nonce: string,
): string {
  const params = new URLSearchParams({
    client_id: getShopifyApiKey(),
    scope: SHOPIFY_SCOPES,
    redirect_uri: getOAuthRedirectUri(),
    state: nonce,
    "grant_options[]": "value",
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}
