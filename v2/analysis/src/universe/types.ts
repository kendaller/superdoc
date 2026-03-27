// ---------------------------------------------------------------------------
// Universe Types
// ---------------------------------------------------------------------------
// All type definitions for Layer 1 analysis universe artifacts.
// These shapes are normative — field names and sort orders must match the
// plan in plans/analysis-universe.md.
// ---------------------------------------------------------------------------

import type { SourceRef } from '../raw-surface/types.js';

// ---------------------------------------------------------------------------
// Feature Registry
// ---------------------------------------------------------------------------

/** Controlled tier vocabulary for feature categorization. */
export type FeatureTier =
  | 'structural'
  | 'content'
  | 'formatting'
  | 'reference'
  | 'annotation'
  | 'resource';

/** How a feature rule claims raw facts. */
export type ClaimMode =
  | 'exclusive'   // sole claimer; conflict = build failure (default semantics)
  | 'absorbed'    // also absorbs child attribute facts from anchor element
  | 'shared';     // fact may be claimed by multiple rules

// ---------------------------------------------------------------------------
// Per-Document Universe
// ---------------------------------------------------------------------------

/** A single feature occurrence in a document. */
export type FeatureOccurrence = {
  occurrenceId: string;
  docId: string;
  featureKey: string;
  tier: FeatureTier;
  rawFactIds: string[];
  sourceRefs: SourceRef[];
  attributes?: Record<string, unknown>;
};

/** Document processing status. */
export type DocumentStatus = 'complete' | 'partial' | 'excluded';

/** Per-document universe artifact (document-universe.json). */
export type DocumentUniverse = {
  schemaVersion: 1;
  docId: string;
  docFingerprint: string;
  status: DocumentStatus;
  statusReason?: string;
  occurrences: FeatureOccurrence[];
  summary: {
    totalOccurrences: number;
    totalClaimedRawFacts: number;
    featureCounts: Record<string, number>;
  };
};

// ---------------------------------------------------------------------------
// Corpus Universe
// ---------------------------------------------------------------------------

/** Corpus-wide feature summary row. */
export type CorpusFeatureRow = {
  featureKey: string;
  tier: FeatureTier;
  docCount: number;
  occurrenceCount: number;
  claimedRawFactCount: number;
  exampleOccurrenceIds: string[];
};

/** Corpus-wide universe artifact (corpus-universe.json). */
export type CorpusUniverse = {
  schemaVersion: 1;
  totalDocuments: number;
  includedDocuments: number;
  partialDocuments: number;
  excludedDocuments: number;
  features: CorpusFeatureRow[];
};

// ---------------------------------------------------------------------------
// Feature Examples
// ---------------------------------------------------------------------------

/** A single example selection for a feature. */
export type ExampleSelection = {
  docId: string;
  occurrenceId: string;
  sourceRef: SourceRef;
};

/** Feature examples artifact (feature-examples.json). */
export type FeatureExamples = {
  schemaVersion: 1;
  examples: Array<{
    featureKey: string;
    selections: ExampleSelection[];
  }>;
};

// ---------------------------------------------------------------------------
// Unmapped Raw Surface
// ---------------------------------------------------------------------------

/** A single unmapped fact summary (lighter than full RawSurfaceFact). */
export type UnmappedFactEntry = {
  rawFactId: string;
  docId: string;
  partUri: string;
  partKind: string;
  factKind: string;
  pathSignature: string;
  qname?: string;
};

/** Unmapped raw surface artifact (unmapped-raw-surface.json). */
export type UnmappedRawSurface = {
  schemaVersion: 1;
  totalUnmapped: number;
  totalIgnoredByRule: number;
  unmappedFacts: UnmappedFactEntry[];
  ignoredByRuleSummary: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Universe Manifest
// ---------------------------------------------------------------------------

/** Per-document status in the manifest. */
export type ManifestDocumentStatus = {
  docId: string;
  status: DocumentStatus;
  reason?: string;
};

/** Universe manifest artifact (universe-manifest.json). */
export type UniverseManifest = {
  schemaVersion: 1;
  registryVersion: number;
  buildTimestamp: string;
  totalDocuments: number;
  includedDocuments: number;
  excludedDocuments: number;
  partialDocuments: number;
  documentStatus: ManifestDocumentStatus[];
};

// ---------------------------------------------------------------------------
// Build Results
// ---------------------------------------------------------------------------

/** Complete result from building the universe for a corpus. */
export type UniverseResult = {
  documentUniverses: DocumentUniverse[];
  corpusUniverse: CorpusUniverse;
  featureExamples: FeatureExamples;
  unmappedRawSurface: UnmappedRawSurface;
  universeManifest: UniverseManifest;
};
