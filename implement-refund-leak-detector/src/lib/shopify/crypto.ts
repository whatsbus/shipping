/**
 * Shopify Cryptographic Utilities
 *
 * All HMAC verification helpers live here:
 * - OAuth query-param HMAC (hex-encoded, SHA-256)
 * - Webhook payload HMAC (base64-encoded, SHA-256)
 *
 * Uses Node.js built-in `crypto` — no third-party dependencies.
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// OAuth HMAC Verification
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC signature of an OAuth redirect from Shopify.
 *
 * Shopify signs OAuth query parameters with HMAC-SHA256 using your API secret
 * and encodes the result as a lowercase hex string.
 *
 * Algorithm:
 *   1. Remove `hmac` from the query parameters.
 *   2. Sort remaining parameters alphabetically by key.
 *   3. Build the message as `key=value&key=value` (sorted).
 *   4. Compute HMAC-SHA256 using the API secret.
 *   5. Compare using timing-safe equality.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant/implement-authorization-code-grant#verify-the-request
 */
export function verifyOAuthHmac(
  queryParams: Record<string, string>,
  apiSecret: string,
): boolean {
  const { hmac, signature: _sig, ...rest } = queryParams;

  if (!hmac) return false;

  // Sort params alphabetically and build the message string
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("&");

  const generatedHash = crypto
    .createHmac("sha256", apiSecret)
    .update(message)
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    const hmacBuffer = Buffer.from(hmac, "utf-8");
    const generatedBuffer = Buffer.from(generatedHash, "utf-8");

    if (hmacBuffer.length !== generatedBuffer.length) return false;
    return crypto.timingSafeEqual(hmacBuffer, generatedBuffer);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Webhook HMAC Verification
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC signature of a Shopify webhook payload.
 *
 * Shopify signs the raw request body with HMAC-SHA256 using your API secret
 * and sends the result as a base64-encoded header: `X-Shopify-Hmac-SHA256`.
 *
 * IMPORTANT: Must receive the raw (unparsed) request body bytes.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/secure-webhooks
 */
export function verifyWebhookHmac(
  rawBody: Buffer | string,
  hmacHeader: string,
  apiSecret: string,
): boolean {
  if (!hmacHeader) return false;

  const generatedHash = crypto
    .createHmac("sha256", apiSecret)
    .update(rawBody)
    .digest("base64");

  try {
    const headerBuffer = Buffer.from(hmacHeader, "utf-8");
    const generatedBuffer = Buffer.from(generatedHash, "utf-8");

    if (headerBuffer.length !== generatedBuffer.length) return false;
    return crypto.timingSafeEqual(headerBuffer, generatedBuffer);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Nonce generation
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure random nonce for OAuth state parameter.
 * Used to prevent CSRF attacks during the OAuth flow.
 */
export function generateNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Shopify Session Token (JWT) Verification
// ---------------------------------------------------------------------------

/**
 * Decode and verify a Shopify session token (JWT) sent by App Bridge.
 *
 * The token is a standard JWT signed with HMAC-SHA256 using your API secret.
 * App Bridge sends it in the `Authorization: Bearer <token>` header.
 *
 * Returns the decoded payload or null if verification fails.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens/getting-started
 */
export function verifyShopifySessionToken(
  token: string,
  apiSecret: string,
): ShopifySessionTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = crypto
      .createHmac("sha256", apiSecret)
      .update(signingInput)
      .digest("base64url");

    const sigBuffer = Buffer.from(signatureB64, "base64url");
    const expectedBuffer = Buffer.from(expectedSig, "base64url");

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as ShopifySessionTokenPayload;

    // Validate expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now) return null;

    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShopifySessionTokenPayload {
  /** Issuer — the shop's myshopify.com domain with https:// */
  iss: string;
  /** Destination — the shop's admin URL */
  dest: string;
  /** Audience — the app's API key */
  aud: string;
  /** Subject — the user's global ID */
  sub: string;
  /** Expiration timestamp (seconds) */
  exp: number;
  /** Not before timestamp (seconds) */
  nbf: number;
  /** Issued at timestamp (seconds) */
  iat: number;
  /** JWT ID — unique per token */
  jti: string;
  /** Session ID (if present) */
  sid?: string;
}
