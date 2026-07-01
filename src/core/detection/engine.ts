/**
 * Detection Engine
 *
 * The single orchestration point for running detectors against a shop.
 *
 * Responsibilities:
 * - Build a DetectorContext from the provided shop data.
 * - Resolve which detectors to run (all, or a filtered subset).
 * - Execute each detector independently and in sequence.
 * - Catch all exceptions so one broken detector never aborts the run.
 * - Aggregate individual DetectorResult objects into a DetectionRun summary.
 * - Emit structured console logs for observability.
 *
 * What the engine deliberately does NOT do:
 * - Access the database (zero DB imports here).
 * - Generate or persist Finding records (that belongs to a future writer layer).
 * - Know about any specific detector's logic.
 * - Hold any mutable state between runs (it is stateless — run() is pure).
 *
 * Extension strategy:
 * Adding a new detector requires ONLY:
 *   1. Creating the detector in src/core/detection/detectors/
 *   2. Registering it on a DetectorRegistry before calling engine.run()
 * engine.ts itself never needs to change.
 */

import type {
  DetectorContext,
  DetectorResult,
  DetectionRun,
  EngineRunOptions,
  DetectorType,
} from "./types";
import type { DetectorRegistry } from "./registry";

// ---------------------------------------------------------------------------
// DetectionEngine
// ---------------------------------------------------------------------------

export class DetectionEngine {
  /**
   * @param registry  The detector registry to dispatch through.
   *                  Inject a real registry in production; inject a test
   *                  registry with stub detectors in unit tests.
   */
  constructor(private readonly registry: DetectorRegistry) {}

  /**
   * Execute detectors for a single shop and return the aggregated run.
   *
   * @param shopId      Internal UUID of the shop to analyse.
   * @param shopDomain  The myshopify.com domain (used for logging & context).
   * @param currency    ISO-4217 currency code the shop reports in.
   * @param options     Optional: filter to specific detectors, attach metadata.
   *
   * @returns A fully-populated DetectionRun. Never throws.
   */
  async run(
    shopId: string,
    shopDomain: string,
    currency: string,
    options: EngineRunOptions = {},
  ): Promise<DetectionRun> {
    const startedAt = new Date();

    // ── Build the context snapshot ──────────────────────────────────────────
    const context: DetectorContext = {
      shopId,
      shopDomain,
      currency,
      runAt: startedAt,
      meta: options.meta ?? {},
    };

    // ── Resolve which detectors to run ─────────────────────────────────────
    const detectors = this.resolveDetectors(options.detectorTypes);

    if (detectors.length === 0) {
      console.warn(
        `[DetectionEngine][${shopDomain}] No detectors to run. ` +
          `Registry has ${this.registry.size} registered detectors.` +
          (options.detectorTypes
            ? ` Requested types: ${options.detectorTypes.join(", ")}.`
            : ""),
      );
    } else {
      console.log(
        `[DetectionEngine][${shopDomain}] Starting detection run with ` +
          `${detectors.length} detector(s): ${detectors.map((d) => d.type).join(", ")}`,
      );
    }

    // ── Execute detectors ──────────────────────────────────────────────────
    const results: DetectorResult[] = [];

    for (const detector of detectors) {
      const detectorStart = Date.now();

      console.log(
        `[DetectionEngine][${shopDomain}] Running detector: ${detector.name} (${detector.type})`,
      );

      let result: DetectorResult;

      try {
        // Each detector handles its own errors internally and returns
        // status: "error" — but we wrap in try/catch as a safety net in case
        // a detector violates the contract and throws anyway.
        result = await detector.run(context);
      } catch (error) {
        // Safety net: detector violated the "MUST NOT throw" contract.
        const message =
          error instanceof Error ? error.message : String(error);

        console.error(
          `[DetectionEngine][${shopDomain}] Detector "${detector.type}" threw unexpectedly:`,
          message,
        );

        result = {
          detectorType: detector.type,
          status: "error",
          anomaliesFound: false,
          message: `Detector threw unexpectedly: ${message}`,
          durationMs: Date.now() - detectorStart,
        };
      }

      console.log(
        `[DetectionEngine][${shopDomain}] Detector "${detector.type}" finished ` +
          `in ${result.durationMs}ms — status: ${result.status}` +
          (result.anomaliesFound ? ", anomalies found" : ""),
      );

      results.push(result);
    }

    // ── Aggregate ──────────────────────────────────────────────────────────
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const hasErrors = results.some((r) => r.status === "error");
    const anomalyCount = results.filter((r) => r.anomaliesFound).length;

    console.log(
      `[DetectionEngine][${shopDomain}] Run complete in ${durationMs}ms — ` +
        `${results.length} detector(s), ${anomalyCount} with anomalies, hasErrors=${hasErrors}`,
    );

    return {
      shopId,
      shopDomain,
      startedAt,
      completedAt,
      durationMs,
      results,
      hasErrors,
      anomalyCount,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Resolve the ordered list of detectors to execute.
   *
   * If `detectorTypes` is provided and non-empty, only those types are run
   * (in the order specified). Unrecognised types are logged and skipped.
   *
   * If `detectorTypes` is omitted, all registered detectors run in
   * registration order.
   */
  private resolveDetectors(
    detectorTypes?: readonly DetectorType[],
  ): ReturnType<DetectorRegistry["getAll"]> {
    if (!detectorTypes || detectorTypes.length === 0) {
      return this.registry.getAll();
    }

    return detectorTypes.flatMap((type) => {
      const detector = this.registry.get(type);
      if (!detector) {
        console.warn(
          `[DetectionEngine] Requested detector type "${type}" is not registered — skipping.`,
        );
        return [];
      }
      return [detector];
    });
  }
}
