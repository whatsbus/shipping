/**
 * Detection Engine — Core Types
 *
 * Defines the public contract for every component in the detection layer:
 * detectors, the registry, and the engine itself.
 *
 * Design goals:
 * - Strong TypeScript types everywhere — no `any`, no implicit unknowns.
 * - Every interface is self-contained so a detector author only needs to
 *   import from this file.
 * - Aligned with the existing domain model (schema enums, lib/detectors)
 *   without creating circular dependencies.
 * - Forward-compatible: fields are designed to accommodate future detectors
 *   without requiring changes to the engine or registry.
 */

import type { DetectorType } from "@/lib/detectors";

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { DetectorType };

// ---------------------------------------------------------------------------
// Severity & Status — mirror the DB enums, typed locally so detectors
// do not need to import from @/db/schema directly.
// ---------------------------------------------------------------------------

/** Maps to the `finding_severity` Postgres enum. */
export type FindingSeverity = "critical" | "warning" | "info";

/** Maps to the `finding_status` Postgres enum. */
export type FindingStatus = "new" | "investigating" | "resolved" | "ignored";

// ---------------------------------------------------------------------------
// DetectorContext
//
// The read-only snapshot of a shop that is handed to every detector.
// Detectors MUST NOT access the database — they receive all the data
// they need through this context object.
//
// Rule: if a detector needs more data, add an optional field here and
// populate it in the engine before dispatching. Do NOT let a detector
// reach into the DB on its own.
// ---------------------------------------------------------------------------

export interface DetectorContext {
  /** Internal UUID of the shop being analysed. */
  readonly shopId: string;

  /** The myshopify.com domain, e.g. "acme.myshopify.com". */
  readonly shopDomain: string;

  /** ISO-4217 currency code the shop reports in, e.g. "USD". */
  readonly currency: string;

  /**
   * The UTC timestamp the engine started this detection run.
   * Use this — not `new Date()` — for deterministic comparisons inside
   * a detector so that all detectors in a single run share the same "now".
   */
  readonly runAt: Date;

  /**
   * Opaque per-run metadata bag.
   * The engine (or caller) can attach arbitrary key/value pairs here
   * (e.g. syncType, triggeredBy) without modifying the interface.
   */
  readonly meta: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// DetectorResult
//
// What a single detector returns after analysing a shop.
// Deliberately NOT a Finding DB record — the engine (or a future writer
// layer) is responsible for persisting results.
// ---------------------------------------------------------------------------

/**
 * A single detector's analysis output for one shop.
 *
 * `status === "skipped"` means the detector determined it had insufficient
 * data (e.g. sync not yet complete) and chose not to run. The engine will
 * record this but will not treat it as an error.
 *
 * `status === "ok"` means the detector ran to completion. `anomaliesFound`
 * indicates whether it detected anything worth acting on.
 *
 * `status === "error"` means the detector threw an unexpected exception.
 * The engine catches all exceptions and converts them into this status so
 * that one broken detector never aborts the entire run.
 */
export type DetectorResultStatus = "ok" | "skipped" | "error";

export interface DetectorResult {
  /** Which detector produced this result. */
  readonly detectorType: DetectorType;

  /** Outcome of the detector's execution. */
  readonly status: DetectorResultStatus;

  /**
   * True when the detector found at least one anomaly worth surfacing.
   * Always `false` when status is "skipped" or "error".
   */
  readonly anomaliesFound: boolean;

  /**
   * Human-readable explanation of what was found (or why it was skipped /
   * errored). Shown in engine logs — not stored in the DB by this layer.
   */
  readonly message: string;

  /** Wall-clock milliseconds the detector took to run. */
  readonly durationMs: number;

  /**
   * Optional structured payload for future use.
   * When finding persistence is implemented, this is where the detector
   * will put its raw signal data (e.g. affected order IDs, amounts).
   * Kept as `unknown` intentionally — the persistence layer will type-narrow
   * based on `detectorType`.
   */
  readonly payload?: unknown;
}

// ---------------------------------------------------------------------------
// IDetector
//
// The single interface every detector MUST implement.
// Keeping it to one method (`run`) keeps the contract minimal and testable.
// ---------------------------------------------------------------------------

export interface IDetector {
  /**
   * The stable identifier for this detector.
   * Must match one of the values in the `detector_type` Postgres enum
   * (see src/db/schema.ts → detectorTypeEnum).
   */
  readonly type: DetectorType;

  /**
   * Human-readable name shown in logs and diagnostics.
   * Should match DETECTOR_META[type].label from src/lib/detectors.ts.
   */
  readonly name: string;

  /**
   * Analyse the shop described by `context` and return a result.
   *
   * Contracts:
   * - MUST NOT throw — return status "error" instead.
   * - MUST NOT write to the database.
   * - MUST NOT mutate `context`.
   * - MUST be idempotent: calling run() twice with the same context
   *   MUST produce equivalent results.
   *
   * @param context  Read-only shop snapshot provided by the engine.
   */
  run(context: DetectorContext): Promise<DetectorResult>;
}

// ---------------------------------------------------------------------------
// DetectionRun
//
// The aggregate result of one full engine execution across all (or a
// subset of) detectors for a single shop.
// ---------------------------------------------------------------------------

export interface DetectionRun {
  /** Internal UUID of the shop that was analysed. */
  readonly shopId: string;

  /** The myshopify.com domain. */
  readonly shopDomain: string;

  /** UTC timestamp when the engine started. */
  readonly startedAt: Date;

  /** UTC timestamp when the engine finished (all detectors done). */
  readonly completedAt: Date;

  /** Wall-clock duration of the full run. */
  readonly durationMs: number;

  /** Individual result from each detector that was dispatched. */
  readonly results: readonly DetectorResult[];

  /** True if any result has status "error". */
  readonly hasErrors: boolean;

  /** Number of detectors that found at least one anomaly. */
  readonly anomalyCount: number;
}

// ---------------------------------------------------------------------------
// EngineOptions
//
// Configuration passed to DetectionEngine.run().
// ---------------------------------------------------------------------------

export interface EngineRunOptions {
  /**
   * If provided, only these detector types will be executed.
   * If omitted, the engine runs all registered detectors.
   */
  readonly detectorTypes?: readonly DetectorType[];

  /**
   * Arbitrary metadata forwarded verbatim into DetectorContext.meta.
   * Useful for attaching sync job IDs, trigger sources, etc.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
}
