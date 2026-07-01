/**
 * Shopify Admin API Client
 *
 * A reusable, strongly-typed client for the Shopify Admin REST API.
 * All methods are shop-scoped and require a valid access token.
 *
 * Design principles:
 * - Single responsibility: one method per Shopify resource type
 * - No global state: instantiated per-request with shop + access token
 * - Proper error handling: wraps fetch errors in typed errors
 * - Extensible: add new resource methods as the app grows
 *
 * Future integrations (orders, products, refunds) should add methods here.
 */

import { buildShopifyAdminUrl, SHOPIFY_API_VERSION } from "./config";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly shop: string,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

export class ShopifyRateLimitError extends ShopifyApiError {
  constructor(shop: string, endpoint: string, public readonly retryAfter: number) {
    super(`Rate limit exceeded for ${shop}`, 429, shop, endpoint);
    this.name = "ShopifyRateLimitError";
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ShopInfo {
  id: number;
  name: string;
  email: string;
  domain: string;
  myshopify_domain: string;
  currency: string;
  timezone: string;
  iana_timezone: string;
  plan_name: string;
  plan_display_name: string;
  country_name: string;
  primary_locale: string;
  address1: string;
  city: string;
  zip: string;
  province: string;
  country: string;
  phone: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

export class ShopifyClient {
  private readonly baseUrl: string;

  constructor(
    private readonly shop: string,
    private readonly accessToken: string,
  ) {
    this.baseUrl = buildShopifyAdminUrl(shop);
  }

  // -------------------------------------------------------------------------
  // Core fetch helper
  // -------------------------------------------------------------------------

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.accessToken,
        ...options.headers,
      },
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "2");
      throw new ShopifyRateLimitError(this.shop, endpoint, retryAfter);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new ShopifyApiError(
        `Shopify API error ${response.status}: ${body}`,
        response.status,
        this.shop,
        endpoint,
      );
    }

    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // Shop resource
  // -------------------------------------------------------------------------

  /** Fetch basic shop information. Useful for upsert after OAuth. */
  async getShop(): Promise<ShopInfo> {
    const data = await this.fetch<{ shop: ShopInfo }>("/shop.json");
    return data.shop;
  }

  // -------------------------------------------------------------------------
  // Webhook management
  // -------------------------------------------------------------------------

  /** Register a webhook for a given topic. Idempotent-safe via address check. */
  async registerWebhook(topic: string, address: string): Promise<void> {
    await this.fetch("/webhooks.json", {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          topic,
          address,
          format: "json",
        },
      }),
    });
  }

  /** List all webhooks currently registered for this shop. */
  async listWebhooks(): Promise<Array<{ id: number; topic: string; address: string }>> {
    const data = await this.fetch<{
      webhooks: Array<{ id: number; topic: string; address: string }>;
    }>("/webhooks.json");
    return data.webhooks;
  }

  /** Ensure a webhook is registered — registers only if not already present. */
  async ensureWebhook(topic: string, address: string): Promise<void> {
    const existing = await this.listWebhooks();
    const alreadyRegistered = existing.some(
      (wh) => wh.topic === topic && wh.address === address,
    );

    if (!alreadyRegistered) {
      await this.registerWebhook(topic, address);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a ShopifyClient instance for a given shop.
 * Prefer this factory over the constructor directly for easier mocking.
 */
export function createShopifyClient(
  shop: string,
  accessToken: string,
): ShopifyClient {
  return new ShopifyClient(shop, accessToken);
}

// ---------------------------------------------------------------------------
// OAuth token exchange
// ---------------------------------------------------------------------------

export interface ShopifyAccessTokenResponse {
  access_token: string;
  scope: string;
}

/**
 * Exchange an authorization code for a permanent access token.
 * This is server-to-server — never expose the API secret to the client.
 */
export async function exchangeCodeForAccessToken(
  shop: string,
  code: string,
  apiKey: string,
  apiSecret: string,
): Promise<ShopifyAccessTokenResponse> {
  const url = `https://${shop}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ShopifyApiError(
      `Token exchange failed ${response.status}: ${body}`,
      response.status,
      shop,
      "/admin/oauth/access_token",
    );
  }

  return response.json() as Promise<ShopifyAccessTokenResponse>;
}

// Re-export API version for convenience
export { SHOPIFY_API_VERSION };
