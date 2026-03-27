// ---------------------------------------------------------------------------
// Write Support Matrix Artifacts
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { writeJson, ensureDir } from '../shared/write-helpers.js';
import type { SupportMatrix } from './types.js';

/**
 * Write the support matrix artifact to the output directory.
 */
export function writeSupportMatrixArtifacts(matrix: SupportMatrix, outputDir: string): void {
  const corpusDir = join(outputDir, 'corpus');
  ensureDir(corpusDir);
  writeJson(join(corpusDir, 'support-matrix.json'), matrix);
}
