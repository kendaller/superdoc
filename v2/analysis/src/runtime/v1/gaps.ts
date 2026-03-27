// ---------------------------------------------------------------------------
// Gap Detection
// ---------------------------------------------------------------------------
// Detects bidirectional gaps between the v1 runtime bridge and the universe:
//
//   1. universe-no-provenance: universe found a feature in the source, but
//      the importer has no provenance record for it
//   2. provenance-no-universe: the importer processed a source element that
//      the universe did not claim
//   3. degraded-traceability: a capability was declared at a higher
//      traceability level than actually achieved
// ---------------------------------------------------------------------------

import type { DocumentUniverse } from '../../universe/types.js';
import type { RuntimeGapEntry, RuntimeGaps, RuntimeObservation, RuntimeCapabilityEntry } from '../types.js';
import type { V1ResolvedProvenance } from './types.js';
import { joinUniverseProvenance } from './universe-join.js';
import { V1_ADAPTER_VERSION } from './capabilities.js';

/** Input for gap detection. */
export type DetectGapsInput = {
  provenance: V1ResolvedProvenance;
  universe: DocumentUniverse;
  observations: RuntimeObservation[];
  capabilities: RuntimeCapabilityEntry[];
  docId: string;
};

/**
 * Detect bidirectional gaps between v1 provenance and universe.
 */
export function detectGaps(input: DetectGapsInput): RuntimeGaps {
  const { provenance, universe, observations, capabilities, docId } = input;
  const gaps: RuntimeGapEntry[] = [];
  const boundAnchorIds = new Set(provenance.bindings.flatMap((binding) => binding.anchorIds));
  const boundAnchors = provenance.sourceAnchors.filter((anchor) => boundAnchorIds.has(anchor.anchorId));

  // Join to find unmatched entries
  const joinResult = joinUniverseProvenance(boundAnchors, universe);

  // Gap 1: universe occurrences with no provenance anchor
  for (const occ of joinResult.universeOnly) {
    gaps.push({
      gapKind: 'universe-no-provenance',
      docId,
      featureKey: occ.featureKey,
      occurrenceId: occ.occurrenceId,
      stage: 'import',
      detail: `Universe occurrence ${occ.occurrenceId} (${occ.featureKey}) has no matching provenance anchor`,
    });
  }

  // Gap 2: provenance anchors with no universe occurrence
  for (const anchor of joinResult.provenanceOnly) {
    gaps.push({
      gapKind: 'provenance-no-universe',
      docId,
      featureKey: undefined,
      stage: 'import',
      detail: `Provenance anchor ${anchor.anchorId} (${anchor.qname ?? 'unknown'} at ${anchor.xpathLikePath}) has no matching universe occurrence`,
    });
  }

  // Gap 3: degraded traceability
  const observationsByFeature = new Map<string, RuntimeObservation>();
  for (const obs of observations) {
    observationsByFeature.set(obs.featureKey, obs);
  }

  for (const cap of capabilities) {
    if (cap.runtime !== 'v1' || cap.stage !== 'import') continue;

    const obs = observationsByFeature.get(cap.featureKey);
    if (!obs) continue;

    if (
      cap.expectedTraceabilityLevel === 'occurrence' &&
      obs.traceabilityLevel === 'feature'
    ) {
      gaps.push({
        gapKind: 'degraded-traceability',
        docId,
        featureKey: cap.featureKey,
        stage: 'import',
        detail: `Expected ${cap.expectedTraceabilityLevel} traceability for ${cap.featureKey} but got ${obs.traceabilityLevel}`,
      });
    }
  }

  // Sort gaps deterministically
  gaps.sort((a, b) => {
    const kindCmp = a.gapKind.localeCompare(b.gapKind);
    if (kindCmp !== 0) return kindCmp;
    return (a.featureKey ?? '').localeCompare(b.featureKey ?? '');
  });

  return {
    schemaVersion: 1,
    runtime: 'v1',
    adapterVersion: V1_ADAPTER_VERSION,
    totalGaps: gaps.length,
    gaps,
  };
}
