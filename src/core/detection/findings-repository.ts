/**
 * Findings Repository
 *
 * Persists Finding records and their associated Evidence to the database.
 * This is the ONLY place in the detection pipeline that writes to the DB.
 *
 * ── Duplicate Prevention Strategy ────────────────────────────────────────────
 *
 * Each FindingCandidate carries a `fingerprint` — a deterministic string
 * that identifies the specific issue. The composite uniqueness key is:
 *
 *   (shop_id, detector_type, fingerprint)
 *
 * Because the existing `findings` schema has no dedicated fingerprint column,
 * we encode the fingerprint as the FIRST element of the `root_causes` JSON
 * array using the sentinel prefix "__fp:". For example:
 *
 *   rootCauses = ["__fp:high_store_refund_rate", "Packaging issue", ...]
 *
 * On every run:
 *   • If a finding with the same fingerprint already exists → UPDATE
 *     (preserves status, firstDetectedAt; updates amounts, severity, etc.)
 *   • If no matching finding → INSERT with status "new"
 *   • Evidence rows are always replaced (delete + re-insert)
 *
 * This makes every detection run fully idempotent and safe to re-run.
 *
 * The fingerprint marker is stripped from rootCauses in lib/data.ts
 * before the data is returned to the UI layer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db } from "@/db";
import { findings, findingEvidence } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { FindingCandidate } from "./finding-payload";
import type { DetectorType } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PersistFindingsResult {
  inserted: number;
  updated: number;
  evidenceRows: number;
}

// ---------------------------------------------------------------------------
// Core persistence function
// ---------------------------------------------------------------------------

/**
 * Persist all finding candidates produced by a detector run for one shop.
 *
 * Upserts findings by (shopId, detectorType, fingerprint).
 * Replaces evidence rows on every run.
 *
 * @param shopId        Internal UUID of the shop
 * @param detectorType  Which detector produced these findings
 * @param candidates    Finding candidates from the detector payload
 */
export async function persistFindings(
  shopId: string,
  detectorType: DetectorType,
  candidates: FindingCandidate[],
): Promise<PersistFindingsResult> {
  let inserted = 0;
  let updated = 0;
  let evidenceRows = 0;

  // Load all existing findings for this shop+detector once
  const existingFindings = await db
    .select({
      id: findings.id,
      rootCauses: findings.rootCauses,
    })
    .from(findings)
    .where(
      and(
        eq(findings.shopId, shopId),
        eq(findings.detectorType, detectorType),
      ),
    );

  // Build a lookup map: fingerprint → finding id
  const fingerprintMap = new Map<string, string>();
  for (const row of existingFindings) {
    const fp = extractFingerprint(row.rootCauses as string[]);
    if (fp) fingerprintMap.set(fp, row.id);
  }

  for (const candidate of candidates) {
    const existingId = fingerprintMap.get(candidate.fingerprint);
    const now = new Date();

    const rootCausesWithFingerprint: string[] = [
      buildFingerprintMarker(candidate.fingerprint),
      ...candidate.rootCauses,
    ];

    let findingId: string;

    if (existingId) {
      // UPDATE — preserve status and firstDetectedAt
      await db
        .update(findings)
        .set({
          severity: candidate.severity,
          title: candidate.title,
          summary: candidate.summary,
          explanation: candidate.explanation,
          rootCauses: rootCausesWithFingerprint,
          recommendation: candidate.recommendation,
          recommendationSteps: candidate.recommendationSteps,
          monthlyImpact: candidate.monthlyImpact.toFixed(2),
          impactToDate: candidate.totalImpact.toFixed(2),
          confidence: candidate.confidence,
          affectedOrdersCount: candidate.affectedOrdersCount,
          lastDetectedAt: now,
          updatedAt: now,
        })
        .where(eq(findings.id, existingId));

      findingId = existingId;
      updated++;
    } else {
      // INSERT — new finding with status "new"
      const [created] = await db
        .insert(findings)
        .values({
          shopId,
          detectorType,
          severity: candidate.severity,
          status: "new",
          title: candidate.title,
          summary: candidate.summary,
          explanation: candidate.explanation,
          rootCauses: rootCausesWithFingerprint,
          recommendation: candidate.recommendation,
          recommendationSteps: candidate.recommendationSteps,
          monthlyImpact: candidate.monthlyImpact.toFixed(2),
          impactToDate: candidate.totalImpact.toFixed(2),
          recoveredAmount: "0",
          confidence: candidate.confidence,
          affectedOrdersCount: candidate.affectedOrdersCount,
          firstDetectedAt: now,
          lastDetectedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: findings.id });

      findingId = created!.id;
      inserted++;
    }

    // Replace evidence
    const rowsWritten = await replaceEvidence(findingId, candidate);
    evidenceRows += rowsWritten;
  }

  return { inserted, updated, evidenceRows };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Delete all evidence for a finding and insert fresh rows.
 * Returns the number of evidence rows written.
 */
async function replaceEvidence(
  findingId: string,
  candidate: FindingCandidate,
): Promise<number> {
  await db
    .delete(findingEvidence)
    .where(eq(findingEvidence.findingId, findingId));

  if (candidate.evidence.length === 0) return 0;

  await db.insert(findingEvidence).values(
    candidate.evidence.map((ev) => ({
      findingId,
      orderNumber: ev.orderNumber,
      occurredAt: ev.occurredAt,
      amount: ev.amount.toFixed(2),
      note: ev.note,
    })),
  );

  return candidate.evidence.length;
}

/**
 * Build the fingerprint marker stored as rootCauses[0].
 */
function buildFingerprintMarker(fingerprint: string): string {
  return `__fp:${fingerprint}`;
}

/**
 * Extract the fingerprint from a rootCauses array.
 * Returns null if the array doesn't contain a fingerprint marker at index 0.
 */
export function extractFingerprint(rootCauses: string[]): string | null {
  if (!rootCauses || rootCauses.length === 0) return null;
  const first = rootCauses[0];
  if (!first || !first.startsWith("__fp:")) return null;
  return first.slice("__fp:".length);
}
