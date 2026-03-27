// ---------------------------------------------------------------------------
// Shared XML declaration parser
//
// Used by both the indexer and hydrator to capture the XML declaration
// from the raw text of an XML part.
// ---------------------------------------------------------------------------

import type { XmlDeclarationNode, SourceSpan } from "../types/xml.js";
import { makeNodeId } from "./node-id.js";

/** Parse the XML declaration from the beginning of an XML string. */
export function parseXmlDeclaration(
  text: string,
  partUri: string,
): XmlDeclarationNode | undefined {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("<?xml")) return undefined;

  const offset = text.length - trimmed.length;
  const end = text.indexOf("?>", offset);
  if (end === -1) return undefined;

  const declEnd = end + 2;
  const raw = text.slice(offset, declEnd);
  const span: SourceSpan = { startByte: 0, endByte: declEnd };
  const id = makeNodeId(partUri, "declaration", span);

  return {
    id,
    kind: "declaration",
    version: extractAttr(raw, "version") ?? "1.0",
    encoding: extractAttr(raw, "encoding") || undefined,
    standalone: extractAttr(raw, "standalone") as "yes" | "no" | undefined,
    raw,
    sourceSpan: span,
  };
}

function extractAttr(raw: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`);
  const m = raw.match(re);
  return m ? m[1] : undefined;
}
