/**
 * Session management for Shopify embedded app authentication.
 *
 * Uses iron-session for encrypted, tamper-proof HTTP-only cookies.
 * The session stores the authenticated shop's domain and DB id after
 * successful OAuth, and is validated on every protected route.
 *
 * iron-session encrypts the cookie payload with AES-256-CBC.
 */

import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";
import { getSessionSecret } from "./config";

// ---------------------------------------------------------------------------
// Session data shape
// ---------------------------------------------------------------------------

export interface ShopifySessionData {
  /**
   * The myshopify.com domain of the authenticated shop.
   * e.g. "my-store.myshopify.com"
   */
  shop: string;

  /**
   * The internal UUID primary key for this shop in our `shops` table.
   */
  shopId: string;
}

// ---------------------------------------------------------------------------
// iron-session options
// ---------------------------------------------------------------------------

function getSessionOptions() {
  return {
    cookieName: "profitlens_session",
    password: getSessionSecret(),
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  };
}

// ---------------------------------------------------------------------------
// Session helpers (Server Components / Route Handlers)
// ---------------------------------------------------------------------------

/**
 * Get the current iron-session from the incoming request cookies.
 * Call this in Server Components, Route Handlers, and Server Actions.
 */
export async function getSession(): Promise<IronSession<ShopifySessionData>> {
  const cookieStore = await cookies();
  return getIronSession<ShopifySessionData>(cookieStore, getSessionOptions());
}

/**
 * Read the current shop from the session.
 * Returns null if the user has no valid session.
 */
export async function getSessionShop(): Promise<ShopifySessionData | null> {
  const session = await getSession();
  if (!session.shop || !session.shopId) return null;
  return { shop: session.shop, shopId: session.shopId };
}

/**
 * Write shop credentials into the session and persist the cookie.
 */
export async function setSessionShop(data: ShopifySessionData): Promise<void> {
  const session = await getSession();
  session.shop = data.shop;
  session.shopId = data.shopId;
  await session.save();
}

/**
 * Destroy the current session (logout / uninstall).
 */
export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
  await session.save();
}
