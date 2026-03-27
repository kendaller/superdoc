// ---------------------------------------------------------------------------
// Write Universe Artifacts
// ---------------------------------------------------------------------------
// Writes all Layer 1 universe artifacts to the output directory.
//
// Output layout:
//   <out>/docs/<doc-slug>/document-universe.json
//   <out>/corpus/corpus-universe.json
//   <out>/corpus/feature-examples.json
//   <out>/corpus/unmapped-raw-surface.json
//   <out>/corpus/universe-manifest.json
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { writeJson, ensureDir } from '../shared/write-helpers.js';
import { toSlug } from '../raw-surface/write-artifacts.js';
import type { UniverseResult } from './types.js';

/**
 * Write all universe artifacts for a corpus.
 */
export function writeUniverseArtifacts(result: UniverseResult, outputDir: string): void {
  // Per-document artifacts
  for (const du of result.documentUniverses) {
    if (du.status === 'excluded') continue;

    const slug = toSlug(du.docId, du.docFingerprint);
    const docDir = join(outputDir, 'docs', slug);
    ensureDir(docDir);
    writeJson(join(docDir, 'document-universe.json'), du);
  }

  // Corpus artifacts
  const corpusDir = join(outputDir, 'corpus');
  ensureDir(corpusDir);
  writeJson(join(corpusDir, 'corpus-universe.json'), result.corpusUniverse);
  writeJson(join(corpusDir, 'feature-examples.json'), result.featureExamples);
  writeJson(join(corpusDir, 'unmapped-raw-surface.json'), result.unmappedRawSurface);
  writeJson(join(corpusDir, 'universe-manifest.json'), result.universeManifest);
}
