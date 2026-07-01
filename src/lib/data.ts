import { db } from "@/db";
import {
  shops,
  findings,
  findingEvidence,
  billingSubscriptions,
  shopSettings,
} from "@/db/schema";
import { eq, desc, and, asc } from "drizzle-orm";
import { getSessionShop } from "@/lib/shopify/session";

/**
 * ProfitLens is a multi-tenant embedded Shopify app.
 *
 * `getCurrentShop()` resolves the current merchant from the iron-session cookie
 * that is set during the Shopify OAuth flow (see /api/auth/callback).
 *
 * Falls back to the first shop in the database for local development when
 * running with seeded data and no active session. In production all routes are
 * gated by `requireAuth()` in the app layout, so the fallback never fires.
 */
export async function getCurrentShop() {
  // Prefer the session-authenticated shop (set by OAuth callback)
  const sessionData = await getSessionShop();

  if (sessionData?.shopId) {
    const [shop] = await db
      .select()
      .from(shops)
      .where(eq(shops.id, sessionData.shopId))
      .limit(1);

    if (shop) return shop;
  }

  // Development fallback — first shop in the DB (seeded data)
  const [shop] = await db.select().from(shops).limit(1);
  if (!shop) {
    throw new Error(
      "No shop connected yet. Run `npx tsx src/db/seed.ts` to seed demo data or install the app via OAuth.",
    );
  }
  return shop;
}

/**
 * Get a specific shop by ID. Used in authenticated routes where
 * the shopId is known from the session.
 */
export async function getShopById(shopId: string) {
  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }
  return shop;
}

export async function getFindingsForShop(shopId: string) {
  return db
    .select()
    .from(findings)
    .where(eq(findings.shopId, shopId))
    .orderBy(desc(findings.monthlyImpact));
}

export async function getFindingById(shopId: string, findingId: string) {
  const [finding] = await db
    .select()
    .from(findings)
    .where(and(eq(findings.shopId, shopId), eq(findings.id, findingId)))
    .limit(1);

  if (!finding) return null;

  const evidence = await db
    .select()
    .from(findingEvidence)
    .where(eq(findingEvidence.findingId, finding.id))
    .orderBy(asc(findingEvidence.occurredAt));

  // Strip the internal fingerprint marker stored as rootCauses[0]
  // (format: "__fp:<fingerprint>") before returning to the UI.
  const rootCauses = Array.isArray(finding.rootCauses)
    ? (finding.rootCauses as string[]).filter((c) => !c.startsWith("__fp:"))
    : finding.rootCauses;

  return { finding: { ...finding, rootCauses }, evidence };
}

export async function getBillingForShop(shopId: string) {
  const [subscription] = await db
    .select()
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.shopId, shopId))
    .limit(1);
  return subscription ?? null;
}

export async function getSettingsForShop(shopId: string) {
  const [settings] = await db
    .select()
    .from(shopSettings)
    .where(eq(shopSettings.shopId, shopId))
    .limit(1);
  return settings ?? null;
}

export type ShopMetrics = {
  activeMonthlyLeak: number;
  annualizedLeak: number;
  recoveredToDate: number;
  activeFindingsCount: number;
  criticalFindingsCount: number;
};

export function computeShopMetrics(
  allFindings: Awaited<ReturnType<typeof getFindingsForShop>>,
): ShopMetrics {
  let activeMonthlyLeak = 0;
  let recoveredToDate = 0;
  let activeFindingsCount = 0;
  let criticalFindingsCount = 0;

  for (const finding of allFindings) {
    const isActive = finding.status === "new" || finding.status === "investigating";
    if (isActive) {
      activeMonthlyLeak += Number(finding.monthlyImpact);
      activeFindingsCount += 1;
      if (finding.severity === "critical") criticalFindingsCount += 1;
    }
    recoveredToDate += Number(finding.recoveredAmount);
  }

  return {
    activeMonthlyLeak,
    annualizedLeak: activeMonthlyLeak * 12,
    recoveredToDate,
    activeFindingsCount,
    criticalFindingsCount,
  };
}
