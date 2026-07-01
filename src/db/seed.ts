import "dotenv/config";
import { db, pool } from "@/db";
import {
  shops,
  findings,
  findingEvidence,
  billingSubscriptions,
  shopSettings,
} from "@/db/schema";

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function hoursAgo(n: number) {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

async function main() {
  console.log("Seeding ProfitLens demo data...");

  const existing = await db.select().from(shops).limit(1);
  if (existing.length > 0) {
    console.log("Shop already exists, skipping seed. (id: " + existing[0].id + ")");
    await pool.end();
    return;
  }

  const [shop] = await db
    .insert(shops)
    .values({
      name: "Lumen & Co",
      myshopifyDomain: "lumen-and-co.myshopify.com",
      currency: "USD",
      monthlyOrderVolume: 1240,
      connectedAt: daysAgo(146),
      lastSyncedAt: hoursAgo(1),
    })
    .returning();

  await db.insert(billingSubscriptions).values({
    shopId: shop.id,
    planName: "growth",
    status: "active",
    priceMonthly: "129.00",
    trialEndsAt: daysAgo(132),
    currentPeriodEnd: daysAgo(-18),
    recoveredAmountToDate: "4200.00",
  });

  await db.insert(shopSettings).values({
    shopId: shop.id,
    notificationEmail: "ops@lumenandco.com",
    weeklyDigestEnabled: true,
    instantAlertsEnabled: true,
    alertThreshold: "100.00",
    refundLeakEnabled: true,
    shippingLeakEnabled: true,
  });

  type SeedFinding = {
    detectorType: "refund_leak" | "shipping_leak";
    severity: "critical" | "warning" | "info";
    status: "new" | "investigating" | "resolved" | "ignored";
    title: string;
    summary: string;
    explanation: string;
    rootCauses: string[];
    recommendation: string;
    recommendationSteps: string[];
    monthlyImpact: string;
    impactToDate: string;
    recoveredAmount: string;
    confidence: number;
    affectedOrdersCount: number;
    firstDetectedAt: Date;
    lastDetectedAt: Date;
    resolvedAt: Date | null;
    evidence: { orderNumber: string; occurredAt: Date; amount: string; note: string }[];
  };

  const seedFindings: SeedFinding[] = [
    {
      detectorType: "shipping_leak",
      severity: "critical",
      status: "new",
      title: "Canada orders are shipped at a loss",
      summary:
        "You charge a flat $9 for shipping to Canada, but actual carrier cost averages $15.40 — a $6.40 loss on every order.",
      explanation:
        "Across the last 60 days, 58 orders shipped to Canadian addresses. Your checkout charges a flat $9.00 shipping rate regardless of destination, but your actual carrier invoices for these zones average $15.40 per package. That gap is paid out of your margin on every single Canadian order, and volume to this region has grown 22% quarter over quarter.",
      rootCauses: [
        "Flat-rate shipping doesn't account for cross-border carrier zones",
        "Canada carrier rates increased 18% since your rate table was last updated",
        "No weight-based or zone-based surcharge applied at checkout",
      ],
      recommendation:
        "Introduce a Canada-specific shipping rate (or surcharge) that reflects real carrier cost, and pass a portion of the increase to customers.",
      recommendationSteps: [
        "Add a Canada shipping zone in Shopify Settings → Shipping and delivery",
        "Set the rate to at least $14.50 to break even on current carrier costs",
        "Consider a $65 free-shipping threshold for Canada to protect margin on small orders",
        "Re-check carrier invoices monthly — rates change more often than checkout rates",
      ],
      monthlyImpact: "1860.00",
      impactToDate: "7440.00",
      recoveredAmount: "0.00",
      confidence: 95,
      affectedOrdersCount: 58,
      firstDetectedAt: daysAgo(34),
      lastDetectedAt: hoursAgo(6),
      resolvedAt: null,
      evidence: [
        { orderNumber: "#10482", occurredAt: daysAgo(3), amount: "6.40", note: "Toronto, ON · charged $9.00, carrier cost $15.40" },
        { orderNumber: "#10471", occurredAt: daysAgo(6), amount: "7.10", note: "Vancouver, BC · charged $9.00, carrier cost $16.10" },
        { orderNumber: "#10455", occurredAt: daysAgo(9), amount: "5.90", note: "Calgary, AB · charged $9.00, carrier cost $14.90" },
        { orderNumber: "#10439", occurredAt: daysAgo(14), amount: "6.75", note: "Ottawa, ON · charged $9.00, carrier cost $15.75" },
        { orderNumber: "#10412", occurredAt: daysAgo(21), amount: "6.20", note: "Montreal, QC · charged $9.00, carrier cost $15.20" },
      ],
    },
    {
      detectorType: "refund_leak",
      severity: "critical",
      status: "new",
      title: "Scented Candle Trio has a runaway refund rate",
      summary:
        "18.4% of orders containing the Scented Candle Trio are refunded — nearly 4x your store average of 4.9%.",
      explanation:
        "Over the trailing 90 days, 34 of 185 orders containing the Scented Candle Trio (SKU CN-TRIO-03) were refunded, an 18.4% refund rate versus a 4.9% store-wide average. Refund reasons overwhelmingly cite \"item arrived broken\" (26 of 34), pointing to a packaging or fulfillment defect rather than buyer's remorse. Each refund also forfeits the original outbound shipping cost, compounding the loss.",
      rootCauses: [
        "26 of 34 refunds cite breakage during transit",
        "Product ships in single-wall packaging with no void fill",
        "No quality hold or repack process for this SKU since a Q3 supplier change",
      ],
      recommendation:
        "Fix the packaging defect at the source and add a temporary quality gate for this SKU before it keeps bleeding margin.",
      recommendationSteps: [
        "Switch to double-wall packaging with void fill for CN-TRIO-03 shipments",
        "Add a manual quality check for this SKU until the breakage rate normalizes",
        "Reach out to the Q3 supplier about glass wall thickness tolerances",
        "Monitor refund rate weekly — target back under 6% within 30 days",
      ],
      monthlyImpact: "1240.00",
      impactToDate: "4960.00",
      recoveredAmount: "0.00",
      confidence: 92,
      affectedOrdersCount: 34,
      firstDetectedAt: daysAgo(41),
      lastDetectedAt: hoursAgo(3),
      resolvedAt: null,
      evidence: [
        { orderNumber: "#10476", occurredAt: daysAgo(2), amount: "38.00", note: "\"Two candles arrived shattered\" · refunded in full" },
        { orderNumber: "#10460", occurredAt: daysAgo(7), amount: "38.00", note: "\"Jar cracked in transit\" · refunded in full" },
        { orderNumber: "#10448", occurredAt: daysAgo(11), amount: "38.00", note: "\"Broken on arrival\" · refunded in full" },
        { orderNumber: "#10429", occurredAt: daysAgo(17), amount: "38.00", note: "\"Wax spilled, jar chipped\" · refunded in full" },
        { orderNumber: "#10401", occurredAt: daysAgo(25), amount: "38.00", note: "\"Damaged box, broken candle\" · refunded in full" },
      ],
    },
    {
      detectorType: "shipping_leak",
      severity: "warning",
      status: "investigating",
      title: "Free-shipping threshold erodes margin on small orders",
      summary:
        "42% of orders under $50 qualify for free shipping, costing $940/mo more than the margin those orders generate.",
      explanation:
        "Your free-shipping threshold is set at $45. Orders between $30–$45 carry an average product margin of $11.20, but average outbound shipping cost for these lightweight orders is $8.60 — leaving only $2.60 of margin before payment fees, packaging, and labor. 46 orders per month fall into this band, meaning the current threshold is subsidizing shipping on orders that were barely profitable to begin with.",
      rootCauses: [
        "Free-shipping threshold ($45) sits below break-even order value (~$62)",
        "No shipping charge recovery on low-margin, low-AOV orders",
        "Threshold hasn't been revisited since carrier rates last increased",
      ],
      recommendation:
        "Raise the free-shipping threshold to align with your actual break-even order value, or exclude low-margin SKUs from the promotion.",
      recommendationSteps: [
        "Raise free-shipping threshold from $45 to $60–65",
        "A/B test the new threshold for 2 weeks before rolling out store-wide",
        "Add a shipping cost line for orders that don't qualify, instead of an unconditional flat rate",
      ],
      monthlyImpact: "940.00",
      impactToDate: "2820.00",
      recoveredAmount: "0.00",
      confidence: 84,
      affectedOrdersCount: 46,
      firstDetectedAt: daysAgo(28),
      lastDetectedAt: hoursAgo(10),
      resolvedAt: null,
      evidence: [
        { orderNumber: "#10467", occurredAt: daysAgo(4), amount: "6.10", note: "$32.00 order · free shipping · carrier cost $8.60" },
        { orderNumber: "#10452", occurredAt: daysAgo(8), amount: "5.40", note: "$38.50 order · free shipping · carrier cost $8.10" },
        { orderNumber: "#10437", occurredAt: daysAgo(13), amount: "6.60", note: "$29.00 order · free shipping · carrier cost $8.90" },
        { orderNumber: "#10418", occurredAt: daysAgo(19), amount: "5.90", note: "$41.00 order · free shipping · carrier cost $8.30" },
      ],
    },
    {
      detectorType: "refund_leak",
      severity: "warning",
      status: "investigating",
      title: "Refunds processed without restocking returned inventory",
      summary:
        "21 refunds over 60 days show items marked \"returned\" that were never restocked, quietly shrinking usable inventory.",
      explanation:
        "When a return is marked received, Shopify expects inventory to be restocked so the item can be resold. 21 refunded orders in the last 60 days were flagged as returned but the inventory was never added back — meaning you both refunded the customer and are carrying a phantom inventory shortfall. At average unit cost, this represents $610/mo in stranded, unsellable value.",
      rootCauses: [
        "Manual restock step is skipped when refunds are processed quickly",
        "No automated restock trigger configured in Shopify returns workflow",
        "Returns handled by multiple staff with inconsistent processes",
      ],
      recommendation:
        "Automate inventory restocking as part of the returns workflow so no refund can close without an explicit restock decision.",
      recommendationSteps: [
        "Enable automatic restocking on approved returns in Shopify Settings → Returns",
        "Audit the 21 open cases and manually restock recoverable items",
        "Set up a weekly returns reconciliation report to catch future gaps",
      ],
      monthlyImpact: "610.00",
      impactToDate: "1220.00",
      recoveredAmount: "0.00",
      confidence: 78,
      affectedOrdersCount: 21,
      firstDetectedAt: daysAgo(19),
      lastDetectedAt: hoursAgo(18),
      resolvedAt: null,
      evidence: [
        { orderNumber: "#10458", occurredAt: daysAgo(5), amount: "29.00", note: "Return received, inventory not restocked · $29 unit cost" },
        { orderNumber: "#10443", occurredAt: daysAgo(10), amount: "29.00", note: "Return received, inventory not restocked · $29 unit cost" },
        { orderNumber: "#10431", occurredAt: daysAgo(15), amount: "54.00", note: "Return received, inventory not restocked · $54 unit cost" },
        { orderNumber: "#10409", occurredAt: daysAgo(22), amount: "29.00", note: "Return received, inventory not restocked · $29 unit cost" },
      ],
    },
    {
      detectorType: "refund_leak",
      severity: "info",
      status: "resolved",
      title: "Repeat refunders absorbing disproportionate refund spend",
      summary:
        "8 customers account for 31% of all refunds over the past 90 days, with at least 3 refunds each.",
      explanation:
        "A small cohort of customers — 8 individuals — collectively received 28 refunds in the last 90 days, representing 31% of all refund spend despite being less than 0.4% of your customer base. Two customers have received refunds on 5 of their last 6 orders. While each individual refund may have been legitimate, the pattern suggests policy exploitation or an outsized sensitivity to product defects for specific segments.",
      rootCauses: [
        "No refund frequency cap or review trigger in current return policy",
        "Support team approves refunds on a per-order basis without customer history context",
        "No flagging for customers with >2 refunds in a rolling 90-day window",
      ],
      recommendation:
        "Add a soft flag to customer profiles that have exceeded 2 refunds in 90 days so support can review before approving the next one.",
      recommendationSteps: [
        "Tag repeat-refunder profiles in Shopify (manual or via a flow)",
        "Route refund requests from flagged profiles to a senior support review queue",
        "Set a policy maximum of 3 full refunds per customer per year; offer store credit on subsequent requests",
      ],
      monthlyImpact: "420.00",
      impactToDate: "1260.00",
      recoveredAmount: "420.00",
      confidence: 71,
      affectedOrdersCount: 28,
      firstDetectedAt: daysAgo(62),
      lastDetectedAt: daysAgo(14),
      resolvedAt: daysAgo(7),
      evidence: [
        { orderNumber: "#10322", occurredAt: daysAgo(18), amount: "52.00", note: "Customer C-8821 · refund #4 of 5 in 90 days" },
        { orderNumber: "#10291", occurredAt: daysAgo(26), amount: "38.00", note: "Customer C-8821 · refund #3 of 5 in 90 days" },
        { orderNumber: "#10255", occurredAt: daysAgo(38), amount: "52.00", note: "Customer C-4417 · refund #3 of 4 in 90 days" },
        { orderNumber: "#10214", occurredAt: daysAgo(51), amount: "38.00", note: "Customer C-8821 · refund #2 of 5 in 90 days" },
      ],
    },
    {
      detectorType: "shipping_leak",
      severity: "info",
      status: "ignored",
      title: "Express shipping upgrades not recouping carrier surcharges",
      summary:
        "Customers paying for express shipping are charged $18, but the average carrier cost for express delivery is $22.10.",
      explanation:
        "Your express shipping option charges customers a flat $18, but actual carrier costs for express shipments (which include fuel surcharges and residential delivery fees) average $22.10 — a $4.10 gap on every express order. 19 express orders were placed last month, costing approximately $78 more than collected. While small in absolute terms, the gap widens as carrier surcharges increase each quarter.",
      rootCauses: [
        "Express shipping rate hasn't been updated since carrier surcharge increase",
        "Fuel and residential delivery surcharges not factored into checkout rate",
      ],
      recommendation:
        "Raise the express shipping rate from $18 to at least $23 to cover current carrier surcharges.",
      recommendationSteps: [
        "Update express shipping rate in Shopify Settings → Shipping and delivery",
        "Review carrier invoice line items monthly to catch surcharge changes early",
      ],
      monthlyImpact: "78.00",
      impactToDate: "312.00",
      recoveredAmount: "0.00",
      confidence: 89,
      affectedOrdersCount: 19,
      firstDetectedAt: daysAgo(55),
      lastDetectedAt: daysAgo(4),
      resolvedAt: null,
      evidence: [
        { orderNumber: "#10474", occurredAt: daysAgo(4), amount: "4.10", note: "Express · charged $18.00, carrier cost $22.10" },
        { orderNumber: "#10456", occurredAt: daysAgo(9), amount: "4.10", note: "Express · charged $18.00, carrier cost $22.10" },
        { orderNumber: "#10438", occurredAt: daysAgo(14), amount: "4.10", note: "Express · charged $18.00, carrier cost $22.10" },
      ],
    },
  ];

  for (const seedFinding of seedFindings) {
    const { evidence, ...findingData } = seedFinding;

    const [inserted] = await db
      .insert(findings)
      .values({
        shopId: shop.id,
        ...findingData,
      })
      .returning();

    if (evidence.length > 0) {
      await db.insert(findingEvidence).values(
        evidence.map((e) => ({
          findingId: inserted.id,
          ...e,
        })),
      );
    }
  }

  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
