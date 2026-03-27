// ---------------------------------------------------------------------------
// Revision range property extractor
//
// Reads tracked-change wrapper elements (w:ins, w:del, w:moveFrom, w:moveTo)
// and extracts revision metadata: ID, author, date, and revision type.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { RevisionRangeRawProperties } from "../entities/types.js";
import { getAttr } from "../word/tree-helpers.js";

export function extractRevisionRangeProperties(element: XmlElementNode): RevisionRangeRawProperties {
  return {
    revisionId: getAttr(element, "id", "w") ?? "",
    author: getAttr(element, "author", "w"),
    date: getAttr(element, "date", "w"),
    revisionType: mapRevisionType(element.localName),
  };
}

function mapRevisionType(localName: string): RevisionRangeRawProperties["revisionType"] {
  switch (localName) {
    case "ins": return "insert";
    case "del": return "delete";
    case "moveFrom": return "moveFrom";
    case "moveTo": return "moveTo";
    default: return "format";
  }
}
