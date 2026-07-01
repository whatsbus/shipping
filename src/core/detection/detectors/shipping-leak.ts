/**
 * Shipping Leak Detector
 *
 * Analyses synchronized Shopify order data to surface five categories of
 * shipping-related profit leaks:
 *
 *   1. Shipping cost higher than expected (store charges less than carrier cost)
 *   2. Free-shipping orders that generate a loss (merchant absorbs full cost)
 *   3. Expensive shipping methods reducing profit (high-cost fulfillment channels)
 *   4. Negative shipping margin (persistent net loss across the store)
 *   5. Repeated shipping loss patterns (same conditions fire repeatedly)
 *
 * Architecture notes:
 * - Implements IDetector — registered via defaultRegistry in setup.ts.
 * - Does NOT access the database. All data arrives via context.meta.shippingData
 *   (loaded by src/core/detection/shipping-data-loader.ts before the engine runs).
 * - Does NOT throw. All errors are caught and returned as status "error".
 * - Is fully idempotent: same context → same findings.
 * - Persists nothing. The persistence layer (findings-repository.ts) handles
 *   that after the engine run completes.
 * - Is completely independent of RefundLeakDetector.
 */

import type { IDetector, DetectorContext, DetectorResult } from "../types";
import type {
  ShippingData,
  ShippingOrderRow,
  ShippingMethodRow,
} from "../shipping-data-loader";
import type {
  ShippingLeakPayload,
  FindingCandidate,
  FindingEvidenceItem,
} from "../finding-payload";

// ---------------------------------------------------------------------------
// Thresholds — tunable constants
// ---------------------------------------------------------------------------

/** Minimum number of orders before any store-wide check fires */
const MIN_ORDERS = 10;

/**
 * Shipping loss rate threshold to trigger the "high shipping cost" finding.
 * If more than 30% of orders have negative shipping margin, the store has
 * a systematic under-pricing problem.
 */
const HIGH_LOSS_RATE_THRESHOLD = 0.30; // 30%

/**
 * Minimum number of free-shipping orders with confirmed loss before we surface
 * the free-shipping finding. Avoids alarming stores with only a handful of orders.
 */
const MIN_FREE_SHIPPING_LOSS_ORDERS = 3;

/**
 * A fulfillment method must have at least this many orders to be evaluated
 * for the "expensive method" finding.
 */
const MIN_METHOD_ORDERS = 5;

/**
 * Method loss rate threshold. A fulfillment method that causes a loss on
 * more than 40% of its orders is flagged as expensive.
 */
const HIGH_METHOD_LOSS_RATE = 0.40; // 40%

/**
 * Minimum absolute net margin loss (negative) for a method to be flagged.
 * Guards against flagging methods with tiny absolute amounts.
 */
const MIN_METHOD_NET_LOSS = 50; // currency units

/**
 * A store-wide negative shipping margin is flagged as "critical" when
 * the total monthly loss exceeds this threshold.
 */
const CRITICAL_MONTHLY_LOSS_THRESHOLD = 200; // currency units per month

/**
 * A "repeated pattern" is detected when the same loss signature (free-shipping
 * or paid-but-underpriced) appears across consecutive months in the data window.
 */
const REPEATED_PATTERN_MIN_MONTHS = 2;

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

// ---------------------------------------------------------------------------
// ShippingLeakDetector
// ---------------------------------------------------------------------------

export class ShippingLeakDetector implements IDetector {
  readonly type = "shipping_leak" as const;
  readonly name = "Shipping Leak Detector";

  async run(context: DetectorContext): Promise<DetectorResult> {
    const start = Date.now();

    try {
      // ── Guard: data must be pre-loaded and injected via meta ────────────
      const shippingData = context.meta.shippingData as
        | ShippingData
        | undefined;

      if (!shippingData) {
        return {
          detectorType: this.type,
          status: "skipped",
          anomaliesFound: false,
          message:
            "No shippingData in context.meta. Load data with loadShippingData() before running the engine.",
          durationMs: Date.now() - start,
        };
      }

      const { storeStats } = shippingData;

      // ── Guard: minimum data requirements ────────────────────────────────
      if (storeStats.totalOrders < MIN_ORDERS) {
        return {
          detectorType: this.type,
          status: "skipped",
          anomaliesFound: false,
          message:
            `Insufficient data: only ${storeStats.totalOrders} qualifying orders ` +
            `(minimum ${MIN_ORDERS} required).`,
          durationMs: Date.now() - start,
        };
      }

      // ── Run all sub-checks ───────────────────────────────────────────────
      const findingCandidates: FindingCandidate[] = [];

      const highCostFinding = this.checkHighShippingCost(shippingData);
      if (highCostFinding) findingCandidates.push(highCostFinding);

      const freeLossFinding = this.checkFreeShippingLoss(shippingData);
      if (freeLossFinding) findingCandidates.push(freeLossFinding);

      const methodFindings = this.checkExpensiveShippingMethods(shippingData);
      findingCandidates.push(...methodFindings);

      const negativeMarginFinding = this.checkNegativeShippingMargin(shippingData);
      if (negativeMarginFinding) findingCandidates.push(negativeMarginFinding);

      const patternFinding = this.checkRepeatedShippingLossPattern(shippingData);
      if (patternFinding) findingCandidates.push(patternFinding);

      const anomaliesFound = findingCandidates.length > 0;
      const payload: ShippingLeakPayload = { findings: findingCandidates };

      return {
        detectorType: this.type,
        status: "ok",
        anomaliesFound,
        message: anomaliesFound
          ? `Found ${findingCandidates.length} shipping leak issue(s): ` +
            findingCandidates.map((f) => f.title).join("; ")
          : "No shipping leak anomalies detected.",
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

  // ── Sub-check 1: Shipping cost higher than expected ──────────────────────
  //
  // Fires when the proportion of orders where estimated carrier cost > shipping
  // charged exceeds HIGH_LOSS_RATE_THRESHOLD.
  //
  // Fingerprint: "high_shipping_cost_rate" — stable, no per-order suffix.

  private checkHighShippingCost(
    data: ShippingData,
  ): FindingCandidate | null {
    const { storeStats, orders } = data;

    if (storeStats.shippingLossRate < HIGH_LOSS_RATE_THRESHOLD) return null;

    // Only consider paid-shipping orders for this check
    // (free shipping is handled separately in check 2)
    const paidLossOrders = orders.filter(
      (o) => !o.isFreeShipping && o.isShippingLoss,
    );

    if (paidLossOrders.length === 0) return null;

    const paidLossRate =
      storeStats.paidShippingOrders > 0
        ? paidLossOrders.length / storeStats.paidShippingOrders
        : 0;

    if (paidLossRate < HIGH_LOSS_RATE_THRESHOLD) return null;

    const totalUnderchargedAmount = paidLossOrders.reduce(
      (s, o) => s + Math.abs(o.shippingMargin),
      0,
    );
    const windowMonths = computeWindowMonths(storeStats);
    const monthlyImpact = totalUnderchargedAmount / windowMonths;
    const ratePercent = (paidLossRate * 100).toFixed(1);
    const avgUndercharge =
      paidLossOrders.length > 0
        ? totalUnderchargedAmount / paidLossOrders.length
        : 0;

    const confidence = Math.min(
      90,
      Math.round(65 + (paidLossRate - HIGH_LOSS_RATE_THRESHOLD) * 150),
    );

    const evidence = this.buildOrderEvidence(
      paidLossOrders
        .sort((a, b) => a.shippingMargin - b.shippingMargin) // worst first
        .slice(0, 8),
      (o) =>
        `Charged ${formatMoney(o.shippingCharged)}, ` +
        `est. cost ${formatMoney(o.estimatedCarrierCost)} ` +
        `→ loss of ${formatMoney(Math.abs(o.shippingMargin))}`,
    );

    return {
      fingerprint: "high_shipping_cost_rate",
      severity: paidLossRate >= 0.50 ? "critical" : "warning",
      title: `${ratePercent}% of paid-shipping orders charged less than estimated carrier cost`,
      summary:
        `On ${paidLossOrders.length} of ${storeStats.paidShippingOrders} paid-shipping orders ` +
        `(${ratePercent}%), the amount collected from customers is below the estimated ` +
        `carrier cost — averaging ${formatMoney(avgUndercharge)} per order.`,
      explanation:
        `${ratePercent}% of orders where customers paid for shipping are generating a ` +
        `shipping loss because the charged amount is below the estimated carrier cost. ` +
        `The average shortfall is ${formatMoney(avgUndercharge)} per order. ` +
        `Total undercharge accumulated to date: ${formatMoney(totalUnderchargedAmount)}. ` +
        `At the current rate, this is draining approximately ${formatMoney(monthlyImpact)} ` +
        `per month from your shipping margin. ` +
        `This typically happens when flat-rate shipping prices are set and never ` +
        `adjusted as carrier rates rise, or when discount thresholds overlap with ` +
        `expensive shipping zones.`,
      rootCauses: [
        "Flat shipping rates set years ago that haven't kept pace with carrier price increases",
        "Shipping zones (e.g. Hawaii, Alaska, international) priced the same as domestic",
        "Heavy or bulky products priced with rates designed for lightweight SKUs",
        "Carrier surcharges (fuel, residential delivery, oversized) not factored into rates",
      ],
      recommendation:
        `Review your shipping rate table in Shopify → Settings → Shipping and delivery. ` +
        `For each zone and weight band, compare your charged rate against your actual ` +
        `carrier invoices. Priority: fix rates for the most-travelled zones first.`,
      recommendationSteps: [
        "Export the last 90 days of carrier invoices and compute average cost per zone",
        "In Shopify, navigate to Settings → Shipping and delivery → Manage rates",
        "Increase flat rates to cover at least the 80th-percentile cost for each zone",
        "Add weight-based rate tiers so heavier orders cover their higher carrier cost",
        "Set a quarterly calendar reminder to audit shipping rates against carrier invoices",
      ],
      monthlyImpact,
      totalImpact: totalUnderchargedAmount,
      affectedOrdersCount: paidLossOrders.length,
      confidence,
      evidence,
    };
  }

  // ── Sub-check 2: Free-shipping orders that generate a loss ───────────────
  //
  // Fires when a meaningful number of free-shipping orders exist where the
  // merchant bore 100% of carrier cost with no revenue offset.
  //
  // Fingerprint: "free_shipping_loss" — stable, store-level.

  private checkFreeShippingLoss(
    data: ShippingData,
  ): FindingCandidate | null {
    const { storeStats, orders } = data;

    // Free-shipping orders are always a "loss" on shipping (customer pays $0)
    const freeLossOrders = orders.filter(
      (o) => o.isFreeShipping && o.estimatedCarrierCost > 0,
    );

    if (freeLossOrders.length < MIN_FREE_SHIPPING_LOSS_ORDERS) return null;

    const totalCarrierCostAbsorbed = freeLossOrders.reduce(
      (s, o) => s + o.estimatedCarrierCost,
      0,
    );
    const avgCostAbsorbed =
      freeLossOrders.length > 0
        ? totalCarrierCostAbsorbed / freeLossOrders.length
        : 0;

    const windowMonths = computeWindowMonths(storeStats);
    const monthlyImpact = totalCarrierCostAbsorbed / windowMonths;

    // Free-shipping loss rate as a fraction of total orders
    const freeLossRate =
      storeStats.totalOrders > 0
        ? freeLossOrders.length / storeStats.totalOrders
        : 0;
    const freeLossRatePercent = (freeLossRate * 100).toFixed(1);

    // Assess whether free shipping is profitable by checking if subtotals
    // are large enough to justify the absorbed cost.
    // A free-shipping promotion is sustainable when the margin on products
    // covers the carrier cost. We flag when avg subtotal is low relative to cost.
    const avgSubtotal =
      freeLossOrders.reduce((s, o) => s + o.subtotalPrice, 0) /
      freeLossOrders.length;

    const confidence = Math.min(
      88,
      Math.round(60 + Math.min(freeLossOrders.length, 40) * 0.7),
    );

    const evidence = this.buildOrderEvidence(
      freeLossOrders
        .sort((a, b) => b.estimatedCarrierCost - a.estimatedCarrierCost)
        .slice(0, 8),
      (o) =>
        `Free shipping absorbed — est. carrier cost ${formatMoney(o.estimatedCarrierCost)}, ` +
        `subtotal ${formatMoney(o.subtotalPrice)}`,
    );

    const isCritical =
      freeLossOrders.length >= 20 ||
      monthlyImpact >= CRITICAL_MONTHLY_LOSS_THRESHOLD;

    return {
      fingerprint: "free_shipping_loss",
      severity: isCritical ? "critical" : "warning",
      title: `${freeLossOrders.length} free-shipping orders absorbing ${formatMoney(totalCarrierCostAbsorbed)} in carrier costs`,
      summary:
        `${freeLossOrders.length} orders (${freeLossRatePercent}% of all orders) ` +
        `used free shipping, costing an estimated ${formatMoney(totalCarrierCostAbsorbed)} ` +
        `in carrier fees with an average subtotal of ${formatMoney(avgSubtotal)}.`,
      explanation:
        `${freeLossOrders.length} orders in your history had free shipping applied ` +
        `(customers charged $0 for delivery). ` +
        `The estimated carrier cost for these shipments is ${formatMoney(totalCarrierCostAbsorbed)} — ` +
        `an average of ${formatMoney(avgCostAbsorbed)} per order that is entirely absorbed by your store. ` +
        `The average order subtotal on free-shipping orders was ${formatMoney(avgSubtotal)}. ` +
        `This is costing approximately ${formatMoney(monthlyImpact)} per month. ` +
        `Free shipping is a powerful conversion tool, but only if your product ` +
        `margins are wide enough to cover the absorbed carrier cost. ` +
        `If your gross margin on products is below the absorbed shipping rate, ` +
        `each free-shipping order is net-negative.`,
      rootCauses: [
        "Free shipping thresholds set too low — orders below the threshold still receive free shipping",
        "Free shipping promotions not linked to minimum-margin products",
        "No minimum order value enforced for free shipping eligibility",
        "High carrier costs on distant zones (e.g. international) included in blanket free-shipping offer",
      ],
      recommendation:
        `Raise your free-shipping threshold to ensure orders cover both product cost and ` +
        `carrier cost. Alternatively, restrict free shipping to orders above a minimum ` +
        `subtotal that guarantees a positive margin after carrier fees.`,
      recommendationSteps: [
        "Calculate your average gross margin per order and compare it to average carrier cost",
        "Set the free shipping minimum to: (avg carrier cost) ÷ (gross margin %) × 1.2",
        "In Shopify: Settings → Shipping → Add a free shipping rate with a minimum order price",
        "Exclude remote zones (Hawaii, Alaska, international) from blanket free-shipping offers",
        "A/B test raising the free-shipping threshold by $10–$20 and monitor conversion rate",
        "Review whether free-shipping promotions coincide with low-margin SKUs",
      ],
      monthlyImpact,
      totalImpact: totalCarrierCostAbsorbed,
      affectedOrdersCount: freeLossOrders.length,
      confidence,
      evidence,
    };
  }

  // ── Sub-check 3: Expensive shipping methods reducing profit ──────────────
  //
  // Evaluates per-fulfillment-method aggregates. Methods with a high loss
  // rate or significant net negative margin are flagged.
  //
  // Fingerprint: "expensive_method:<fulfillmentService>" — per-method.

  private checkExpensiveShippingMethods(
    data: ShippingData,
  ): FindingCandidate[] {
    const { methodStats, storeStats } = data;
    const result: FindingCandidate[] = [];
    const windowMonths = computeWindowMonths(storeStats);

    for (const method of methodStats) {
      if (method.orderCount < MIN_METHOD_ORDERS) continue;

      // Must have a meaningful loss both in rate and absolute terms
      if (method.lossRate < HIGH_METHOD_LOSS_RATE) continue;
      if (method.netMargin > -MIN_METHOD_NET_LOSS) continue;

      const lossRatePercent = (method.lossRate * 100).toFixed(1);
      const monthlyImpact = Math.abs(method.netMargin) / windowMonths;
      const avgMarginLabel = formatMoney(method.avgMarginPerOrder);
      const methodLabel = formatMethodLabel(method.fulfillmentService);

      const confidence = Math.min(
        85,
        Math.round(
          58 +
            Math.min(method.orderCount, 50) * 0.4 +
            (method.lossRate - HIGH_METHOD_LOSS_RATE) * 80,
        ),
      );

      const evidence = this.buildMethodEvidence(method, data);

      result.push({
        fingerprint: `expensive_method:${method.fulfillmentService}`,
        severity:
          method.lossRate >= 0.60 ||
          Math.abs(method.netMargin) >= 500
            ? "critical"
            : "warning",
        title: `"${methodLabel}" fulfillment has ${lossRatePercent}% shipping loss rate`,
        summary:
          `${method.lossOrderCount} of ${method.orderCount} orders ` +
          `fulfilled via "${methodLabel}" have a negative shipping margin — ` +
          `averaging ${avgMarginLabel} per order.`,
        explanation:
          `The fulfillment channel "${methodLabel}" is causing a shipping loss on ` +
          `${lossRatePercent}% of the ${method.orderCount} orders routed through it. ` +
          `Total shipping charged: ${formatMoney(method.totalShippingCharged)}. ` +
          `Total estimated carrier cost: ${formatMoney(method.totalEstimatedCost)}. ` +
          `Net shipping margin: ${formatMoney(method.netMargin)} ` +
          `(average ${avgMarginLabel} per order). ` +
          `This channel is generating approximately ${formatMoney(monthlyImpact)} in ` +
          `unrecovered shipping costs per month.`,
        rootCauses: [
          `"${methodLabel}" may carry higher carrier rates than your other fulfillment channels`,
          "Shipping rates for this method were not calibrated when it was set up",
          "Product mix routed to this fulfillment channel may skew heavier or bulkier",
          "Remote delivery addresses being processed through an expensive rate tier",
        ],
        recommendation:
          `Review the shipping rates specifically for the "${methodLabel}" fulfillment ` +
          `channel. Compare your carrier invoices for this channel against what ` +
          `customers are paying, and adjust rates or renegotiate carrier contracts.`,
        recommendationSteps: [
          `Pull carrier invoices for "${methodLabel}" and compute average cost per shipment`,
          `In Shopify, check whether "${methodLabel}" has its own shipping rate table or shares the default`,
          "If sharing default rates: create a dedicated rate table for this method with higher floors",
          "Consider switching low-margin SKUs routed to this channel to a cheaper carrier",
          `If "${methodLabel}" is a 3PL: renegotiate rates or compare quotes from alternative 3PLs`,
        ],
        monthlyImpact,
        totalImpact: Math.abs(method.netMargin),
        affectedOrdersCount: method.lossOrderCount,
        confidence,
        evidence,
      });
    }

    return result;
  }

  // ── Sub-check 4: Negative shipping margin (store-wide) ──────────────────
  //
  // Fires when the store's aggregate shipping margin is negative — meaning
  // the store as a whole collects less in shipping revenue than it pays
  // carriers.
  //
  // Fingerprint: "negative_shipping_margin" — stable, store-level.

  private checkNegativeShippingMargin(
    data: ShippingData,
  ): FindingCandidate | null {
    const { storeStats, orders } = data;

    // Only fire this check if the overall margin is negative
    if (storeStats.totalShippingMargin >= 0) return null;

    // Require a meaningful absolute loss (not just a rounding artefact)
    const totalLoss = Math.abs(storeStats.totalShippingMargin);
    if (totalLoss < 10) return null;

    const windowMonths = computeWindowMonths(storeStats);
    const monthlyImpact = totalLoss / windowMonths;

    // Only fire if monthly loss is large enough to be actionable
    if (monthlyImpact < 20) return null;

    const marginRate =
      storeStats.totalEstimatedCarrierCost > 0
        ? storeStats.totalShippingMargin /
          storeStats.totalEstimatedCarrierCost
        : 0;
    const marginRatePercent = (Math.abs(marginRate) * 100).toFixed(1);

    const isCritical = monthlyImpact >= CRITICAL_MONTHLY_LOSS_THRESHOLD;

    const confidence = Math.min(
      92,
      Math.round(
        70 +
          Math.min(storeStats.shippingLossOrders, 50) * 0.4 +
          Math.min(monthlyImpact / 10, 10),
      ),
    );

    // Evidence: worst-margin orders across all categories
    const worstOrders = orders
      .filter((o) => o.isShippingLoss)
      .sort((a, b) => a.shippingMargin - b.shippingMargin)
      .slice(0, 8);

    const evidence = this.buildOrderEvidence(
      worstOrders,
      (o) =>
        `Margin: ${formatMoney(o.shippingMargin)} ` +
        `(charged ${formatMoney(o.shippingCharged)}, ` +
        `est. cost ${formatMoney(o.estimatedCarrierCost)})`,
    );

    return {
      fingerprint: "negative_shipping_margin",
      severity: isCritical ? "critical" : "warning",
      title: `Store-wide shipping margin is negative: ${formatMoney(storeStats.totalShippingMargin)}`,
      summary:
        `Your store has collected ${formatMoney(storeStats.totalShippingCharged)} in shipping ` +
        `revenue but the estimated carrier cost is ${formatMoney(storeStats.totalEstimatedCarrierCost)}, ` +
        `leaving a net shipping loss of ${formatMoney(totalLoss)} (${marginRatePercent}% deficit).`,
      explanation:
        `Across all ${storeStats.totalOrders} orders in your history, ` +
        `your store collected ${formatMoney(storeStats.totalShippingCharged)} from customers ` +
        `for shipping, but the estimated total carrier cost is ` +
        `${formatMoney(storeStats.totalEstimatedCarrierCost)}. ` +
        `This produces a net shipping margin of ${formatMoney(storeStats.totalShippingMargin)} — ` +
        `meaning your store has subsidised shipping at an estimated rate of ` +
        `${formatMoney(monthlyImpact)} per month. ` +
        `${storeStats.shippingLossOrders} of ${storeStats.totalOrders} orders ` +
        `(${(storeStats.shippingLossRate * 100).toFixed(1)}%) have a negative shipping margin. ` +
        `A negative store-wide shipping margin means your product prices are effectively ` +
        `subsidising logistics — a hidden cost that compounds as order volume grows.`,
      rootCauses: [
        "Shipping rates have not been reviewed since original store setup",
        "Carrier rate increases (annual) not passed through to customer-facing shipping prices",
        "Mix of free and paid shipping orders tilts the aggregate margin negative",
        "Flat rates that work for lightweight products create losses on heavier orders",
        "Over-reliance on free shipping promotions without minimum order thresholds",
      ],
      recommendation:
        `Conduct a full shipping rate audit. Compare your last 90 days of carrier ` +
        `invoices against the shipping collected in Shopify. Update rates to recover ` +
        `at least a break-even margin, then target a small positive margin to build ` +
        `a shipping buffer.`,
      recommendationSteps: [
        "Download carrier invoices for the last 90 days and compute cost per zone and weight band",
        "In Shopify Analytics, pull the 'Shipping' column from the Orders report",
        "For each zone: set shipping rates ≥ 90th-percentile carrier cost for that zone",
        "Introduce weight-based tiers so each weight band covers its own carrier cost",
        "If using free shipping: raise the minimum to ensure positive product margin covers carrier cost",
        "Schedule a bi-annual shipping rate review — set a calendar reminder now",
      ],
      monthlyImpact,
      totalImpact: totalLoss,
      affectedOrdersCount: storeStats.shippingLossOrders,
      confidence,
      evidence,
    };
  }

  // ── Sub-check 5: Repeated shipping loss patterns ─────────────────────────
  //
  // Detects whether shipping losses occur consistently across multiple
  // calendar months, confirming a structural (not one-off) problem.
  //
  // Fingerprint: "repeated_shipping_loss_pattern" — stable, store-level.

  private checkRepeatedShippingLossPattern(
    data: ShippingData,
  ): FindingCandidate | null {
    const { orders, storeStats } = data;

    // Only run this check if there are any loss orders
    const lossOrders = orders.filter((o) => o.isShippingLoss);
    if (lossOrders.length === 0) return null;

    // Group loss orders by calendar month (YYYY-MM)
    const lossByMonth = new Map<string, ShippingOrderRow[]>();
    for (const order of lossOrders) {
      const key = toMonthKey(order.orderCreatedAt);
      const list = lossByMonth.get(key) ?? [];
      list.push(order);
      lossByMonth.set(key, list);
    }

    const monthsWithLoss = lossByMonth.size;
    if (monthsWithLoss < REPEATED_PATTERN_MIN_MONTHS) return null;

    // Require the pattern to be present in at least half the data window months
    const windowMonths = computeWindowMonths(storeStats);
    const patternRate = monthsWithLoss / Math.max(1, Math.round(windowMonths));
    if (patternRate < 0.4) return null; // Loss not persistent enough

    const totalLossAmount = lossOrders.reduce(
      (s, o) => s + Math.abs(o.shippingMargin),
      0,
    );
    const monthlyImpact = totalLossAmount / windowMonths;

    // Only fire if monthly impact is meaningful
    if (monthlyImpact < 10) return null;

    // Monthly breakdown for explanation
    const monthEntries = Array.from(lossByMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6); // last 6 months

    const monthSummary = monthEntries
      .map(([month, mOrders]) => {
        const loss = mOrders.reduce(
          (s, o) => s + Math.abs(o.shippingMargin),
          0,
        );
        return `${month}: ${mOrders.length} orders, ${formatMoney(loss)} loss`;
      })
      .join("; ");

    const confidence = Math.min(
      88,
      Math.round(
        60 + Math.min(monthsWithLoss, 12) * 2.5 + (patternRate - 0.4) * 40,
      ),
    );

    // Evidence: one representative loss order per month (last 8 months)
    const evidence: FindingEvidenceItem[] = [];
    for (const [, mOrders] of monthEntries) {
      const worst = mOrders.sort(
        (a, b) => a.shippingMargin - b.shippingMargin,
      )[0];
      if (worst) {
        evidence.push({
          orderNumber: worst.orderName,
          occurredAt: worst.orderCreatedAt,
          amount: Math.abs(worst.shippingMargin),
          note:
            `Month loss sample — charged ${formatMoney(worst.shippingCharged)}, ` +
            `est. cost ${formatMoney(worst.estimatedCarrierCost)}, ` +
            `margin ${formatMoney(worst.shippingMargin)}`,
        });
      }
      if (evidence.length >= 8) break;
    }

    const isCritical =
      monthsWithLoss >= 6 || monthlyImpact >= CRITICAL_MONTHLY_LOSS_THRESHOLD;

    return {
      fingerprint: "repeated_shipping_loss_pattern",
      severity: isCritical ? "critical" : "warning",
      title: `Shipping losses recur across ${monthsWithLoss} consecutive months`,
      summary:
        `Shipping losses have appeared in ${monthsWithLoss} of ${Math.round(windowMonths)} months ` +
        `in your order history, confirming a structural under-pricing problem ` +
        `rather than a one-off anomaly.`,
      explanation:
        `Shipping losses are not random events in your store — they recur ` +
        `consistently. In ${monthsWithLoss} distinct calendar months ` +
        `(${(patternRate * 100).toFixed(0)}% of your data window), ` +
        `at least one order had a negative shipping margin. ` +
        `Monthly breakdown (last 6 months): ${monthSummary}. ` +
        `Total accumulated shipping loss: ${formatMoney(totalLossAmount)}. ` +
        `At the current run rate, this pattern costs approximately ` +
        `${formatMoney(monthlyImpact)} per month — an annualized impact of ` +
        `${formatMoney(monthlyImpact * 12)}. ` +
        `Persistent patterns are significantly more important to fix than ` +
        `isolated anomalies because they compound month over month.`,
      rootCauses: [
        "Shipping rate structure has not been updated in response to annual carrier price increases",
        "A systematic mismatch between your rate table zones and carrier billing zones",
        "Consistent use of free shipping or under-priced flat rates on recurring order profiles",
        "A specific SKU or product category that ships at a loss every time it is ordered",
      ],
      recommendation:
        `Address the root cause of recurring shipping losses rather than isolated incidents. ` +
        `Start with the highest-frequency month and identify the common thread ` +
        `(zone, product category, or shipping method) that drives the most losses.`,
      recommendationSteps: [
        "Identify the top 3 months with the highest shipping loss amounts",
        "For each month, pull the specific orders that generated losses and find the common attribute",
        "Update shipping rates zone-by-zone, starting with the most-affected zone",
        "After updating rates, monitor the next month's shipping margin in Shopify Analytics",
        "Set a monthly alert: if the shipping loss rate exceeds 15%, trigger a rate review",
        "Consider a shipping insurance or rate-lock agreement with your carrier to reduce volatility",
      ],
      monthlyImpact,
      totalImpact: totalLossAmount,
      affectedOrdersCount: lossOrders.length,
      confidence,
      evidence,
    };
  }

  // ── Evidence builders ────────────────────────────────────────────────────

  private buildOrderEvidence(
    orders: ShippingOrderRow[],
    noteBuilder: (o: ShippingOrderRow) => string,
  ): FindingEvidenceItem[] {
    return orders.map((o): FindingEvidenceItem => ({
      orderNumber: o.orderName,
      occurredAt: o.orderCreatedAt,
      amount: Math.abs(o.shippingMargin),
      note: noteBuilder(o),
    }));
  }

  private buildMethodEvidence(
    method: ShippingMethodRow,
    data: ShippingData,
  ): FindingEvidenceItem[] {
    return data.orders
      .filter(
        (o) =>
          o.fulfillmentService === method.fulfillmentService &&
          o.isShippingLoss,
      )
      .sort((a, b) => a.shippingMargin - b.shippingMargin)
      .slice(0, 8)
      .map((o): FindingEvidenceItem => ({
        orderNumber: o.orderName,
        occurredAt: o.orderCreatedAt,
        amount: Math.abs(o.shippingMargin),
        note:
          `"${formatMethodLabel(method.fulfillmentService)}" — ` +
          `charged ${formatMoney(o.shippingCharged)}, ` +
          `est. cost ${formatMoney(o.estimatedCarrierCost)}, ` +
          `loss ${formatMoney(Math.abs(o.shippingMargin))}`,
      }));
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

function formatMethodLabel(service: string): string {
  if (!service || service === "manual") return "Manual fulfillment";
  // Capitalise first letter and replace underscores/hyphens with spaces
  return service
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert a Date to a "YYYY-MM" string for monthly grouping.
 */
function toMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Compute the number of months spanned by the data window.
 */
function computeWindowMonths(
  storeStats: ShippingData["storeStats"],
): number {
  if (!storeStats.earliestOrderDate || !storeStats.latestOrderDate) return 1;
  return Math.max(
    1,
    (storeStats.latestOrderDate.getTime() -
      storeStats.earliestOrderDate.getTime()) /
      MS_PER_MONTH,
  );
}
