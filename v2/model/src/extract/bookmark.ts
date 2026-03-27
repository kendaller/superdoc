// ---------------------------------------------------------------------------
// Bookmark property extractor (thin — start-marker only in Phase 2)
//
// Reads a `w:bookmarkStart` element and extracts its ID and name.
// endNodeId stays undefined until tier-2 pairing in Phase 4A.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { BookmarkRawProperties } from "../entities/types.js";
import { getAttr } from "../word/tree-helpers.js";

export function extractBookmarkProperties(element: XmlElementNode): BookmarkRawProperties {
  return {
    bookmarkId: getAttr(element, "id", "w") ?? "",
    name: getAttr(element, "name", "w") ?? "",
    startNodeId: element.id,
    endNodeId: undefined, // Paired in Phase 4A tier-2 construction
  };
}
