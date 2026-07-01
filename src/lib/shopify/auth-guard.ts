/**
 * Authentication Guard
 *
 * Provides route protection for the embedded Shopify app.
 * Call `requireAuth()` at the top of any Server Component or Route Handler
 * that must be restricted to authenticated (installed) merchants.
 *
 * Design decisions:
 * - Uses iron-session cookies for session state (not JWTs in cookies).
 * - Falls back to Shopify App Bridge `id_token` for embedded contexts.
 * - Throws redirect responses — Next.js `redirect()` is used directly,
 *   so callers don't need to handle return values.
 * - Validates that the shop is still active in the database to handle
 *   the case where a shop uninstalls between session creation and request.
 */

import { redirect } from "next/navigation";
import { getSessionShop } from "./session";
import { findActiveShopByDomain } from "./shop-repository";
import type { Shop } from "./shop-repository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthContext {
  shop: string;
  shopId: string;
  shopRecord: Shop;
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

/**
 * Require authentication for a Server Component or Route Handler.
 *
 * Checks:
 *   1. Session cookie exists and contains shop + shopId.
 *   2. The shop exists in the database and is still active (not uninstalled).
 *
 * On failure: redirects to the install page.
 * On success: returns the authenticated context.
 *
 * Usage in a Server Component:
 * ```ts
 * const auth = await requireAuth();
 * // auth.shop, auth.shopId, auth.shopRecord are all available
 * ```
 */
export async function requireAuth(): Promise<AuthContext> {
  const sessionData = await getSessionShop();

  if (!sessionData) {
    redirect("/auth/login");
  }

  const { shop, shopId } = sessionData;

  // Verify the shop is still active (handles post-uninstall requests)
  let shopRecord: Shop | null = null;
  try {
    shopRecord = await findActiveShopByDomain(shop);
  } catch (error) {
    console.error("[auth-guard] DB lookup failed:", error);
    redirect("/auth/login");
  }

  if (!shopRecord) {
    // Shop was uninstalled — clear the stale session by redirecting to install
    redirect(`/auth/login?shop=${encodeURIComponent(shop)}`);
  }

  return { shop, shopId, shopRecord };
}

/**
 * Get the current auth context without redirecting.
 * Returns null if not authenticated. Use when auth is optional.
 */
export async function getOptionalAuth(): Promise<AuthContext | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}
