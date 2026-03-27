export type { PropertyExtractor, ExtractorRegistry } from "./types.js";

export { createExtractorRegistry, emptyExtractor } from "./registry.js";

// Individual extractors — exposed for direct use in tests
export { extractParagraphProperties } from "./paragraph.js";
export { extractRunProperties, extractRunFormatting } from "./run.js";
export { extractTableProperties, extractTableRowProperties, extractTableCellProperties } from "./table.js";
export { extractDrawingProperties } from "./drawing.js";
export { extractPreservedBlockProperties } from "./preserved.js";
export { extractStyleProperties, extractNumberingDefinitionProperties, extractAbstractNumProperties } from "./resource.js";
export { extractHyperlinkProperties } from "./hyperlink.js";
export { extractContentControlProperties } from "./content-control.js";
export { extractSectionProperties } from "./section.js";
export { extractBookmarkProperties } from "./bookmark.js";
export { extractCommentRangeProperties } from "./comment-range.js";
export { extractRevisionRangeProperties } from "./revision-range.js";
export { extractFieldRangeProperties, parseFieldType } from "./field-range.js";

// XML helpers — reusable across extractors
export {
  readToggle,
  readVal,
  readNumericVal,
  readBorder,
  readShading,
  readTableMeasurement,
  readCellMargins,
} from "./xml-helpers.js";
