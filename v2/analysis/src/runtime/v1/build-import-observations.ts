// ---------------------------------------------------------------------------
// Build Import Observations
// ---------------------------------------------------------------------------
// Consumes V1ResolvedProvenance and DocumentUniverse to produce
// RuntimeObservation[] for the import stage.
//
// The observation builder joins provenance against the universe by
// xpathLikePath — it does NOT re-run claim engine predicates.
// ---------------------------------------------------------------------------

import type { DocumentUniverse } from '../../universe/types.js';
import type { RuntimeObservation } from '../types.js';
import { buildObservationId } from '../observation-id.js';
import type { V1ResolvedProvenance, V1ResolvedBinding } from './types.js';
import { joinUniverseProvenance } from './universe-join.js';

/** Input for building import-stage observations. */
export type BuildImportObservationsInput = {
  provenance: V1ResolvedProvenance;
  universe: DocumentUniverse;
  docId: string;
};

/** Result of building import-stage observations. */
export type BuildImportObservationsResult = {
  observations: RuntimeObservation[];
  diagnostics: string[];
};

/**
 * Build import-stage runtime observations by joining provenance against universe.
 *
 * For each matched (anchor, occurrence) pair, emits an observation at the
 * strongest available traceability level. Occurrence-level observations carry
 * exact universe links; feature-level observations carry feature-only links.
 */
export function buildImportObservations(input: BuildImportObservationsInput): BuildImportObservationsResult {
  const { provenance, universe, docId } = input;
  const diagnostics: string[] = [];

  const anchorsById = new Map(provenance.sourceAnchors.map((anchor) => [anchor.anchorId, anchor] as const));
  const bindingsByAnchorId = indexBindingsByAnchorId(provenance.bindings);
  const boundAnchors = getBoundAnchors(provenance, anchorsById);
  const joinResult = joinUniverseProvenance(boundAnchors, universe);

  const exactByOccurrenceId = new Map<string, RuntimeObservation>();
  const featureOnlyByFeatureKey = new Map<string, FeatureOnlyAccumulator>();

  for (const match of joinResult.matched) {
    const { anchor, occurrence } = match;
    const matchingBindings = (bindingsByAnchorId.get(anchor.anchorId) ?? []).filter(
      (binding) => binding.featureKey === occurrence.featureKey,
    );
    if (matchingBindings.length === 0) continue;

    const bestTraceability = getBestTraceability(matchingBindings);
    if (bestTraceability === 'occurrence') {
      if (!exactByOccurrenceId.has(occurrence.occurrenceId)) {
        exactByOccurrenceId.set(
          occurrence.occurrenceId,
          buildExactObservation({
            docId,
            featureKey: occurrence.featureKey,
            occurrenceId: occurrence.occurrenceId,
            anchor,
            occurrence,
          }),
        );
      }
      continue;
    }

    let accumulator = featureOnlyByFeatureKey.get(occurrence.featureKey);
    if (!accumulator) {
      accumulator = createFeatureOnlyAccumulator(occurrence.featureKey);
      featureOnlyByFeatureKey.set(occurrence.featureKey, accumulator);
    }

    occurrence.rawFactIds.forEach((rawFactId) => accumulator.rawFactIds.add(rawFactId));
    accumulator.sourceRefs.add(buildSourceRefKey(anchor.partUri, anchor.xpathLikePath));
  }

  const exactFeatureKeys = new Set([...exactByOccurrenceId.values()].map((observation) => observation.featureKey));
  const featureOnlyObservations = [...featureOnlyByFeatureKey.values()]
    .filter((accumulator) => !exactFeatureKeys.has(accumulator.featureKey))
    .map((accumulator) => buildFeatureOnlyObservation(docId, accumulator));

  const observations = [...exactByOccurrenceId.values(), ...featureOnlyObservations].sort((a, b) =>
    compareObservations(a, b),
  );

  return { observations, diagnostics };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index bindings by their anchor IDs for fast lookup. */
function indexBindingsByAnchorId(
  bindings: readonly V1ResolvedBinding[],
): Map<string, V1ResolvedBinding[]> {
  const index = new Map<string, V1ResolvedBinding[]>();

  for (const binding of bindings) {
    for (const anchorId of binding.anchorIds) {
      let list = index.get(anchorId);
      if (!list) {
        list = [];
        index.set(anchorId, list);
      }
      list.push(binding);
    }
  }

  return index;
}

/** Get the best (strongest) traceability level from a set of bindings. */
function getBestTraceability(bindings: V1ResolvedBinding[]): 'occurrence' | 'feature' {
  for (const binding of bindings) {
    if (binding.traceability === 'occurrence') return 'occurrence';
  }
  return 'feature';
}

type FeatureOnlyAccumulator = {
  featureKey: string;
  rawFactIds: Set<string>;
  sourceRefs: Set<string>;
};

function getBoundAnchors(
  provenance: V1ResolvedProvenance,
  anchorsById: Map<string, V1ResolvedProvenance['sourceAnchors'][number]>,
) {
  const seen = new Set<string>();
  const boundAnchors = [];

  for (const binding of provenance.bindings) {
    for (const anchorId of binding.anchorIds) {
      if (seen.has(anchorId)) continue;
      const anchor = anchorsById.get(anchorId);
      if (!anchor) continue;
      seen.add(anchorId);
      boundAnchors.push(anchor);
    }
  }

  return boundAnchors;
}

function buildExactObservation(input: {
  docId: string;
  featureKey: string;
  occurrenceId: string;
  anchor: V1ResolvedProvenance['sourceAnchors'][number];
  occurrence: DocumentUniverse['occurrences'][number];
}): RuntimeObservation {
  const { docId, featureKey, occurrenceId, anchor, occurrence } = input;

  return {
    schemaVersion: 1,
    runtime: 'v1',
    docId,
    stage: 'import',
    traceabilityLevel: 'occurrence',
    observationId: buildObservationId({
      runtime: 'v1',
      docId,
      stage: 'import',
      featureKey,
      traceabilityLevel: 'occurrence',
      linkMode: 'exact',
      canonicalAnchor: occurrenceId,
    }),
    featureKey,
    universeLinks: {
      linkMode: 'exact',
      occurrenceIds: [occurrenceId],
    },
    sourceEvidence: {
      rawFactIds: [...occurrence.rawFactIds].sort(),
      sourceRefs: [{ partUri: anchor.partUri, xpathLikePath: anchor.xpathLikePath }],
    },
  };
}

function createFeatureOnlyAccumulator(featureKey: string): FeatureOnlyAccumulator {
  return {
    featureKey,
    rawFactIds: new Set<string>(),
    sourceRefs: new Set<string>(),
  };
}

function buildFeatureOnlyObservation(docId: string, accumulator: FeatureOnlyAccumulator): RuntimeObservation {
  return {
    schemaVersion: 1,
    runtime: 'v1',
    docId,
    stage: 'import',
    traceabilityLevel: 'feature',
    observationId: buildObservationId({
      runtime: 'v1',
      docId,
      stage: 'import',
      featureKey: accumulator.featureKey,
      traceabilityLevel: 'feature',
      linkMode: 'feature-only',
      canonicalAnchor: `feature:${accumulator.featureKey}`,
    }),
    featureKey: accumulator.featureKey,
    universeLinks: {
      linkMode: 'feature-only',
    },
    sourceEvidence: {
      rawFactIds: [...accumulator.rawFactIds].sort(),
      sourceRefs: [...accumulator.sourceRefs]
        .sort()
        .map((value) => {
          const [partUri, xpathLikePath] = value.split('\n');
          return { partUri, xpathLikePath };
        }),
    },
  };
}

function buildSourceRefKey(partUri: string, xpathLikePath: string): string {
  return `${partUri}\n${xpathLikePath}`;
}

function compareObservations(a: RuntimeObservation, b: RuntimeObservation): number {
  const featureCmp = a.featureKey.localeCompare(b.featureKey);
  if (featureCmp !== 0) return featureCmp;

  const aOccurrenceId = a.universeLinks?.occurrenceIds?.[0] ?? '';
  const bOccurrenceId = b.universeLinks?.occurrenceIds?.[0] ?? '';
  return aOccurrenceId.localeCompare(bOccurrenceId);
}
