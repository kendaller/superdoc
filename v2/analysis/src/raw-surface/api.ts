// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
// High-level entry points for raw surface analysis. These are the functions
// that consumers should call — everything else is internal.
// ---------------------------------------------------------------------------

import { scanDocument } from './scan-document.js';
import type { ScanDocumentOptions } from './scan-document.js';
import { summarizeCorpus } from './summarize-corpus.js';
import type { RawSurfaceDocumentResult, RawSurfaceCorpusResult, ScanCorpusOptions } from './types.js';

/**
 * Scan a single .docx file and return its complete raw surface analysis.
 *
 * @param input - Raw .docx bytes
 * @param docId - Human-readable document identifier (defaults to "document")
 * @param options - Optional scan settings (e.g. sourceRelativePath)
 */
export async function scanRawSurface(
  input: Uint8Array,
  docId = 'document',
  options?: ScanDocumentOptions,
): Promise<RawSurfaceDocumentResult> {
  return scanDocument(input, docId, options);
}

/**
 * Scan multiple .docx files and return per-document results plus corpus
 * aggregation (summary, signature matrix, examples by signature).
 *
 * @param inputs - Array of { bytes, docId, sourceRelativePath? } entries
 * @param options - Corpus scan options
 */
export async function scanRawSurfaceCorpus(
  inputs: Array<{ bytes: Uint8Array; docId: string; sourceRelativePath?: string }>,
  options?: ScanCorpusOptions,
): Promise<RawSurfaceCorpusResult> {
  const documents: RawSurfaceDocumentResult[] = [];

  for (const { bytes, docId, sourceRelativePath } of inputs) {
    const result = await scanDocument(bytes, docId, { sourceRelativePath });
    documents.push(result);
  }

  const { corpusSummary, signatureMatrix, examplesBySignature } = summarizeCorpus(documents, options);

  return { documents, corpusSummary, signatureMatrix, examplesBySignature };
}
