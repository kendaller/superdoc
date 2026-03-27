// ---------------------------------------------------------------------------
// Property extractor interface
//
// Each entity kind has a property extractor that reads an XmlElementNode
// and returns typed raw properties. Extractors produce raw properties only —
// style cascade, numbering inheritance, and field interpretation are
// Layer 2 resolver concerns.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { EntityKind, RawPropertiesForKind } from "../entities/types.js";

/**
 * A property extractor reads an XML element and produces typed raw properties
 * for a specific entity kind.
 */
export type PropertyExtractor<K extends EntityKind> = (
  element: XmlElementNode,
) => RawPropertiesForKind[K];

/**
 * Registry of extractors keyed by entity kind.
 * Not every kind has an extractor — thin entities skip extraction.
 */
export type ExtractorRegistry = {
  get<K extends EntityKind>(kind: K): PropertyExtractor<K> | undefined;
};
