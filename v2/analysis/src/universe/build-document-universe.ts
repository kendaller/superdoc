// ---------------------------------------------------------------------------
// Build Document Universe
// ---------------------------------------------------------------------------
// Per-document universe builder: takes a RawSurfaceDocumentResult and
// produces a DocumentUniverse with all claimed/ignored/unmapped accounting.
//
// Handles degraded input:
//   - Failed main-document → excluded
//   - Partial content-bearing part → partial status
// ---------------------------------------------------------------------------

import type { RawSurfaceDocumentResult, PackageEntry } from '../raw-surface/types.js';
import type { DocumentUniverse, DocumentStatus } from './types.js';
import { FEATURE_REGISTRY, type FeatureRule } from './feature-registry.js';
import { claimFacts } from './claim-engine.js';
import { checkHonestyInvariant } from './honesty-check.js';
import { isContentBearing } from './part-scope.js';
import { sortRecord } from '../shared/sort-helpers.js';

export type BuildDocumentUniverseOptions = {
  registry?: readonly FeatureRule[];
};

/**
 * Build the universe for a single document.
 *
 * Returns a DocumentUniverse with status, occurrences, and summary.
 * Excluded documents have empty occurrences.
 */
export function buildDocumentUniverse(
  docResult: RawSurfaceDocumentResult,
  options?: BuildDocumentUniverseOptions,
): DocumentUniverse {
  const registry = options?.registry ?? FEATURE_REGISTRY;
  const { docId, docFingerprint } = docResult.metadata;

  // --- Check degraded input ---
  const { status, statusReason } = detectDocumentStatus(docResult.packageIndex.entries);

  if (status === 'excluded') {
    return {
      schemaVersion: 1,
      docId,
      docFingerprint,
      status: 'excluded',
      statusReason,
      occurrences: [],
      summary: {
        totalOccurrences: 0,
        totalClaimedRawFacts: 0,
        featureCounts: {},
      },
    };
  }

  // --- Run claim engine ---
  const claim = claimFacts(docResult.facts, registry, docId);

  // --- Verify honesty invariant ---
  const honesty = checkHonestyInvariant(
    docResult.facts.length,
    claim.claimedFactCount,
    claim.ignoredFactCount,
    claim.unmappedFacts.length,
  );

  if (!honesty.passed) {
    throw new Error(`Honesty invariant failed for ${docId}: ${honesty.details}`);
  }

  // --- Build feature counts ---
  const featureCounts: Record<string, number> = {};
  for (const occ of claim.occurrences) {
    featureCounts[occ.featureKey] = (featureCounts[occ.featureKey] ?? 0) + 1;
  }

  // --- Sort occurrences deterministically ---
  const sortedOccurrences = [...claim.occurrences].sort((a, b) =>
    a.featureKey.localeCompare(b.featureKey) || a.occurrenceId.localeCompare(b.occurrenceId),
  );

  return {
    schemaVersion: 1,
    docId,
    docFingerprint,
    status,
    statusReason,
    occurrences: sortedOccurrences,
    summary: {
      totalOccurrences: claim.occurrences.length,
      totalClaimedRawFacts: claim.claimedFactCount,
      featureCounts: sortRecord(featureCounts),
    },
  };
}

// ---------------------------------------------------------------------------
// Degraded input detection
// ---------------------------------------------------------------------------

function detectDocumentStatus(
  entries: readonly PackageEntry[],
): { status: DocumentStatus; statusReason?: string } {
  // Check if main-document part failed
  const mainDoc = entries.find((e) => e.partKind === 'main-document');
  if (mainDoc && mainDoc.parseStatus === 'failed') {
    return { status: 'excluded', statusReason: 'main-document parse failed' };
  }

  // Check if any content-bearing part is partial
  for (const entry of entries) {
    if (isContentBearing(entry.partKind) && entry.parseStatus === 'partial') {
      return { status: 'partial', statusReason: `${entry.path} parse was partial` };
    }
  }

  return { status: 'complete' };
}
