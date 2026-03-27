// ---------------------------------------------------------------------------
// Runtime Bridge
// ---------------------------------------------------------------------------
// Shared runtime bridge types, ID generation, and artifact writing.
// ---------------------------------------------------------------------------

export type {
  RuntimeArtifactEnvelope,
  ObservationStage,
  TraceabilityLevel,
  UniverseLinkMode,
  UniverseLinks,
  SourceEvidenceRef,
  SourceEvidence,
  RuntimeEvidence,
  RuntimeObservation,
  RuntimeDocumentStatus,
  RuntimeManifest,
  RuntimeCapabilityEntry,
  RuntimeSummaryRow,
  RuntimeSummary,
  GapKind,
  RuntimeGapEntry,
  RuntimeGaps,
  SupportEvidenceSource,
  SupportMatrixRowEvidence,
} from './types.js';

export { buildObservationId } from './observation-id.js';
