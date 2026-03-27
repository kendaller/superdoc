// ---------------------------------------------------------------------------
// Raw Surface — Public API
// ---------------------------------------------------------------------------
// The two entry points for raw surface analysis:
//   scanRawSurface()       — single document
//   scanRawSurfaceCorpus() — multiple documents with corpus aggregation
// ---------------------------------------------------------------------------

export { scanRawSurface, scanRawSurfaceCorpus } from './api.js';

// Re-export types for consumers
export type { ScanDocumentOptions } from './scan-document.js';
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
} from './types.js';

// Export the canonical namespace table for tests and higher layers
export { CANONICAL_NAMESPACE_PREFIXES, resolveCanonicalPrefix } from './canonical-namespaces.js';
