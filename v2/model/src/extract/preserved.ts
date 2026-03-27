// ---------------------------------------------------------------------------
// Preserved element extractor
//
// Fallback extractor for unknown elements. Wraps the raw XML node reference
// without property extraction, ensuring 100% preservation support.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { PreservedBlockRawProperties } from "../entities/types.js";

export function extractPreservedBlockProperties(element: XmlElementNode): PreservedBlockRawProperties {
  return {
    qualifiedName: element.prefix
      ? `${element.prefix}:${element.localName}`
      : element.localName,
  };
}
