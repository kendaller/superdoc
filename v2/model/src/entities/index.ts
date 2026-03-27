// Entity type system
export type {
  EntityKind,
  StoryEntityKind,
  StructuralEntityKind,
  ResourceEntityKind,
  RangeEntityKind,
  EntityBase,
  Entity,
  ParagraphEntity,
  RunEntity,
  TableEntity,
  TableRowEntity,
  TableCellEntity,
  DrawingEntity,
  StoryEntity,
  StyleEntity,
  NumberingDefinitionEntity,
  BookmarkEntity,
  SectionEntity,
  PreservedBlockEntity,
  RawPropertiesForKind,
} from "./types.js";

// Raw property types
export type {
  ParagraphRawProperties,
  ParagraphSpacing,
  ParagraphIndentation,
  NumberingProperties,
  ParagraphBorders,
  BorderProperties,
  TabStop,
  RunFormatting,
  ShadingProperties,
  RunRawProperties,
  TableRawProperties,
  TableMeasurement,
  TableBorders,
  TableCellMargins,
  TableRowRawProperties,
  TableCellRawProperties,
  DrawingRawProperties,
  HyperlinkRawProperties,
  ContentControlRawProperties,
  StoryRawProperties,
  StyleRawProperties,
  NumberingDefinitionRawProperties,
  AbstractNumRawProperties,
  NumberingLevelInfo,
  BookmarkRawProperties,
  CommentRangeRawProperties,
  PreservedBlockRawProperties,
  PreservedRangeRawProperties,
  SectionRawProperties,
} from "./types.js";

export {
  isStoryKind,
  isStructuralKind,
  isResourceKind,
} from "./types.js";

// Inline segments
export type {
  InlineSegment,
  TextSegment,
  DeletedTextSegment,
  InstrTextSegment,
  TabSegment,
  BreakSegment,
  SymbolSegment,
  FootnoteRefSegment,
  EndnoteRefSegment,
  DrawingSegment,
  FieldCharSegment,
  SoftHyphenSegment,
  NoBreakHyphenSegment,
  PreservedInlineSegment,
} from "./inline-segments.js";

export { segmentsToText } from "./inline-segments.js";
