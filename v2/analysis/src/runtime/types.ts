// ---------------------------------------------------------------------------
// Runtime Artifact Types
// ---------------------------------------------------------------------------
// Shared type definitions for runtime bridge artifacts. These types define
// the serialized JSON shapes emitted by any runtime adapter (v1, v2, etc.).
//
// Packages that produce these artifacts (e.g., super-editor) emit plain JSON
// conforming to these types. They do NOT import from this module at runtime.
// Type safety is maintained by schema-validation tests.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Top-level wrapper for every emitted runtime artifact file. */
export type RuntimeArtifactEnvelope<T> = {
  schemaVersion: 1;
  runtime: string;
  adapterVersion: string;
  universeRegistryVersion: number;
  docId?: string;
  sortOrder: string;
  rows: T[];
};

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export type ObservationStage = 'import' | 'layout';
export type TraceabilityLevel = 'feature' | 'occurrence' | 'layout';
export type UniverseLinkMode = 'feature-only' | 'exact' | 'composite';

export type UniverseLinks = {
  linkMode: UniverseLinkMode;
  occurrenceIds?: string[];
};

export type SourceEvidenceRef = {
  partUri: string;
  xpathLikePath?: string;
};

export type SourceEvidence = {
  rawFactIds?: string[];
  sourceRefs?: SourceEvidenceRef[];
};

export type RuntimeEvidence = {
  refs: Record<string, string | number | boolean | null>;
};

/** A single feature-granular runtime observation. */
export type RuntimeObservation = {
  schemaVersion: 1;
  runtime: string;
  docId: string;
  stage: ObservationStage;
  traceabilityLevel: TraceabilityLevel;
  observationId: string;
  featureKey: string;
  parentObservationId?: string;
  universeLinks?: UniverseLinks;
  sourceEvidence?: SourceEvidence;
  runtimeEvidence?: RuntimeEvidence;
  diagnostics?: string[];
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export type RuntimeDocumentStatus = {
  docId: string;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  stagesRun: ObservationStage[];
  observationCount: number;
  diagnostics?: string[];
};

/** Corpus-level runtime manifest. */
export type RuntimeManifest = {
  schemaVersion: 1;
  runtime: string;
  adapterVersion: string;
  universeRegistryVersion: number;
  documents: RuntimeDocumentStatus[];
};

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

/** Declares what a runtime adapter can observe for a given feature+stage. */
export type RuntimeCapabilityEntry = {
  runtime: string;
  stage: ObservationStage;
  featureKey: string;
  expectedTraceabilityLevel: TraceabilityLevel;
};

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export type RuntimeSummaryRow = {
  featureKey: string;
  stage: ObservationStage;
  docCount: number;
  observationCount: number;
  traceabilityLevel: TraceabilityLevel;
};

export type RuntimeSummary = {
  schemaVersion: 1;
  runtime: string;
  adapterVersion: string;
  rows: RuntimeSummaryRow[];
};

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

export type GapKind =
  | 'universe-no-provenance'
  | 'provenance-no-universe'
  | 'degraded-traceability';

export type RuntimeGapEntry = {
  gapKind: GapKind;
  docId: string;
  featureKey?: string;
  occurrenceId?: string;
  stage?: ObservationStage;
  detail: string;
};

export type RuntimeGaps = {
  schemaVersion: 1;
  runtime: string;
  adapterVersion: string;
  totalGaps: number;
  gaps: RuntimeGapEntry[];
};

// ---------------------------------------------------------------------------
// Support-Matrix Evidence Provenance
// ---------------------------------------------------------------------------

export type SupportEvidenceSource = 'manual' | 'v1-adapter' | 'v2-adapter';

export type SupportMatrixRowEvidence = {
  import: SupportEvidenceSource;
  layout: SupportEvidenceSource;
  render: SupportEvidenceSource;
  semanticRead: SupportEvidenceSource;
  semanticWrite: SupportEvidenceSource;
};
