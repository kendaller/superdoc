// ---------------------------------------------------------------------------
// Import Snapshot Orchestrator
// ---------------------------------------------------------------------------
// Orchestrates the full provenance lifecycle for a single document import:
//
//   1. Build source index (pre-traversal) for each story
//   2. Collect provenance during handler traversal (handlers call collector)
//   3. Resolve collected provenance to PM positions (post-import)
//
// The orchestrator is called by the import pipeline when provenance is
// enabled. It produces a V1ResolvedProvenance snapshot that can be serialized
// to JSON and consumed by v2/analysis.
// ---------------------------------------------------------------------------

import type { Schema } from 'prosemirror-model';
import { buildSourceIndex } from './source-index.js';
import { createProvenanceCollector } from './provenance-collector.js';
import { resolveProvenance, type StoryInput } from './resolved-provenance.js';
import type { ImportProvenanceCollector, V1SourceIndex, V1StoryRef, V1ResolvedProvenance } from './provenance-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of the import-stage provenance orchestration. */
export type ImportProvenanceResult = {
  collector: ImportProvenanceCollector;
  sourceIndices: Map<string, V1SourceIndex>;
};

/** All data needed to resolve provenance after import completes. */
export type ProvenanceResolutionInput = {
  collector: ImportProvenanceCollector;
  schema: Schema;
  docId: string;
  docFingerprint?: string;
  stories: StoryInput[];
};

// ---------------------------------------------------------------------------
// Pre-import: create collector and build source indices
// ---------------------------------------------------------------------------

/**
 * Initialize provenance collection for a document import.
 *
 * Call this at the start of createDocumentJson() when provenance is enabled.
 * Returns a collector and a map of per-part source indices.
 */
export function initImportProvenance(): ImportProvenanceResult {
  return {
    collector: createProvenanceCollector(),
    sourceIndices: new Map(),
  };
}

/**
 * Build and register a source index for a single XML part.
 *
 * Must be called BEFORE handler traversal for that part.
 * Must be called on the carbonCopy'd XML elements (not converter.convertedXml).
 */
export function indexStoryPart(
  result: ImportProvenanceResult,
  partUri: string,
  storyRef: V1StoryRef,
  rootElements: unknown[],
): V1SourceIndex {
  const index = buildSourceIndex(rootElements as any[], partUri, storyRef.storyKind);
  result.sourceIndices.set(storyRef.storyKey, index);
  result.collector.setStoryContext(storyRef);
  return index;
}

// ---------------------------------------------------------------------------
// Post-import: resolve to PM positions
// ---------------------------------------------------------------------------

/**
 * Finalize and resolve provenance after import completes.
 *
 * Produces the V1ResolvedProvenance snapshot with PM position ranges.
 */
export function finalizeImportProvenance(input: ProvenanceResolutionInput): V1ResolvedProvenance {
  const collected = input.collector.finalize();
  return resolveProvenance(collected, input.stories, input.docId, input.docFingerprint);
}
