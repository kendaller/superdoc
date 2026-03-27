// ---------------------------------------------------------------------------
// Build Corpus Universe
// ---------------------------------------------------------------------------
// Aggregates per-document DocumentUniverse results into corpus-wide artifacts:
//   - CorpusUniverse (feature matrix with counts)
//   - UnmappedRawSurface (corpus-wide unmapped report)
//   - FeatureExamples (diverse examples per feature)
//   - UniverseManifest (build metadata)
// ---------------------------------------------------------------------------

import type { RawSurfaceDocumentResult } from '../raw-surface/types.js';
import type {
  DocumentUniverse,
  CorpusUniverse,
  CorpusFeatureRow,
  UnmappedRawSurface,
  UnmappedFactEntry,
  FeatureExamples,
  UniverseManifest,
  ManifestDocumentStatus,
  UniverseResult,
} from './types.js';
import { FEATURE_REGISTRY, REGISTRY_VERSION, getRegistryMap, type FeatureRule } from './feature-registry.js';
import { buildDocumentUniverse } from './build-document-universe.js';
import { selectFeatureExamples } from './select-examples.js';
import { claimFacts } from './claim-engine.js';
import { sortRecord } from '../shared/sort-helpers.js';

export type BuildCorpusUniverseOptions = {
  registry?: readonly FeatureRule[];
  maxExamplesPerFeature?: number;
  /** Override build timestamp for deterministic output in tests. */
  buildTimestamp?: string;
};

/**
 * Build the complete universe for a corpus of documents.
 *
 * Execution model: per-document pass first, then corpus aggregation.
 */
export function buildCorpusUniverse(
  docResults: readonly RawSurfaceDocumentResult[],
  options?: BuildCorpusUniverseOptions,
): UniverseResult {
  const registry = options?.registry ?? FEATURE_REGISTRY;
  const maxExamples = options?.maxExamplesPerFeature ?? 5;
  const buildTimestamp = options?.buildTimestamp ?? new Date().toISOString();

  // --- Per-document pass ---
  const documentUniverses: DocumentUniverse[] = [];
  const allUnmappedFacts: UnmappedFactEntry[] = [];
  const corpusIgnoredSummary: Record<string, number> = {};

  for (const docResult of docResults) {
    const du = buildDocumentUniverse(docResult, { registry });
    documentUniverses.push(du);

    // Collect unmapped facts and ignored summary from claim engine
    if (du.status !== 'excluded') {
      const claim = claimFacts(docResult.facts, registry, du.docId);

      for (const fact of claim.unmappedFacts) {
        allUnmappedFacts.push({
          rawFactId: fact.rawFactId,
          docId: fact.docId,
          partUri: fact.partUri,
          partKind: fact.partKind,
          factKind: fact.factKind,
          pathSignature: fact.pathSignature,
          qname: fact.qname ? `${fact.qname.prefix ? fact.qname.prefix + ':' : ''}${fact.qname.localName}` : undefined,
        });
      }

      for (const [key, count] of Object.entries(claim.ignoredByRuleSummary)) {
        corpusIgnoredSummary[key] = (corpusIgnoredSummary[key] ?? 0) + count;
      }
    }
  }

  // --- Corpus aggregation ---
  const includedDocs = documentUniverses.filter((du) => du.status !== 'excluded');
  const excludedDocs = documentUniverses.filter((du) => du.status === 'excluded');
  const partialDocs = documentUniverses.filter((du) => du.status === 'partial');
  const registryMap = getRegistryMap();

  // Build examples first so we can populate exampleOccurrenceIds in the feature matrix
  const featureExamples = selectFeatureExamples(includedDocs, maxExamples);
  const exampleIdsByFeature = buildExampleIdIndex(featureExamples);

  const corpusUniverse = aggregateFeatureMatrix(
    documentUniverses.length,
    includedDocs,
    excludedDocs.length,
    partialDocs.length,
    registryMap,
    exampleIdsByFeature,
  );

  // Sort unmapped facts deterministically
  allUnmappedFacts.sort((a, b) => a.docId.localeCompare(b.docId) || a.rawFactId.localeCompare(b.rawFactId));

  const unmappedRawSurface: UnmappedRawSurface = {
    schemaVersion: 1,
    totalUnmapped: allUnmappedFacts.length,
    totalIgnoredByRule: Object.values(corpusIgnoredSummary).reduce((sum, n) => sum + n, 0),
    unmappedFacts: allUnmappedFacts,
    ignoredByRuleSummary: sortRecord(corpusIgnoredSummary),
  };

  const universeManifest = buildManifest(documentUniverses, buildTimestamp);

  return {
    documentUniverses,
    corpusUniverse,
    featureExamples,
    unmappedRawSurface,
    universeManifest,
  };
}

// ---------------------------------------------------------------------------
// Example ID index
// ---------------------------------------------------------------------------

function buildExampleIdIndex(featureExamples: FeatureExamples): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const entry of featureExamples.examples) {
    index.set(entry.featureKey, entry.selections.map((s) => s.occurrenceId));
  }
  return index;
}

// ---------------------------------------------------------------------------
// Feature matrix aggregation
// ---------------------------------------------------------------------------

function aggregateFeatureMatrix(
  totalDocumentCount: number,
  includedDocs: readonly DocumentUniverse[],
  excludedCount: number,
  partialCount: number,
  registryMap: Map<string, FeatureRule>,
  exampleIdsByFeature: Map<string, string[]>,
): CorpusUniverse {
  const featureAgg = new Map<string, {
    docIds: Set<string>;
    occurrenceCount: number;
    claimedRawFactCount: number;
  }>();

  for (const du of includedDocs) {
    for (const occ of du.occurrences) {
      let agg = featureAgg.get(occ.featureKey);
      if (!agg) {
        agg = { docIds: new Set(), occurrenceCount: 0, claimedRawFactCount: 0 };
        featureAgg.set(occ.featureKey, agg);
      }

      agg.docIds.add(du.docId);
      agg.occurrenceCount++;
      agg.claimedRawFactCount += occ.rawFactIds.length;
    }
  }

  const features: CorpusFeatureRow[] = [];
  for (const [featureKey, agg] of [...featureAgg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rule = registryMap.get(featureKey);
    features.push({
      featureKey,
      tier: rule?.tier ?? 'content',
      docCount: agg.docIds.size,
      occurrenceCount: agg.occurrenceCount,
      claimedRawFactCount: agg.claimedRawFactCount,
      exampleOccurrenceIds: exampleIdsByFeature.get(featureKey) ?? [],
    });
  }

  return {
    schemaVersion: 1,
    totalDocuments: totalDocumentCount,
    includedDocuments: includedDocs.length,
    partialDocuments: partialCount,
    excludedDocuments: excludedCount,
    features,
  };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function buildManifest(
  documentUniverses: readonly DocumentUniverse[],
  buildTimestamp: string,
): UniverseManifest {
  const documentStatus: ManifestDocumentStatus[] = documentUniverses
    .map((du) => ({
      docId: du.docId,
      status: du.status,
      reason: du.statusReason,
    }))
    .sort((a, b) => a.docId.localeCompare(b.docId));

  const included = documentUniverses.filter((du) => du.status !== 'excluded');
  const excluded = documentUniverses.filter((du) => du.status === 'excluded');
  const partial = documentUniverses.filter((du) => du.status === 'partial');

  return {
    schemaVersion: 1,
    registryVersion: REGISTRY_VERSION,
    buildTimestamp,
    totalDocuments: documentUniverses.length,
    includedDocuments: included.length,
    excludedDocuments: excluded.length,
    partialDocuments: partial.length,
    documentStatus,
  };
}
