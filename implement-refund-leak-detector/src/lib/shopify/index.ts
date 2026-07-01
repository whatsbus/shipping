/**
 * Shopify Foundation — Public API
 *
 * Central export point for all Shopify-related utilities.
 * Import from this module to keep imports clean across the app.
 *
 * @example
 * import { createShopifyClient, requireAuth, getSessionShop } from "@/lib/shopify";
 */

// Configuration
export {
  SHOPIFY_API_VERSION,
  SHOPIFY_SCOPES,
  isValidShopDomain,
  buildShopifyAdminUrl,
  buildOAuthAuthorizationUrl,
  getShopifyApiKey,
  getShopifyApiSecret,
  getAppUrl,
  getOAuthRedirectUri,
  getSessionSecret,
} from "./config";

// Cryptographic utilities
export {
  verifyOAuthHmac,
  verifyWebhookHmac,
  verifyShopifySessionToken,
  generateNonce,
  type ShopifySessionTokenPayload,
} from "./crypto";

// Shopify API Client
export {
  ShopifyClient,
  ShopifyApiError,
  ShopifyRateLimitError,
  createShopifyClient,
  exchangeCodeForAccessToken,
  type ShopInfo,
  type ShopifyAccessTokenResponse,
} from "./client";

// Session management
export {
  getSession,
  getSessionShop,
  setSessionShop,
  destroySession,
  type ShopifySessionData,
} from "./session";

// Auth guard (route protection)
export {
  requireAuth,
  getOptionalAuth,
  type AuthContext,
} from "./auth-guard";

// Shop repository
export {
  findShopByDomain,
  findActiveShopByDomain,
  findShopById,
  upsertShopAfterOAuth,
  markShopUninstalled,
  storeOAuthNonce,
  consumeOAuthNonce,
  type Shop,
  type ShopInsert,
} from "./shop-repository";
