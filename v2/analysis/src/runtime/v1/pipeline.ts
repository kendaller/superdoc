// ---------------------------------------------------------------------------
// V1 Runtime Bridge Pipeline
// ---------------------------------------------------------------------------
// Orchestrates the full v1 bridge pipeline for a single document:
//
//   V1ResolvedProvenance + DocumentUniverse
//     → observations + gaps
//
// This module consumes pre-built provenance (as JSON) and the document
// universe. It does NOT run the import pipeline — that responsibility
// belongs to the headless import wrapper in super-editor.
//
// Corpus-level aggregation is handled by buildRuntimeSummary and
// buildRuntimeManifest.
// ---------------------------------------------------------------------------

import type { DocumentUniverse } from '../../universe/types.js';
import type { RuntimeObservation, RuntimeGaps } from '../types.js';
import type { V1ResolvedProvenance } from './types.js';
import { buildImportObservations, type BuildImportObservationsResult } from './build-import-observations.js';
import { detectGaps } from './gaps.js';
import { buildV1Capabilities } from './capabilities.js';

/** Input for running the v1 bridge pipeline on a single document. */
export type V1PipelineInput = {
  provenance: V1ResolvedProvenance;
  universe: DocumentUniverse;
  docId: string;
};

/** Output from the v1 bridge pipeline for a single document. */
export type V1PipelineResult = {
  observations: RuntimeObservation[];
  gaps: RuntimeGaps;
  diagnostics: string[];
};

/**
 * Run the full v1 bridge pipeline for a single document.
 *
 * Takes pre-built provenance and universe, produces observations and gaps.
 */
export function runV1Pipeline(input: V1PipelineInput): V1PipelineResult {
  const { provenance, universe, docId } = input;
  const capabilities = buildV1Capabilities();

  // Build import-stage observations by joining provenance against universe
  const observationResult: BuildImportObservationsResult = buildImportObservations({
    provenance,
    universe,
    docId,
  });

  // Detect bidirectional gaps
  const gaps = detectGaps({
    provenance,
    universe,
    observations: observationResult.observations,
    capabilities,
    docId,
  });

  return {
    observations: observationResult.observations,
    gaps,
    diagnostics: observationResult.diagnostics,
  };
}
