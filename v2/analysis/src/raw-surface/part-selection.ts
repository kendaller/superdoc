// ---------------------------------------------------------------------------
// Part Selection
// ---------------------------------------------------------------------------
// Enumerate and classify ZIP entries into XML-bearing (scannable) and binary
// parts. Uses simple heuristics — extension and content sniffing — to decide
// what goes through the SAX parser.
// ---------------------------------------------------------------------------

import type { ZipEntry } from './open-docx.js';
import type { PackageEntry, PackageEntryKind, ScanDiagnostic } from './types.js';
import { classifyPart } from './part-classification.js';
import { looksLikeXml } from './xml-bytes.js';

const XML_EXTENSIONS = new Set(['.xml', '.rels']);

/** Determine if a ZIP entry path has an XML extension. */
function hasXmlExtension(path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return false;
  return XML_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

export type SelectedParts = {
  xmlParts: Array<{ entry: ZipEntry; packageEntry: PackageEntry }>;
  allEntries: PackageEntry[];
  diagnostics: ScanDiagnostic[];
};

/** Classify all ZIP entries and select which ones to SAX-parse. */
export function selectParts(entries: ZipEntry[]): SelectedParts {
  const xmlParts: SelectedParts['xmlParts'] = [];
  const allEntries: PackageEntry[] = [];
  const diagnostics: ScanDiagnostic[] = [];

  for (const entry of entries) {
    const isXmlByExtension = hasXmlExtension(entry.path);
    const isXmlByContent = looksLikeXml(entry.bytes);
    const entryKind: PackageEntryKind = isXmlByExtension || isXmlByContent ? 'xml' : 'binary';
    const partKind = classifyPart(entry.path);

    const packageEntry: PackageEntry = {
      path: entry.path,
      entryKind,
      partKind,
      sizeBytes: entry.bytes.length,
      parseStatus: entryKind === 'xml' ? 'success' : 'skipped',
    };

    allEntries.push(packageEntry);

    if (isXmlByExtension && !isXmlByContent && entry.bytes.length > 0) {
      diagnostics.push({
        partUri: entry.path,
        severity: 'warning',
        code: 'not-xml',
        message: `Entry has XML extension but content does not appear to be XML`,
      });
      packageEntry.parseStatus = 'failed';
      continue;
    }

    if (entryKind === 'xml') {
      xmlParts.push({ entry, packageEntry });
    }
  }

  return { xmlParts, allEntries, diagnostics };
}
