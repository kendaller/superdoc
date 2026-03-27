// ---------------------------------------------------------------------------
// V1 Runtime Artifact Writer
// ---------------------------------------------------------------------------
// Writes v1 runtime artifacts to the shared output directory structure:
//
//   output/universe/docs/<slug>/runtime/v1/observations.json
//   output/universe/corpus/runtime/v1/manifest.json
//   output/universe/corpus/runtime/v1/capabilities.json
//   output/universe/corpus/runtime/v1/summary.json
//   output/universe/corpus/runtime/v1/gaps.json
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { writeJson, ensureDir } from '../../shared/write-helpers.js';
import type {
  RuntimeObservation,
  RuntimeManifest,
  RuntimeCapabilityEntry,
  RuntimeSummary,
  RuntimeGaps,
} from '../types.js';
import { wrapObservations } from './summarize.js';

// ---------------------------------------------------------------------------
// Per-document artifacts
// ---------------------------------------------------------------------------

/** Write per-document v1 runtime observations. */
export function writeDocObservations(
  baseDir: string,
  docSlug: string,
  observations: RuntimeObservation[],
  docId: string,
): void {
  const dir = join(baseDir, 'docs', docSlug, 'runtime', 'v1');
  ensureDir(dir);
  writeJson(join(dir, 'observations.json'), wrapObservations(observations, docId));
}

// ---------------------------------------------------------------------------
// Corpus-level artifacts
// ---------------------------------------------------------------------------

/** Write all corpus-level v1 runtime artifacts. */
export function writeCorpusRuntimeArtifacts(
  baseDir: string,
  manifest: RuntimeManifest,
  capabilities: RuntimeCapabilityEntry[],
  summary: RuntimeSummary,
  gaps: RuntimeGaps,
): void {
  const dir = join(baseDir, 'corpus', 'runtime', 'v1');
  ensureDir(dir);
  writeJson(join(dir, 'manifest.json'), manifest);
  writeJson(join(dir, 'capabilities.json'), capabilities);
  writeJson(join(dir, 'summary.json'), summary);
  writeJson(join(dir, 'gaps.json'), gaps);
}
