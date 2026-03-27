// ---------------------------------------------------------------------------
// Hyperlink property extractor
//
// Reads a `w:hyperlink` element and extracts its attributes:
// relationship ID, anchor, tooltip, and history flag.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { HyperlinkRawProperties } from "../entities/types.js";
import { getAttr } from "../word/tree-helpers.js";

export function extractHyperlinkProperties(element: XmlElementNode): HyperlinkRawProperties {
  return {
    rId: getAttr(element, "id", "r"),
    anchor: getAttr(element, "anchor", "w"),
    tooltip: getAttr(element, "tooltip", "w"),
    history: getAttr(element, "history", "w") === "1",
  };
}
