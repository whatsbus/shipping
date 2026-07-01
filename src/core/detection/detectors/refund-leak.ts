/**
 * Refund Leak Detector
 *
 * Analyses synchronized Shopify data to surface five categories of
 * refund-related profit leaks:
 *
 *   1. Unusually high store-wide refund rate
 *   2. Products with repeated / elevated refund rates
 *   3. Customers with excessive refunds
 *   4. Abnormally large individual refund amounts
 *   5. Repeated refund patterns (same order refunded multiple times)
 *
 * Architecture notes:
 * - Implements IDetector — registered via defaultRegistry in setup.ts.
 * - Does NOT access the database. All data arrives via context.meta.refundData
 *   (loaded by src/core/detection/refund-data-loader.ts before the engine runs).
 * - Does NOT throw. All errors are caught and returned as status "error".
 * - Is fully idempotent: same context → same findings.
 * - Persists nothing. The persistence layer (findings-repository.ts) handles
 *   that after the engine run completes.
 */

import type { IDetector, DetectorContext, DetectorResult } from "../types";
import type {
  RefundData,
  RefundOrderRow,
  RefundProductRow,
  RefundCustomerRow,
} from "../refund-data-loader";
import type {
  RefundLeakPayload,
  FindingCandidate,
  FindingEvidenceItem,
} from "../finding-payload";

// ---------------------------------------------------------------------------
// Thresholds — tunable constants
// ---------------------------------------------------------------------------

/** Minimum number of orders before the store-wide rate check fires */
const MIN_ORDERS_FOR_STORE_RATE = 20;

/** Store-wide refund rate that triggers a "high refund rate" finding */
const HIGH_REFUND_RATE_THRESHOLD = 0.08; // 8%

/** Minimum number of orders for a product to be evaluated */
const MIN_PRODUCT_ORDERS = 5;

/** Product refund rate that triggers a finding */
const HIGH_PRODUCT_REFUND_RATE = 0.10; // 10%

/**
 * How many multiples of the store average rate a product must exceed
 * to be flagged (avoids flagging a product with 2/3 orders = 67%).
 */
const PRODUCT_RATE_STORE_MULTIPLE = 2.0;

/** Minimum number of refund events for a customer to be evaluated */
const MIN_CUSTOMER_REFUNDS = 3;

/** Customer total refund amount that triggers an "excessive refunds" finding */
const HIGH_CUSTOMER_REFUND_AMOUNT_THRESHOLD = 200; // currency units

/**
 * Customer refund rate (refunded orders / total orders) above which
 * we flag even lower-volume customers.
 */
const HIGH_CUSTOMER_REFUND_RATE = 0.40; // 40%

/** Minimum per-refund amount to be considered "abnormally large" */
const LARGE_REFUND_AMOUNT_THRESHOLD = 500; // currency units

/**
 * A refund must be ≥ this multiple of the store's average refund amount
 * to be flagged as "abnormally large".
 */
const LARGE_REFUND_AMOUNT_STORE_MULTIPLE = 3.0;

/**
 * Minimum number of distinct refunds on the same order to flag as
 * a "repeated refund pattern".
 */
const REPEATED_ORDER_REFUNDS_THRESHOLD = 2;

/**
 * Minimum number of orders that each had multiple refunds before we generate
 * a finding (guards against one-off anomalies).
 */
const MIN_REPEATED_REFUND_ORDERS = 2;

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

// ---------------------------------------------------------------------------
// RefundLeakDetector
// ---------------------------------------------------------------------------

export class RefundLeakDetector implements IDetector {
  readonly type = "refund_leak" as const;
  readonly name = "Refund Leak Detector";

  async run(context: DetectorContext): Promise<DetectorResult> {
    const start = Date.now();

    try {
      // ── Guard: data must be pre-loaded and injected via meta ──────────────
      const refundData = context.meta.refundData as RefundData | undefined;

      if (!refundData) {
        return {
          detectorType: this.type,
          status: "skipped",
          anomaliesFound: false,
          message:
            "No refundData in context.meta. Load data with loadRefundData() before running the engine.",
          durationMs: Date.now() - start,
        };
      }

      const { storeStats } = refundData;

      // ── Guard: minimum data requirements ──────────────────────────────────
      if (storeStats.totalOrders < MIN_ORDERS_FOR_STORE_RATE) {
        return {
          detectorType: this.type,
          status: "skipped",
          anomaliesFound: false,
          message:
            `Insufficient data: only ${storeStats.totalOrders} orders ` +
            `(minimum ${MIN_ORDERS_FOR_STORE_RATE} required).`,
          durationMs: Date.now() - start,
        };
      }

      // ── Run all sub-checks ────────────────────────────────────────────────
      const findingCandidates: FindingCandidate[] = [];

      const storeRateFinding = this.checkHighStoreRefundRate(refundData);
      if (storeRateFinding) findingCandidates.push(storeRateFinding);

      const productFindings = this.checkHighProductRefundRates(refundData);
      findingCandidates.push(...productFindings);

      const customerFindings = this.checkExcessiveCustomerRefunds(refundData);
      findingCandidates.push(...customerFindings);

      const largeRefundFindings = this.checkAbnormallyLargeRefunds(refundData);
      findingCandidates.push(...largeRefundFindings);

      const patternFinding = this.checkRepeatedRefundPatterns(refundData);
      if (patternFinding) findingCandidates.push(patternFinding);

      const anomaliesFound = findingCandidates.length > 0;
      const payload: RefundLeakPayload = { findings: findingCandidates };

      return {
        detectorType: this.type,
        status: "ok",
        anomaliesFound,
        message: anomaliesFound
          ? `Found ${findingCandidates.length} refund leak issue(s): ` +
            findingCandidates.map((f) => f.title).join("; ")
          : "No refund leak anomalies detected.",
        durationMs: Date.now() - start,
        payload,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        detectorType: this.type,
        status: "error",
        anomaliesFound: false,
        message: `Detector error: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  // ── Sub-check 1: Unusually high store-wide refund rate ────────────────────

  private checkHighStoreRefundRate(data: RefundData): FindingCandidate | null {
    const { storeStats } = data;

    if (storeStats.overallRefundRate < HIGH_REFUND_RATE_THRESHOLD) return null;

    const rate = storeStats.overallRefundRate;
    const ratePercent = (rate * 100).toFixed(1);
    const benchmarkPercent = (HIGH_REFUND_RATE_THRESHOLD * 100).toFixed(0);
    const monthlyImpact = storeStats.avgMonthlyRefundAmount;
    const totalImpact = storeStats.totalRefundAmount;

    // Confidence scales with how far above threshold we are
    const confidence = Math.min(
      95,
      Math.round(75 + (rate - HIGH_REFUND_RATE_THRESHOLD) * 200),
    );

    // Evidence: most recent refunds with non-zero amounts
    const evidence: FindingEvidenceItem[] = data.refunds
      .filter((r) => r.totalRefunded > 0)
      .sort((a, b) => b.refundCreatedAt.getTime() - a.refundCreatedAt.getTime())
      .slice(0, 8)
      .map((r) => ({
        orderNumber: r.orderName,
        occurredAt: r.refundCreatedAt,
        amount: r.totalRefunded,
        note: buildRefundNote(r),
      }));

    return {
      fingerprint: "high_store_refund_rate",
      severity: rate >= 0.15 ? "critical" : "warning",
      title: `Store-wide refund rate is ${ratePercent}% — above healthy threshold`,
      summary:
        `${ratePercent}% of your orders are being refunded, compared to the healthy ` +
        `benchmark of under ${benchmarkPercent}%. This is eroding revenue across the board.`,
      explanation:
        `Over your recorded order history, ${storeStats.totalRefundedOrders} out of ` +
        `${storeStats.totalOrders} orders (${ratePercent}%) have resulted in at least one refund. ` +
        `The healthy industry benchmark for e-commerce refund rates is under ${benchmarkPercent}%. ` +
        `At your current volume, this translates to roughly ${formatMoney(monthlyImpact)} in refunded revenue every month. ` +
        `Without addressing root causes, this compounds to ${formatMoney(totalImpact)} lost to date.`,
      rootCauses: [
        "Product quality issues leading to customer dissatisfaction",
        "Misleading product descriptions or images causing expectation mismatch",
        "Fulfillment errors (wrong items shipped, damaged packaging)",
        "Overly permissive refund policy being exploited",
      ],
      recommendation:
        "Investigate the most common refund reasons in your Shopify admin. " +
        "Focus on product-level patterns first — a single SKU with high breakage or " +
        "description issues can skew the entire store rate.",
      recommendationSteps: [
        "Pull a refund reasons report from Shopify Admin → Analytics → Reports",
        "Identify the top 3 SKUs by refund count and review customer-facing descriptions",
        "Audit packaging for fragile items and compare against carrier damage reports",
        "Review your refund policy — add a restocking fee for opened/used items if appropriate",
        "Set a monthly refund rate alert at 6% in Shopify or your analytics tool",
      ],
      monthlyImpact,
      totalImpact,
      affectedOrdersCount: storeStats.totalRefundedOrders,
      confidence,
      evidence,
    };
  }

  // ── Sub-check 2: Products with repeated refunds ────────────────────────────

  private checkHighProductRefundRates(
    data: RefundData,
  ): FindingCandidate[] {
    const { productRefunds, storeStats } = data;
    const result: FindingCandidate[] = [];
    const storeAvgRate = storeStats.overallRefundRate;

    const windowMonths = computeWindowMonths(storeStats);

    for (const product of productRefunds) {
      // Skip products with too few orders to be statistically meaningful
      if (product.totalOrders < MIN_PRODUCT_ORDERS) continue;

      // Must exceed both the absolute threshold AND a multiple of store average
      if (product.refundRate < HIGH_PRODUCT_REFUND_RATE) continue;
      if (
        storeAvgRate > 0 &&
        product.refundRate < storeAvgRate * PRODUCT_RATE_STORE_MULTIPLE
      )
        continue;

      const ratePercent = (product.refundRate * 100).toFixed(1);
      const storeRatePercent = (storeAvgRate * 100).toFixed(1);
      const monthlyImpact = product.totalRefunded / windowMonths;
      const skuLabel = product.sku ? ` (SKU: ${product.sku})` : "";

      const confidence = Math.min(
        92,
        Math.round(
          60 +
            Math.min(product.refundCount, 30) * 1.0 +
            (product.refundRate - HIGH_PRODUCT_REFUND_RATE) * 100,
        ),
      );

      const storeMultiple =
        storeAvgRate > 0
          ? (product.refundRate / storeAvgRate).toFixed(1)
          : "–";

      // Build evidence from most recent refunds
      const evidence = this.buildProductEvidence(product, data);

      const targetRate = Math.max(
        HIGH_PRODUCT_REFUND_RATE * 100,
        storeAvgRate * 100 * 1.5,
      ).toFixed(0);

      result.push({
        fingerprint: `high_product_refund_rate:${product.shopifyProductId ?? product.productTitle}`,
        severity: product.refundRate >= 0.2 ? "critical" : "warning",
        title: `"${product.productTitle}" has a ${ratePercent}% refund rate`,
        summary:
          `${ratePercent}% of orders containing "${product.productTitle}"${skuLabel} ` +
          `are refunded — ${storeMultiple}× your store average of ${storeRatePercent}%.`,
        explanation:
          `Out of ${product.totalOrders} orders containing "${product.productTitle}"${skuLabel}, ` +
          `${product.refundCount} have been refunded (${ratePercent}%). ` +
          `Your store-wide average is ${storeRatePercent}%, making this product ` +
          `${storeMultiple}× more likely to result in a refund. ` +
          `Total refunded to date for this product: ${formatMoney(product.totalRefunded)}. ` +
          `At current rates this costs approximately ${formatMoney(monthlyImpact)} per month.`,
        rootCauses: [
          `Product quality or defect issue specific to "${product.productTitle}"`,
          "Product listing (photos, description) may not match what customers receive",
          "Packaging or fulfillment issue causing damage in transit",
          "Sizing, compatibility, or specification mismatch",
        ],
        recommendation:
          `Investigate "${product.productTitle}" specifically — pull all refund notes ` +
          `for this SKU and look for the dominant reason. Fix the root cause before ` +
          `running promotions on this product.`,
        recommendationSteps: [
          `Filter Shopify refunds by "${product.productTitle}" and export reason notes`,
          "Identify whether the issue is quality, listing accuracy, or fulfillment",
          "If packaging: switch to more protective materials for this SKU",
          "If listing: update photos and description to set accurate expectations",
          "Add a temporary quality hold and monitor refund rate weekly",
          `Target: bring refund rate below ${targetRate}%`,
        ],
        monthlyImpact,
        totalImpact: product.totalRefunded,
        affectedOrdersCount: product.refundCount,
        confidence,
        evidence,
      });
    }

    return result;
  }

  /**
   * Build evidence items for a product finding.
   * We show the most recent refunds from the overall refunds list,
   * annotated with the product context.
   */
  private buildProductEvidence(
    product: RefundProductRow,
    data: RefundData,
  ): FindingEvidenceItem[] {
    const skuLabel = product.sku ? ` (SKU: ${product.sku})` : "";
    return data.refunds
      .filter((r) => r.totalRefunded > 0)
      .sort((a, b) => b.refundCreatedAt.getTime() - a.refundCreatedAt.getTime())
      .slice(0, 6)
      .map((r): FindingEvidenceItem => ({
        orderNumber: r.orderName,
        occurredAt: r.refundCreatedAt,
        amount: r.totalRefunded,
        note: r.refundNote
          ? `"${r.refundNote}" · ${product.productTitle}${skuLabel}`
          : `Refund for ${product.productTitle}${skuLabel}`,
      }));
  }

  // ── Sub-check 3: Customers with excessive refunds ─────────────────────────

  private checkExcessiveCustomerRefunds(
    data: RefundData,
  ): FindingCandidate[] {
    const { customerRefunds, storeStats } = data;

    const problemCustomers = customerRefunds.filter((c) => {
      const meetsCountThreshold = c.refundCount >= MIN_CUSTOMER_REFUNDS;
      const customerRefundRate =
        c.totalOrders > 0 ? c.refundCount / c.totalOrders : 0;
      const meetsRateAndAmount =
        customerRefundRate >= HIGH_CUSTOMER_REFUND_RATE &&
        c.totalRefunded >= HIGH_CUSTOMER_REFUND_AMOUNT_THRESHOLD &&
        c.refundCount >= 2;
      return meetsCountThreshold || meetsRateAndAmount;
    });

    if (problemCustomers.length === 0) return [];

    // Sort by total refunded descending
    problemCustomers.sort((a, b) => b.totalRefunded - a.totalRefunded);

    const totalRefundedByProblemCustomers = problemCustomers.reduce(
      (sum, c) => sum + c.totalRefunded,
      0,
    );

    const windowMonths = computeWindowMonths(storeStats);
    const monthlyImpact = totalRefundedByProblemCustomers / windowMonths;

    const topCustomer = problemCustomers[0];
    const topName = customerDisplayName(topCustomer);

    const confidence = Math.min(
      90,
      Math.round(65 + Math.min(problemCustomers.length, 10) * 2.5),
    );

    // Evidence: most recent refunds from problem customers
    const problemCustomerIds = new Set(
      problemCustomers.map((c) => c.shopifyCustomerId),
    );
    const evidence: FindingEvidenceItem[] = data.refunds
      .filter(
        (r) =>
          r.shopifyCustomerId &&
          problemCustomerIds.has(r.shopifyCustomerId),
      )
      .sort((a, b) => b.refundCreatedAt.getTime() - a.refundCreatedAt.getTime())
      .slice(0, 8)
      .map((r): FindingEvidenceItem => {
        const cust = problemCustomers.find(
          (c) => c.shopifyCustomerId === r.shopifyCustomerId,
        );
        const name = cust ? customerDisplayName(cust) : "customer";
        return {
          orderNumber: r.orderName,
          occurredAt: r.refundCreatedAt,
          amount: r.totalRefunded,
          note: r.refundNote
            ? `${name}: "${r.refundNote}"`
            : `${name}: refund on ${r.orderName}`,
        };
      });

    // Summary of top offenders for the explanation
    const topList = problemCustomers
      .slice(0, 5)
      .map((c) => {
        const name = customerDisplayName(c);
        const rate =
          c.totalOrders > 0
            ? `${((c.refundCount / c.totalOrders) * 100).toFixed(0)}%`
            : "–";
        return (
          `${name} (${c.refundCount} refunds / ${c.totalOrders} orders, ` +
          `${rate} rate, ${formatMoney(c.totalRefunded)} total)`
        );
      })
      .join("; ");

    const plural = problemCustomers.length === 1;

    return [
      {
        fingerprint: "excessive_customer_refunds",
        severity: problemCustomers.length >= 5 ? "critical" : "warning",
        title: `${problemCustomers.length} customer${plural ? "" : "s"} with excessive refund history`,
        summary:
          `${problemCustomers.length} customer${plural ? "" : "s"} account for ` +
          `${formatMoney(totalRefundedByProblemCustomers)} in refunds — a pattern that suggests ` +
          `policy abuse or systematic dissatisfaction.`,
        explanation:
          `${problemCustomers.length} customer${plural ? " has" : "s have"} placed 3 or more ` +
          `refund requests or have an unusually high refund rate. ` +
          `The highest offender is ${topName} with ${topCustomer.refundCount} refunds ` +
          `totalling ${formatMoney(topCustomer.totalRefunded)}. ` +
          `Top customers by refund volume: ${topList}. ` +
          `Combined, these customers account for ${formatMoney(totalRefundedByProblemCustomers)} ` +
          `refunded to date.`,
        rootCauses: [
          "Policy abuse — customers exploiting a lenient refund policy",
          "Recurring product dissatisfaction with specific items",
          "Habitual refunders who exploit free-return policies",
          "Legitimate quality issue affecting the same repeat buyers",
        ],
        recommendation:
          "Flag these customers in your CRM and review their refund notes. " +
          "For suspected policy abusers, add friction to the refund flow " +
          "(e.g. requiring photos) or move them to manual review.",
        recommendationSteps: [
          "Export the list of high-refund customers and review their refund reason notes",
          "Check whether refunds cluster around specific products (quality issue vs. policy abuse)",
          "For suspected abusers: update your policy to require proof of defect for refunds",
          "Add these customers to a manual-review list in Shopify or your helpdesk",
          "Consider blocking serial refunders from one-click refund eligibility",
        ],
        monthlyImpact,
        totalImpact: totalRefundedByProblemCustomers,
        affectedOrdersCount: problemCustomers.reduce(
          (sum, c) => sum + c.refundCount,
          0,
        ),
        confidence,
        evidence,
      },
    ];
  }

  // ── Sub-check 4: Abnormally large refund amounts ────────────────────────────

  private checkAbnormallyLargeRefunds(
    data: RefundData,
  ): FindingCandidate[] {
    const { refunds, storeStats } = data;

    if (storeStats.avgRefundAmount === 0) return [];

    // Use the larger of the fixed threshold and the statistical threshold
    const largeRefundThreshold = Math.max(
      LARGE_REFUND_AMOUNT_THRESHOLD,
      storeStats.avgRefundAmount * LARGE_REFUND_AMOUNT_STORE_MULTIPLE,
    );

    const largeRefunds = refunds
      .filter((r) => r.totalRefunded >= largeRefundThreshold)
      .sort((a, b) => b.totalRefunded - a.totalRefunded);

    if (largeRefunds.length === 0) return [];

    const totalLargeRefundAmount = largeRefunds.reduce(
      (sum, r) => sum + r.totalRefunded,
      0,
    );

    const windowMonths = computeWindowMonths(storeStats);
    const monthlyImpact = totalLargeRefundAmount / windowMonths;

    const confidence = Math.min(
      88,
      Math.round(60 + Math.min(largeRefunds.length, 15) * 2),
    );

    const largestRefund = largeRefunds[0];
    const avgMultiple = (
      largestRefund.totalRefunded / storeStats.avgRefundAmount
    ).toFixed(1);

    const evidence: FindingEvidenceItem[] = largeRefunds
      .slice(0, 8)
      .map((r): FindingEvidenceItem => ({
        orderNumber: r.orderName,
        occurredAt: r.refundCreatedAt,
        amount: r.totalRefunded,
        note: r.refundNote
          ? `"${r.refundNote}" · ${(r.totalRefunded / storeStats.avgRefundAmount).toFixed(1)}× average`
          : `Refund of ${formatMoney(r.totalRefunded)} — ` +
            `${(r.totalRefunded / storeStats.avgRefundAmount).toFixed(1)}× ` +
            `store average of ${formatMoney(storeStats.avgRefundAmount)}`,
      }));

    const plural = largeRefunds.length === 1;

    return [
      {
        fingerprint: "abnormally_large_refunds",
        severity:
          largeRefunds.length >= 5 || totalLargeRefundAmount >= 2000
            ? "critical"
            : "warning",
        title: `${largeRefunds.length} abnormally large refund${plural ? "" : "s"} detected`,
        summary:
          `${largeRefunds.length} refund${plural ? " totals" : "s total"} ` +
          `${formatMoney(totalLargeRefundAmount)} — each is more than ` +
          `${LARGE_REFUND_AMOUNT_STORE_MULTIPLE}× your average refund amount of ` +
          `${formatMoney(storeStats.avgRefundAmount)}.`,
        explanation:
          `Your average refund amount is ${formatMoney(storeStats.avgRefundAmount)}. ` +
          `${largeRefunds.length} refund${plural ? " was" : "s were"} flagged as abnormally large ` +
          `(above ${formatMoney(largeRefundThreshold)}, i.e. ≥${LARGE_REFUND_AMOUNT_STORE_MULTIPLE}× the average). ` +
          `The largest was ${formatMoney(largestRefund.totalRefunded)} on order ` +
          `${largestRefund.orderName} — ${avgMultiple}× the store average. ` +
          `Large refunds can indicate unauthorized returns, over-refunding, ` +
          `or high-value product issues that warrant immediate investigation. ` +
          `Total value: ${formatMoney(totalLargeRefundAmount)}.`,
        rootCauses: [
          "Over-refunding: staff accidentally refunding shipping or more than the item value",
          "High-value product defects or damage requiring full-order refunds",
          "Fraudulent return claims on expensive items",
          "Bulk order refunds (entire wholesale or corporate orders returned)",
        ],
        recommendation:
          "Review each large refund individually to verify it was authorized and " +
          "correctly processed. Add approval workflows for refunds above a threshold.",
        recommendationSteps: [
          "Review each flagged refund in Shopify Admin and verify it was intentional",
          "Check whether any refund exceeded the original order amount (over-refund error)",
          "Implement a manager-approval step for refunds above your average order value",
          "Set up a Shopify Flow or notification when a refund exceeds a threshold",
          "For high-value product returns: require photo evidence before processing",
        ],
        monthlyImpact,
        totalImpact: totalLargeRefundAmount,
        affectedOrdersCount: largeRefunds.length,
        confidence,
        evidence,
      },
    ];
  }

  // ── Sub-check 5: Repeated refund patterns ─────────────────────────────────

  private checkRepeatedRefundPatterns(
    data: RefundData,
  ): FindingCandidate | null {
    const { refunds, storeStats } = data;

    // Group refunds by order
    const refundsByOrder = new Map<string, RefundOrderRow[]>();
    for (const refund of refunds) {
      const list = refundsByOrder.get(refund.orderId) ?? [];
      list.push(refund);
      refundsByOrder.set(refund.orderId, list);
    }

    type MultiRefundOrder = {
      orderId: string;
      orderName: string;
      refundCount: number;
      totalRefunded: number;
      orderTotal: number;
      refunds: RefundOrderRow[];
    };

    const multiRefundOrders: MultiRefundOrder[] = [];
    for (const [orderId, orderRefunds] of refundsByOrder) {
      if (orderRefunds.length < REPEATED_ORDER_REFUNDS_THRESHOLD) continue;
      multiRefundOrders.push({
        orderId,
        orderName: orderRefunds[0].orderName,
        refundCount: orderRefunds.length,
        totalRefunded: orderRefunds.reduce((sum, r) => sum + r.totalRefunded, 0),
        orderTotal: orderRefunds[0].orderTotal,
        refunds: orderRefunds.sort(
          (a, b) =>
            a.refundCreatedAt.getTime() - b.refundCreatedAt.getTime(),
        ),
      });
    }

    if (multiRefundOrders.length < MIN_REPEATED_REFUND_ORDERS) return null;

    multiRefundOrders.sort((a, b) => b.totalRefunded - a.totalRefunded);

    const totalMultiRefundAmount = multiRefundOrders.reduce(
      (sum, o) => sum + o.totalRefunded,
      0,
    );

    // Detect over-refunding (refunded > order total by more than 1%)
    const overRefundedOrders = multiRefundOrders.filter(
      (o) => o.totalRefunded > o.orderTotal * 1.01,
    );
    const hasOverRefunds = overRefundedOrders.length > 0;

    const windowMonths = computeWindowMonths(storeStats);
    const monthlyImpact = totalMultiRefundAmount / windowMonths;

    const confidence = Math.min(
      90,
      Math.round(65 + Math.min(multiRefundOrders.length, 20) * 1.5),
    );

    // Build evidence: show up to 2 refunds per order for the top orders
    const evidence: FindingEvidenceItem[] = [];
    for (const o of multiRefundOrders.slice(0, 4)) {
      for (let i = 0; i < Math.min(o.refunds.length, 2); i++) {
        const r = o.refunds[i];
        const isOverRefunded = overRefundedOrders.some(
          (oo) => oo.orderId === o.orderId,
        );
        evidence.push({
          orderNumber: r.orderName,
          occurredAt: r.refundCreatedAt,
          amount: r.totalRefunded,
          note:
            i === 0
              ? `Refund #1 of ${o.refundCount} on this order` +
                (r.refundNote ? `: "${r.refundNote}"` : "")
              : `Refund #${i + 1} on same order` +
                (isOverRefunded ? " — OVER-REFUNDED" : "") +
                (r.refundNote ? `: "${r.refundNote}"` : ""),
        });
        if (evidence.length >= 8) break;
      }
      if (evidence.length >= 8) break;
    }

    const plural = multiRefundOrders.length === 1;

    return {
      fingerprint: "repeated_refund_patterns",
      severity:
        hasOverRefunds || multiRefundOrders.length >= 10
          ? "critical"
          : "warning",
      title: `${multiRefundOrders.length} order${plural ? "" : "s"} refunded multiple times`,
      summary:
        `${multiRefundOrders.length} order${plural ? " has" : "s have"} been refunded more than once` +
        (hasOverRefunds
          ? `, and ${overRefundedOrders.length} may have been over-refunded`
          : "") +
        ". This pattern suggests process errors or policy exploitation.",
      explanation:
        `${multiRefundOrders.length} order${plural ? "" : "s"} in your history ` +
        `have had ${REPEATED_ORDER_REFUNDS_THRESHOLD} or more separate refund events. ` +
        `Multiple refunds on the same order can indicate partial refund errors, ` +
        `customer re-escalation after an initial partial refund, or staff mistakes. ` +
        (hasOverRefunds
          ? `Critically, ${overRefundedOrders.length} order${overRefundedOrders.length === 1 ? "" : "s"} ` +
            `appear to have been over-refunded (refunded more than the original order total). `
          : "") +
        `Total refunded across these orders: ${formatMoney(totalMultiRefundAmount)}.`,
      rootCauses: [
        "Staff processing multiple partial refunds when one full refund was intended",
        "Customer escalation after unsatisfactory partial resolution",
        "Duplicate refund processing (same refund submitted twice)",
        ...(hasOverRefunds
          ? ["Over-refunding error: refunded more than the order total"]
          : []),
      ],
      recommendation:
        "Audit each multi-refund order to identify processing errors. Add a refund " +
        "history check before processing any refund to alert staff when an order " +
        "already has a refund on record.",
      recommendationSteps: [
        "Review each order with multiple refunds in Shopify Admin",
        ...(hasOverRefunds
          ? [
              "Immediately review over-refunded orders — contact payment processor if needed",
            ]
          : []),
        "Train staff to check refund history before initiating a new refund",
        "Implement a Shopify Flow to alert a manager when a second refund is attempted on the same order",
        "Update your SOP: partial refunds should escalate to full refunds via order edit, not separate refund events",
      ],
      monthlyImpact,
      totalImpact: totalMultiRefundAmount,
      affectedOrdersCount: multiRefundOrders.length,
      confidence,
      evidence,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildRefundNote(r: RefundOrderRow): string {
  const parts: string[] = [];
  if (r.customerEmail) parts.push(r.customerEmail);
  if (r.refundNote) parts.push(`"${r.refundNote}"`);
  if (r.restock) parts.push("restocked");
  return parts.length > 0 ? parts.join(" · ") : `Refund on ${r.orderName}`;
}

function customerDisplayName(c: RefundCustomerRow): string {
  if (c.firstName || c.lastName) {
    return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  }
  return c.email ?? "Guest";
}

function computeWindowMonths(
  storeStats: RefundData["storeStats"],
): number {
  if (!storeStats.earliestOrderDate || !storeStats.latestOrderDate) return 1;
  return Math.max(
    1,
    (storeStats.latestOrderDate.getTime() -
      storeStats.earliestOrderDate.getTime()) /
      MS_PER_MONTH,
  );
}
