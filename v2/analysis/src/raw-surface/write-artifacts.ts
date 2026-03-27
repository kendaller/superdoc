// ---------------------------------------------------------------------------
// Write Artifacts
// ---------------------------------------------------------------------------
// Writes per-document and corpus-wide artifacts to the output directory.
// Output layout:
//   <out>/docs/<doc-slug>/metadata.json
//   <out>/docs/<doc-slug>/package-index.json
//   <out>/docs/<doc-slug>/raw-surface.ndjson
//   <out>/docs/<doc-slug>/raw-summary.json
//   <out>/docs/<doc-slug>/raw-examples-by-signature.json
//   <out>/corpus/corpus-raw-summary.json
//   <out>/corpus/raw-signature-matrix.json
//   <out>/corpus/raw-examples-by-signature.json
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RawSurfaceDocumentResult, CorpusRawSummary, SignatureMatrixEntry, SignatureExample } from './types.js';
import { buildDocumentExamplesBySignature } from './examples.js';

/** Create a filesystem-safe slug from a docId. */
function toBaseSlug(docId: string): string {
  const slug = docId
    .replace(/[/\\]/g, '__')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return slug || 'document';
}

/** Create a deterministic, collision-safe directory slug for a document. */
function toSlug(docId: string, docFingerprint: string): string {
  const base = toBaseSlug(docId);
  return `${base}__${docFingerprint.slice(0, 8)}`;
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function writeNdjson(filePath: string, records: unknown[]): void {
  const lines = records.map((r) => JSON.stringify(r));
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

/** Write all per-document artifacts to the output directory. */
export function writeDocumentArtifacts(result: RawSurfaceDocumentResult, outputDir: string): void {
  const slug = toSlug(result.metadata.docId, result.metadata.docFingerprint);
  const docDir = join(outputDir, 'docs', slug);
  ensureDir(docDir);

  writeJson(join(docDir, 'metadata.json'), result.metadata);
  writeJson(join(docDir, 'package-index.json'), result.packageIndex);
  writeNdjson(join(docDir, 'raw-surface.ndjson'), result.facts);
  writeJson(join(docDir, 'raw-summary.json'), result.summary);
  writeJson(join(docDir, 'raw-examples-by-signature.json'), buildDocumentExamplesBySignature(result.facts));
}

/** Write all corpus-wide artifacts to the output directory. */
export function writeCorpusArtifacts(
  corpusSummary: CorpusRawSummary,
  signatureMatrix: SignatureMatrixEntry[],
  examplesBySignature: SignatureExample[],
  outputDir: string,
): void {
  const corpusDir = join(outputDir, 'corpus');
  ensureDir(corpusDir);

  writeJson(join(corpusDir, 'corpus-raw-summary.json'), corpusSummary);
  writeJson(join(corpusDir, 'raw-signature-matrix.json'), signatureMatrix);
  writeJson(join(corpusDir, 'raw-examples-by-signature.json'), examplesBySignature);
}
