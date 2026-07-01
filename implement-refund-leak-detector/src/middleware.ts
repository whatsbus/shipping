/**
 * Next.js Edge Middleware — Route Protection
 *
 * Intercepts requests to protected app routes and verifies the session cookie.
 * Redirects unauthenticated users to the login/install page.
 *
 * Protected routes: /dashboard, /findings, /billing, /settings
 * Public routes:    /, /auth/*, /api/auth/*, /api/webhooks/*, /api/health
 *
 * Architecture note:
 * - This middleware runs at the Edge (before the Node.js runtime).
 * - iron-session decryption requires the Node.js crypto module, which is
 *   NOT available at the Edge. Therefore, we do a lightweight cookie
 *   presence check here and rely on the Server Component auth-guard for
 *   full validation (including database checks).
 *
 * This two-layer approach is intentional:
 * 1. Middleware: fast edge redirect for users with no session cookie at all.
 * 2. auth-guard.ts: full server-side validation including DB lookup.
 */

import { NextRequest, NextResponse } from "next/server";

// Routes that require authentication
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/findings",
  "/billing",
  "/settings",
];

// Routes that are always public
const PUBLIC_PREFIXES = [
  "/",
  "/api/health",
  "/api/auth/",
  "/api/webhooks/",
  "/auth/",
  "/_next/",
  "/favicon.ico",
  "/robots.txt",
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Check if this is a protected route
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  // Check for session cookie presence (lightweight — no decryption at edge)
  const sessionCookie = request.cookies.get("profitlens_session");

  if (!sessionCookie?.value) {
    // No session cookie — redirect to login
    const loginUrl = new URL("/auth/login", request.url);

    // Preserve shop param if available (from Shopify embedded context)
    const shop = request.nextUrl.searchParams.get("shop");
    if (shop) {
      loginUrl.searchParams.set("shop", shop);
    }

    return NextResponse.redirect(loginUrl);
  }

  // Session cookie is present — proceed to the route.
  // The Server Component will perform full validation via auth-guard.ts.
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, robots.txt, sitemap.xml
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
