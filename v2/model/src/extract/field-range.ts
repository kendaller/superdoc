// ---------------------------------------------------------------------------
// Field range property extractor
//
// Reads reconstructed field range data and extracts the instruction text
// and parsed field type. Field ranges are built during tier-1 graph
// construction by pairing fldChar begin/separate/end segments across runs.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { FieldRangeRawProperties } from "../entities/types.js";

/**
 * Extract field range properties from a synthetic "field container" element.
 * In practice, field ranges are constructed from segment data during
 * graph construction, not from a single XML element. This extractor
 * handles the begin-marker element for thin Phase 2 extraction.
 */
export function extractFieldRangeProperties(element: XmlElementNode): FieldRangeRawProperties {
  // For Phase 4A thin extraction: the element is the fldChar begin marker.
  // The instruction text and pairing are stored externally by the graph constructor.
  return {
    instructionText: "",
    fieldType: undefined,
    beginNodeId: element.id,
    separateNodeId: undefined,
    endNodeId: undefined,
  };
}

/** Parse a field instruction string to determine its type. */
export function parseFieldType(instruction: string): string | undefined {
  const trimmed = instruction.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase();
  switch (firstWord) {
    case "PAGE": return "page";
    case "NUMPAGES": return "numPages";
    case "DATE": return "date";
    case "TIME": return "time";
    case "TOC": return "toc";
    case "PAGEREF": return "pageRef";
    case "REF": return "ref";
    case "HYPERLINK": return "hyperlink";
    case "SEQ": return "seq";
    case "IF": return "if";
    case "MERGEFIELD": return "mergeField";
    case "DOCPROPERTY": return "docProperty";
    case "FILENAME": return "fileName";
    case "AUTHOR": return "author";
    case "TITLE": return "title";
    case "SUBJECT": return "subject";
    case "STYLEREF": return "styleRef";
    case "SYMBOL": return "symbol";
    default: return firstWord ? firstWord.toLowerCase() : undefined;
  }
}
