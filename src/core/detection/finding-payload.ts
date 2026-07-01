/**
 * Finding Payload Types
 *
 * These types describe the structured payload that detectors attach to
 * DetectorResult.payload. The persistence layer (findings-repository.ts)
 * reads these payloads and writes them to the database.
 *
 * Using typed payloads instead of raw `unknown` allows the persistence
 * layer to safely type-narrow without casting.
 */

import type { FindingSeverity } from "./types";

// ---------------------------------------------------------------------------
// Evidence item — maps to a finding_evidence row
// ---------------------------------------------------------------------------

export interface FindingEvidenceItem {
  /** Shopify order name e.g. "#1001" */
  orderNumber: string;
  /** When this evidence event occurred */
  occurredAt: Date;
  /** Monetary amount associated with this evidence row */
  amount: number;
  /** Human-readable explanation of what this evidence shows */
  note: string;
}

// ---------------------------------------------------------------------------
// A single finding candidate produced by a detector sub-check
// ---------------------------------------------------------------------------

export interface FindingCandidate {
  /**
   * Stable identifier for this finding within the detector.
   * Used for duplicate detection: if a finding with the same
   * (shopId + detectorType + fingerprint) already exists, it is
   * updated rather than duplicated.
   *
   * Must be deterministic — same data → same fingerprint.
   */
  fingerprint: string;

  /** Severity level */
  severity: FindingSeverity;

  /** One-line title */
  title: string;

  /** Two-sentence summary shown in the findings list */
  summary: string;

  /** Detailed narrative paragraph shown in the finding detail */
  explanation: string;

  /** Root causes (bullet points on the detail page) */
  rootCauses: string[];

  /** Short recommendation (one paragraph) */
  recommendation: string;

  /** Numbered recommendation steps */
  recommendationSteps: string[];

  /** Recurring monthly financial impact in the shop's currency */
  monthlyImpact: number;

  /** Total impact accumulated to date */
  totalImpact: number;

  /** Number of orders affected by this finding */
  affectedOrdersCount: number;

  /** Confidence score 0–100 */
  confidence: number;

  /** Evidence items (up to ~10 representative rows) */
  evidence: FindingEvidenceItem[];
}

// ---------------------------------------------------------------------------
// Payload attached to DetectorResult.payload for refund_leak
// ---------------------------------------------------------------------------

export interface RefundLeakPayload {
  /** All individual finding candidates produced in this run */
  findings: FindingCandidate[];
}

// ---------------------------------------------------------------------------
// Payload attached to DetectorResult.payload for shipping_leak
// ---------------------------------------------------------------------------

export interface ShippingLeakPayload {
  /** All individual finding candidates produced in this run */
  findings: FindingCandidate[];
}
