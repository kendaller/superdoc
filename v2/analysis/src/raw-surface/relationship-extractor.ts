// ---------------------------------------------------------------------------
// Relationship Extractor
// ---------------------------------------------------------------------------
// Extracts OPC relationship triples from .rels parts. This is a mechanical
// extraction of fixed-schema package wiring, not semantic interpretation.
// ---------------------------------------------------------------------------

import { SaxesParser } from 'saxes';
import type { RelationshipRecord, ScanDiagnostic } from './types.js';
import { decodeXmlBytes } from './xml-bytes.js';

/**
 * Derive the source part URI from a .rels file path.
 *
 * OPC convention:
 *   `_rels/.rels`               → source is "/"  (package-level)
 *   `word/_rels/document.xml.rels` → source is "word/document.xml"
 */
function deriveSourcePartUri(relsPath: string): string {
  // Remove `_rels/` segment and `.rels` suffix
  const withoutRels = relsPath.replace(/_rels\//, '').replace(/\.rels$/, '');

  return withoutRels === '' ? '/' : withoutRels;
}

export type RelationshipExtractionResult = {
  relationships: RelationshipRecord[];
  diagnostics: ScanDiagnostic[];
};

/** Extract relationship records from a .rels XML part. */
export function extractRelationships(xmlBytes: Uint8Array, relsPartUri: string): RelationshipExtractionResult {
  const relationships: RelationshipRecord[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  const sourcePartUri = deriveSourcePartUri(relsPartUri);

  const parser = new SaxesParser({ xmlns: true, position: true });

  parser.on('opentag', (node) => {
    if (node.local !== 'Relationship') return;

    const attrs = node.attributes as Record<string, { value: string }>;
    const id =
      attrs['Id']?.value ?? attrs['{http://schemas.openxmlformats.org/package/2006/relationships}Id']?.value ?? '';
    const type =
      attrs['Type']?.value ?? attrs['{http://schemas.openxmlformats.org/package/2006/relationships}Type']?.value ?? '';
    const target =
      attrs['Target']?.value ??
      attrs['{http://schemas.openxmlformats.org/package/2006/relationships}Target']?.value ??
      '';
    const targetMode =
      attrs['TargetMode']?.value ??
      attrs['{http://schemas.openxmlformats.org/package/2006/relationships}TargetMode']?.value;

    const record: RelationshipRecord = {
      sourcePartUri,
      relationshipPartUri: relsPartUri,
      id,
      type,
      target,
    };
    if (targetMode) record.targetMode = targetMode;

    relationships.push(record);
  });

  parser.on('error', (err) => {
    diagnostics.push({
      partUri: relsPartUri,
      severity: 'error',
      code: 'xml-parse-error',
      message: err.message,
      line: parser.line,
      column: parser.column,
    });
  });

  try {
    parser.write(decodeXmlBytes(xmlBytes));
    parser.close();
  } catch (err) {
    diagnostics.push({
      partUri: relsPartUri,
      severity: 'error',
      code: 'xml-parse-error',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return { relationships, diagnostics };
}
