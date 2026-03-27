// ---------------------------------------------------------------------------
// CommentRange property extractor (thin — start-marker only in Phase 2)
//
// Reads a `w:commentRangeStart` element and extracts its comment ID.
// endNodeId stays undefined until tier-2 pairing in Phase 4A.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { CommentRangeRawProperties } from "../entities/types.js";
import { getAttr } from "../word/tree-helpers.js";

export function extractCommentRangeProperties(element: XmlElementNode): CommentRangeRawProperties {
  return {
    commentId: getAttr(element, "id", "w") ?? "",
    startNodeId: element.id,
    endNodeId: undefined, // Paired in Phase 4A tier-2 construction
  };
}
