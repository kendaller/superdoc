// ---------------------------------------------------------------------------
// @superdoc/v2-analysis
// ---------------------------------------------------------------------------
// Raw OOXML surface analysis, corpus auditing, and universe building.
// ---------------------------------------------------------------------------

// Layer 0: Raw surface
export {
  scanRawSurface,
  scanRawSurfaceCorpus,
  CANONICAL_NAMESPACE_PREFIXES,
  resolveCanonicalPrefix,
} from './raw-surface/index.js';

export type {
  RawSurfaceFact,
  RawSurfaceDocumentResult,
  RawSurfaceCorpusResult,
  ScanCorpusOptions,
  PackageIndex,
  RawDocSummary,
  CorpusRawSummary,
  SignatureMatrixEntry,
  SignatureExample,
  QualifiedName,
  SourceRef,
  NormalizedValue,
  MarkupCompatibilityContext,
  PartKind,
  FactKind,
  ValueKind,
  PackageEntry,
  RelationshipRecord,
  ScanDiagnostic,
  DocMetadata,
} from './raw-surface/index.js';

// Corpus manifest
export { loadCorpusManifest, resolveManifestInputs } from './corpus-manifest/index.js';
export type { CorpusManifest, CorpusManifestEntry } from './corpus-manifest/index.js';

// Layer 1: Universe
export {
  buildUniverseFromCorpus,
  buildDocumentUniverse,
  writeUniverseArtifacts,
  FEATURE_REGISTRY,
  REGISTRY_VERSION,
  getRegistryMap,
  CONTENT_BEARING_PARTS,
  isContentBearing,
} from './universe/index.js';

export type {
  FeatureTier,
  ClaimMode,
  FeatureOccurrence,
  DocumentStatus,
  DocumentUniverse,
  CorpusFeatureRow,
  CorpusUniverse,
  ExampleSelection,
  FeatureExamples,
  UnmappedFactEntry,
  UnmappedRawSurface,
  ManifestDocumentStatus,
  UniverseManifest,
  UniverseResult,
  FeatureRule,
  BuildCorpusUniverseOptions,
  BuildDocumentUniverseOptions,
} from './universe/index.js';

// Layer 2: Support matrix
export { buildSupportMatrix, writeSupportMatrixArtifacts } from './support-matrix/index.js';

// Runtime bridge
export { buildObservationId } from './runtime/index.js';

export type {
  RuntimeArtifactEnvelope,
  ObservationStage,
  TraceabilityLevel,
  UniverseLinkMode,
  RuntimeObservation,
  RuntimeManifest,
  RuntimeCapabilityEntry,
  RuntimeSummary,
  RuntimeGaps,
  SupportEvidenceSource,
  SupportMatrixRowEvidence,
} from './runtime/index.js';

// Runtime bridge: V1 adapter
export {
  buildImportObservations,
  detectGaps,
  buildRuntimeSummary,
  buildV1Capabilities,
  V1_ADAPTER_VERSION,
} from './runtime/v1/index.js';

export type {
  V1StoryKind,
  V1StoryRef,
  V1SourceAnchor,
  V1ResolvedProvenance,
  V1ResolvedBinding,
} from './runtime/v1/index.js';

// Shared utilities
export { fnv1a64, formatXpathLikePath, formatPathSignature, stripIndicesToSignature } from './shared/index.js';
export type {
  SupportStatus,
  SupportInputEntry,
  SupportInput,
  SupportMatrixRow,
  SupportMatrix,
} from './support-matrix/index.js';
