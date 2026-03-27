// ---------------------------------------------------------------------------
// Super-Converter Analysis Layer
// ---------------------------------------------------------------------------
// Import provenance collection, source indexing, and resolved snapshots.
// This module is internal to super-editor — types are not exported to consumers.
// ---------------------------------------------------------------------------

export type {
  V1StoryKind,
  V1StoryRef,
  V1SourceAnchor,
  V1SourceIndex,
  V1BindingKind,
  V1BindingStatus,
  V1BindingMeta,
  V1RangeBindingMeta,
  V1CollectedBinding,
  V1CollectedProvenance,
  V1ProvenanceDiagnostic,
  V1StorySnapshot,
  V1ResolvedBinding,
  V1ResolvedProvenance,
  ImportProvenanceCollector,
} from './provenance-types.js';

export { buildAnchorId, toPathSignature } from './source-anchor.js';
export { createProvenanceCollector } from './provenance-collector.js';
export { buildSourceIndex } from './source-index.js';
export { resolveProvenance } from './resolved-provenance.js';
export type { StoryInput } from './resolved-provenance.js';

export { initImportProvenance, indexStoryPart, finalizeImportProvenance } from './import-snapshot.js';
export type { ImportProvenanceResult, ProvenanceResolutionInput } from './import-snapshot.js';

export { createProvenanceHooks, NULL_PROVENANCE_HOOKS } from './provenance-hooks.js';
export type { ProvenanceHooks } from './provenance-hooks.js';

export { createHeadlessEditor, headlessImport } from './headless-import.js';
export type { DocxFileEntry, HeadlessImportOptions, HeadlessImportResult } from './headless-import.js';
