// ---------------------------------------------------------------------------
// @superdoc/v2-analysis
// ---------------------------------------------------------------------------
// Raw OOXML surface analysis and corpus auditing.
// ---------------------------------------------------------------------------

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
