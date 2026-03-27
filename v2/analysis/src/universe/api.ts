// ---------------------------------------------------------------------------
// Universe Public API
// ---------------------------------------------------------------------------
// Top-level entry points for building the analysis universe.
// ---------------------------------------------------------------------------

import type { RawSurfaceDocumentResult } from '../raw-surface/types.js';
import type { UniverseResult } from './types.js';
import { buildCorpusUniverse, type BuildCorpusUniverseOptions } from './build-corpus-universe.js';

export { buildDocumentUniverse } from './build-document-universe.js';
export type { BuildDocumentUniverseOptions } from './build-document-universe.js';
export type { BuildCorpusUniverseOptions } from './build-corpus-universe.js';

/**
 * Build the complete analysis universe from raw-surface results.
 *
 * This is the main entry point for Layer 1. It processes each document
 * independently, then aggregates corpus-level results.
 */
export function buildUniverseFromCorpus(
  docResults: readonly RawSurfaceDocumentResult[],
  options?: BuildCorpusUniverseOptions,
): UniverseResult {
  return buildCorpusUniverse(docResults, options);
}
