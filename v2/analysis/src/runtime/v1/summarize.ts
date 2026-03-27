// ---------------------------------------------------------------------------
// Runtime Summary Builder
// ---------------------------------------------------------------------------
// Aggregates per-document runtime observations into corpus-level summaries.
// ---------------------------------------------------------------------------

import type {
  RuntimeObservation,
  RuntimeSummary,
  RuntimeSummaryRow,
  RuntimeManifest,
  RuntimeDocumentStatus,
  RuntimeArtifactEnvelope,
} from '../types.js';
import { V1_ADAPTER_VERSION } from './capabilities.js';
import { REGISTRY_VERSION } from '../../universe/feature-registry.js';

// ---------------------------------------------------------------------------
// Per-document manifest entry
// ---------------------------------------------------------------------------

/** Build a manifest entry for a single document. */
export function buildDocumentManifestEntry(
  docId: string,
  observations: RuntimeObservation[],
  status: 'ok' | 'partial' | 'failed' | 'skipped' = 'ok',
  diagnostics?: string[],
): RuntimeDocumentStatus {
  return {
    docId,
    status,
    stagesRun: ['import'],
    observationCount: observations.length,
    diagnostics: diagnostics?.length ? diagnostics : undefined,
  };
}

// ---------------------------------------------------------------------------
// Corpus-level manifest
// ---------------------------------------------------------------------------

/** Build the corpus-level runtime manifest from per-document entries. */
export function buildRuntimeManifest(documents: RuntimeDocumentStatus[]): RuntimeManifest {
  return {
    schemaVersion: 1,
    runtime: 'v1',
    adapterVersion: V1_ADAPTER_VERSION,
    universeRegistryVersion: REGISTRY_VERSION,
    documents: [...documents].sort((a, b) => a.docId.localeCompare(b.docId)),
  };
}

// ---------------------------------------------------------------------------
// Corpus-level summary
// ---------------------------------------------------------------------------

/**
 * Build a corpus-level summary from all per-document observations.
 *
 * Aggregates observation counts by featureKey, stage, and traceability level.
 */
export function buildRuntimeSummary(
  allObservations: RuntimeObservation[][],
): RuntimeSummary {
  // Aggregate by compound key: featureKey + stage + traceabilityLevel
  const aggregation = new Map<string, { row: RuntimeSummaryRow; docIds: Set<string> }>();

  for (const docObservations of allObservations) {
    for (const obs of docObservations) {
      const key = `${obs.featureKey}|${obs.stage}|${obs.traceabilityLevel}`;
      let entry = aggregation.get(key);

      if (!entry) {
        entry = {
          row: {
            featureKey: obs.featureKey,
            stage: obs.stage,
            docCount: 0,
            observationCount: 0,
            traceabilityLevel: obs.traceabilityLevel,
          },
          docIds: new Set(),
        };
        aggregation.set(key, entry);
      }

      entry.row.observationCount++;
      entry.docIds.add(obs.docId);
    }
  }

  // Finalize doc counts and sort
  const rows: RuntimeSummaryRow[] = [];
  for (const entry of aggregation.values()) {
    entry.row.docCount = entry.docIds.size;
    rows.push(entry.row);
  }

  rows.sort((a, b) =>
    a.featureKey.localeCompare(b.featureKey) || a.stage.localeCompare(b.stage),
  );

  return {
    schemaVersion: 1,
    runtime: 'v1',
    adapterVersion: V1_ADAPTER_VERSION,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Observation Envelope
// ---------------------------------------------------------------------------

/** Wrap observations in a RuntimeArtifactEnvelope for serialization. */
export function wrapObservations(
  observations: RuntimeObservation[],
  docId?: string,
): RuntimeArtifactEnvelope<RuntimeObservation> {
  return {
    schemaVersion: 1,
    runtime: 'v1',
    adapterVersion: V1_ADAPTER_VERSION,
    universeRegistryVersion: REGISTRY_VERSION,
    docId,
    sortOrder: 'featureKey ascending',
    rows: observations,
  };
}
