// ---------------------------------------------------------------------------
// Scan Document
// ---------------------------------------------------------------------------
// Orchestrates the full single-document scan pipeline:
//   open ZIP → select parts → scan XML → extract relationships → summarize
// ---------------------------------------------------------------------------

import { openDocx } from './open-docx.js';
import { selectParts } from './part-selection.js';
import { scanXmlPart } from './xml-event-scan.js';
import { extractRelationships } from './relationship-extractor.js';
import { summarizeDocument } from './summarize-doc.js';
import { computeFingerprint } from './fingerprint.js';
import type {
  RawSurfaceFact,
  PackageIndex,
  RelationshipRecord,
  ScanDiagnostic,
  RawSurfaceDocumentResult,
  DocMetadata,
} from './types.js';

export type ScanDocumentOptions = {
  /** Original file path relative to the corpus root, when available. */
  sourceRelativePath?: string;
};

/**
 * Scan a single .docx file from raw bytes.
 *
 * Returns the complete document result: package index, all raw facts,
 * and a per-document summary. This is the primary programmatic entry point
 * for single-document analysis.
 */
export async function scanDocument(
  input: Uint8Array,
  docId: string,
  options?: ScanDocumentOptions,
): Promise<RawSurfaceDocumentResult> {
  const docFingerprint = await computeFingerprint(input);
  const zipEntries = openDocx(input);
  const { xmlParts, allEntries, diagnostics } = selectParts(zipEntries);

  const allFacts: RawSurfaceFact[] = [];
  const allRelationships: RelationshipRecord[] = [];
  const allDiagnostics: ScanDiagnostic[] = [...diagnostics];

  for (const { entry, packageEntry } of xmlParts) {
    // Extract relationships from .rels parts (in addition to normal scanning)
    if (entry.path.endsWith('.rels')) {
      const relResult = extractRelationships(entry.bytes, entry.path);
      allRelationships.push(...relResult.relationships);
      allDiagnostics.push(...relResult.diagnostics);
    }

    // Scan the XML part for raw facts
    const scanResult = scanXmlPart(entry.bytes, entry.path, packageEntry.partKind, docId, docFingerprint);

    allFacts.push(...scanResult.facts);

    if (scanResult.diagnostics.length > 0) {
      allDiagnostics.push(...scanResult.diagnostics);
      // Mark parse status based on whether we got any facts before the error
      packageEntry.parseStatus = scanResult.facts.length > 0 ? 'partial' : 'failed';
    }
  }

  const packageIndex: PackageIndex = {
    docId,
    docFingerprint,
    entries: allEntries,
    relationships: allRelationships,
    scanDiagnostics: allDiagnostics,
  };

  const metadata: DocMetadata = {
    docId,
    docFingerprint,
    ...(options?.sourceRelativePath && { sourceRelativePath: options.sourceRelativePath }),
  };
  const summary = summarizeDocument(docId, docFingerprint, allFacts, allRelationships, allDiagnostics);

  return { metadata, packageIndex, facts: allFacts, summary };
}
