// ---------------------------------------------------------------------------
// XML Event Scanner
// ---------------------------------------------------------------------------
// Namespace-aware SAX traversal of a single XML part. Emits raw facts for
// every element, attribute, processing instruction, and XML comment
// encountered — no semantic interpretation, just mechanical parsing.
// ---------------------------------------------------------------------------

import { SaxesParser, type SaxesAttributeNS } from 'saxes';
import type { RawSurfaceFact, PartKind, ScanDiagnostic } from './types.js';
import { PathState } from './path-state.js';
import {
  emitElementFact,
  emitAttributeFacts,
  emitProcessingInstructionFact,
  emitCommentFact,
  type FactEmitterContext,
} from './fact-emitter.js';
import { decodeXmlBytes } from './xml-bytes.js';

export type ScanPartResult = {
  facts: RawSurfaceFact[];
  diagnostics: ScanDiagnostic[];
};

/**
 * Scan a single XML part and emit all raw syntax facts.
 *
 * The scanner uses SAX event parsing to stay low-memory and avoid
 * materializing a full XML tree. Facts are emitted in parser encounter order.
 */
export function scanXmlPart(
  xmlBytes: Uint8Array,
  partUri: string,
  partKind: PartKind,
  docId: string,
  docFingerprint: string,
): ScanPartResult {
  const facts: RawSurfaceFact[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  const pathState = new PathState(partUri);

  const ctx: FactEmitterContext = {
    docId,
    docFingerprint,
    partUri,
    partKind,
    pathState,
  };

  const parser = new SaxesParser({ xmlns: true, position: true });

  parser.on('opentag', (node) => {
    pathState.pushElement({
      prefix: node.prefix || undefined,
      localName: node.local,
      namespaceUri: node.uri || undefined,
    });

    facts.push(
      emitElementFact(
        ctx,
        { prefix: node.prefix || undefined, localName: node.local, namespaceUri: node.uri || undefined },
        parser.line,
        parser.column,
      ),
    );

    const attrs = node.attributes as Record<string, SaxesAttributeNS>;
    if (Object.keys(attrs).length > 0) {
      facts.push(...emitAttributeFacts(ctx, attrs, parser.line, parser.column));
    }
  });

  parser.on('closetag', () => {
    pathState.popElement();
  });

  parser.on('processinginstruction', (pi) => {
    const index = pathState.nextProcessingInstructionIndex(pi.target);

    facts.push(emitProcessingInstructionFact(ctx, pi.target, index, parser.line, parser.column));
  });

  parser.on('comment', () => {
    const index = pathState.nextCommentIndex();

    facts.push(emitCommentFact(ctx, index, parser.line, parser.column));
  });

  parser.on('error', (err) => {
    diagnostics.push({
      partUri,
      severity: 'error',
      code: 'xml-parse-error',
      message: err.message,
      line: parser.line,
      column: parser.column,
    });
  });

  // Decode bytes to string and feed to parser
  try {
    const xmlString = decodeXmlBytes(xmlBytes);
    parser.write(xmlString);
    parser.close();
  } catch (err) {
    diagnostics.push({
      partUri,
      severity: 'error',
      code: 'xml-parse-error',
      message: err instanceof Error ? err.message : String(err),
      line: parser.line,
      column: parser.column,
    });
  }

  return { facts, diagnostics };
}
