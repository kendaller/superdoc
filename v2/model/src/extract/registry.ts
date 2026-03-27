// ---------------------------------------------------------------------------
// Extractor registry
//
// Maps entity kinds to their property extractors. Not every kind has an
// extractor — thin entities (Phase 2) skip extraction and return empty objects.
// ---------------------------------------------------------------------------

import type { EntityKind } from "../entities/types.js";
import type { XmlElementNode } from "../types/xml.js";
import type { ExtractorRegistry, PropertyExtractor } from "./types.js";
import { extractParagraphProperties } from "./paragraph.js";
import { extractRunProperties } from "./run.js";
import { extractTableProperties, extractTableRowProperties, extractTableCellProperties } from "./table.js";
import { extractDrawingProperties } from "./drawing.js";
import { extractPreservedBlockProperties } from "./preserved.js";
import { extractStyleProperties, extractNumberingDefinitionProperties, extractAbstractNumProperties } from "./resource.js";
import { extractHyperlinkProperties } from "./hyperlink.js";
import { extractSectionProperties } from "./section.js";
import { extractBookmarkProperties } from "./bookmark.js";
import { extractCommentRangeProperties } from "./comment-range.js";
import { extractContentControlProperties } from "./content-control.js";
import { extractRevisionRangeProperties } from "./revision-range.js";
import { extractFieldRangeProperties } from "./field-range.js";

/**
 * Create the default extractor registry with all Phase 2/3 extractors.
 * Thin entity kinds return undefined (no extractor registered).
 */
export function createExtractorRegistry(): ExtractorRegistry {
  const map = new Map<EntityKind, PropertyExtractor<EntityKind>>();

  // Structural entity extractors (Medium depth for Phase 3 vertical slice)
  map.set("paragraph", extractParagraphProperties as PropertyExtractor<EntityKind>);
  map.set("run", extractRunProperties as PropertyExtractor<EntityKind>);
  map.set("table", extractTableProperties as PropertyExtractor<EntityKind>);
  map.set("tableRow", extractTableRowProperties as PropertyExtractor<EntityKind>);
  map.set("tableCell", extractTableCellProperties as PropertyExtractor<EntityKind>);
  map.set("drawing", extractDrawingProperties as PropertyExtractor<EntityKind>);

  // Hyperlink extractor
  map.set("hyperlink", extractHyperlinkProperties as PropertyExtractor<EntityKind>);

  // Resource entity extractors
  map.set("style", extractStyleProperties as PropertyExtractor<EntityKind>);
  map.set("numberingDefinition", extractNumberingDefinitionProperties as PropertyExtractor<EntityKind>);
  map.set("abstractNum", extractAbstractNumProperties as PropertyExtractor<EntityKind>);

  // Content control extractor
  map.set("contentControl", extractContentControlProperties as PropertyExtractor<EntityKind>);

  // Section and range extractors (thin Phase 2 depth)
  map.set("section", extractSectionProperties as PropertyExtractor<EntityKind>);
  map.set("bookmark", extractBookmarkProperties as PropertyExtractor<EntityKind>);
  map.set("commentRange", extractCommentRangeProperties as PropertyExtractor<EntityKind>);
  map.set("revisionRange", extractRevisionRangeProperties as PropertyExtractor<EntityKind>);
  map.set("fieldRange", extractFieldRangeProperties as PropertyExtractor<EntityKind>);

  // Preservation fallback
  map.set("preservedBlock", extractPreservedBlockProperties as PropertyExtractor<EntityKind>);

  return {
    get<K extends EntityKind>(kind: K): PropertyExtractor<K> | undefined {
      return map.get(kind) as PropertyExtractor<K> | undefined;
    },
  };
}

/**
 * A no-op extractor that returns an empty object.
 * Used for thin entities that don't have typed property extraction yet.
 */
export function emptyExtractor(_element: XmlElementNode): Record<string, never> {
  return {};
}
