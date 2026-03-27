// ---------------------------------------------------------------------------
// Core entity type system
//
// Every semantic entity converges on a consistent shape with:
//   - Stable identity (EntityRef)
//   - Canonical kind
//   - Source references back to the raw XML
//   - Lazily extracted raw properties
//   - Story and parent/child graph relationships
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef } from "../identity/types.js";
import type { InlineSegment } from "./inline-segments.js";

// ---- Entity kinds -----------------------------------------------------------

/** All recognized entity kinds in the semantic model. */
export type EntityKind =
  // Story entities
  | "mainStory"
  | "headerStory"
  | "footerStory"
  | "footnoteStory"
  | "endnoteStory"
  | "commentStory"
  | "textboxStory"
  // Structural content entities
  | "paragraph"
  | "run"
  | "table"
  | "tableRow"
  | "tableCell"
  | "drawing"
  | "contentControl"
  | "mathObject"
  // Hyperlink span entity
  | "hyperlink"
  // Resource / package entities
  | "style"
  | "numberingDefinition"
  | "abstractNum"
  | "theme"
  | "mediaResource"
  | "headerFooterDefinition"
  | "commentThread"
  | "footnoteBody"
  | "endnoteBody"
  // Range / anchor entities
  | "bookmark"
  | "commentRange"
  | "permissionRange"
  | "revisionRange"
  | "fieldRange"
  // Derived entities (Tier 2/3)
  | "section"
  // Preservation fallbacks
  | "preservedBlock"
  | "preservedRange";

export type StoryEntityKind =
  | "mainStory"
  | "headerStory"
  | "footerStory"
  | "footnoteStory"
  | "endnoteStory"
  | "commentStory"
  | "textboxStory";

export type StructuralEntityKind =
  | "paragraph"
  | "run"
  | "table"
  | "tableRow"
  | "tableCell"
  | "drawing"
  | "contentControl"
  | "mathObject"
  | "preservedBlock";

export type ResourceEntityKind =
  | "style"
  | "numberingDefinition"
  | "abstractNum"
  | "theme"
  | "mediaResource"
  | "headerFooterDefinition"
  | "commentThread"
  | "footnoteBody"
  | "endnoteBody";

export type RangeEntityKind =
  | "bookmark"
  | "commentRange"
  | "permissionRange"
  | "preservedRange";

// ---- Helpers ----------------------------------------------------------------

const STORY_KINDS = new Set<EntityKind>([
  "mainStory", "headerStory", "footerStory",
  "footnoteStory", "endnoteStory", "commentStory", "textboxStory",
]);

const STRUCTURAL_KINDS = new Set<EntityKind>([
  "paragraph", "run", "table", "tableRow", "tableCell",
  "drawing", "contentControl", "mathObject", "preservedBlock",
]);

const RESOURCE_KINDS = new Set<EntityKind>([
  "style", "numberingDefinition", "abstractNum", "theme",
  "mediaResource", "headerFooterDefinition",
  "commentThread", "footnoteBody", "endnoteBody",
]);

export function isStoryKind(kind: EntityKind): kind is StoryEntityKind {
  return STORY_KINDS.has(kind);
}

export function isStructuralKind(kind: EntityKind): kind is StructuralEntityKind {
  return STRUCTURAL_KINDS.has(kind);
}

export function isResourceKind(kind: EntityKind): kind is ResourceEntityKind {
  return RESOURCE_KINDS.has(kind);
}

// ---- Entity base shape ------------------------------------------------------

/** The minimum shape every semantic entity carries. */
export type EntityBase = {
  readonly ref: EntityRef;
  readonly kind: EntityKind;
  readonly sourceRefs: readonly SourceRef[];
  readonly storyId: string | undefined;
  readonly parentRef: EntityRef | undefined;
};

// ---- Raw property types per entity kind -------------------------------------

// -- Structural raw properties --

export type ParagraphRawProperties = {
  readonly paraId: string | undefined;
  readonly styleId: string | undefined;
  readonly spacing: ParagraphSpacing | undefined;
  readonly alignment: string | undefined;
  readonly numPr: NumberingProperties | undefined;
  readonly indentation: ParagraphIndentation | undefined;
  readonly keepNext: boolean;
  readonly keepLines: boolean;
  readonly pageBreakBefore: boolean;
  readonly outlineLevel: number | undefined;
  readonly borders: ParagraphBorders | undefined;
  readonly tabs: TabStop[] | undefined;
  readonly bidi: boolean;
  readonly hasSectPr: boolean;
  readonly suppressAutoHyphens: boolean;
  readonly contextualSpacing: boolean;
  readonly markRunProperties: RunFormatting | undefined;
};

export type ParagraphSpacing = {
  readonly before?: number;
  readonly after?: number;
  readonly line?: number;
  readonly lineRule?: string;
  readonly beforeAutospacing?: boolean;
  readonly afterAutospacing?: boolean;
};

export type ParagraphIndentation = {
  readonly left?: number;
  readonly right?: number;
  readonly firstLine?: number;
  readonly hanging?: number;
};

export type NumberingProperties = {
  readonly numId: string;
  readonly ilvl: string;
};

export type ParagraphBorders = {
  readonly top?: BorderProperties;
  readonly bottom?: BorderProperties;
  readonly left?: BorderProperties;
  readonly right?: BorderProperties;
  readonly between?: BorderProperties;
};

export type BorderProperties = {
  readonly val: string;
  readonly sz?: number;
  readonly space?: number;
  readonly color?: string;
};

export type TabStop = {
  readonly val: string;
  readonly pos: number;
  readonly leader?: string;
};

export type RunFormatting = {
  readonly rStyle?: string;
  readonly bold?: boolean;
  readonly boldCs?: boolean;
  readonly italic?: boolean;
  readonly italicCs?: boolean;
  readonly underline?: string;
  readonly strike?: boolean;
  readonly dstrike?: boolean;
  readonly fontSize?: number;
  readonly fontSizeCs?: number;
  readonly fontFamily?: string;
  readonly fontFamilyCs?: string;
  readonly color?: string;
  readonly highlight?: string;
  readonly vertAlign?: string;
  readonly caps?: boolean;
  readonly smallCaps?: boolean;
  readonly vanish?: boolean;
  readonly lang?: string;
  readonly spacing?: number;
  readonly kern?: number;
  readonly position?: number;
  readonly shading?: ShadingProperties;
};

export type ShadingProperties = {
  readonly val?: string;
  readonly fill?: string;
  readonly color?: string;
};

export type RunRawProperties = {
  readonly formatting: RunFormatting;
  readonly segments: readonly InlineSegment[];
};

export type HyperlinkRawProperties = {
  readonly rId: string | undefined;
  readonly anchor: string | undefined;
  readonly tooltip: string | undefined;
  readonly history: boolean;
};

export type ContentControlRawProperties = {
  readonly sdtId: string | undefined;
  readonly tag: string | undefined;
  readonly alias: string | undefined;
  readonly lock: string | undefined;
  readonly controlType: string | undefined;
  readonly scope: "block" | "inline";
};

export type TableRawProperties = {
  readonly styleId: string | undefined;
  readonly width: TableMeasurement | undefined;
  readonly alignment: string | undefined;
  readonly borders: TableBorders | undefined;
  readonly cellMargins: TableCellMargins | undefined;
  readonly look: string | undefined;
  readonly layout: string | undefined;
  readonly gridCols: number[];
  readonly bidi: boolean;
};

export type TableMeasurement = {
  readonly w: number;
  readonly type: string;
};

export type TableBorders = {
  readonly top?: BorderProperties;
  readonly bottom?: BorderProperties;
  readonly left?: BorderProperties;
  readonly right?: BorderProperties;
  readonly insideH?: BorderProperties;
  readonly insideV?: BorderProperties;
};

export type TableCellMargins = {
  readonly top?: TableMeasurement;
  readonly bottom?: TableMeasurement;
  readonly left?: TableMeasurement;
  readonly right?: TableMeasurement;
};

export type TableRowRawProperties = {
  readonly height: TableMeasurement | undefined;
  readonly heightRule: string | undefined;
  readonly isHeader: boolean;
  readonly cantSplit: boolean;
};

export type TableCellRawProperties = {
  readonly width: TableMeasurement | undefined;
  readonly gridSpan: number | undefined;
  readonly vMerge: string | undefined;
  readonly borders: TableBorders | undefined;
  readonly shading: ShadingProperties | undefined;
  readonly verticalAlignment: string | undefined;
  readonly noWrap: boolean;
  readonly textDirection: string | undefined;
};

export type DrawingRawProperties = {
  readonly isInline: boolean;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly description: string | undefined;
  readonly blipRelId: string | undefined;
  readonly drawingType: "image" | "shape" | "chart" | "group" | "unknown";
};

// -- Story raw properties --

export type StoryRawProperties = {
  readonly partUri: string;
  readonly storyType: StoryEntityKind;
};

// -- Resource raw properties (thin for Phase 2) --

export type StyleRawProperties = {
  readonly styleId: string;
  readonly type: string | undefined;
  readonly name: string | undefined;
  readonly basedOn: string | undefined;
  readonly linkedStyleId: string | undefined;
  readonly isDefault: boolean;
};

export type NumberingDefinitionRawProperties = {
  readonly numId: string;
  readonly abstractNumId: string | undefined;
};

export type AbstractNumRawProperties = {
  readonly abstractNumId: string;
  readonly levels: NumberingLevelInfo[];
};

export type NumberingLevelInfo = {
  readonly ilvl: string;
  readonly numFmt: string | undefined;
  readonly lvlText: string | undefined;
  readonly start: number | undefined;
};

// -- Range raw properties (thin for Phase 2) --

export type BookmarkRawProperties = {
  readonly bookmarkId: string;
  readonly name: string;
  readonly startNodeId: string | undefined;
  readonly endNodeId: string | undefined;
};

export type CommentRangeRawProperties = {
  readonly commentId: string;
  readonly startNodeId: string | undefined;
  readonly endNodeId: string | undefined;
};

export type RevisionRangeRawProperties = {
  readonly revisionId: string;
  readonly author: string | undefined;
  readonly date: string | undefined;
  readonly revisionType: "insert" | "delete" | "moveFrom" | "moveTo" | "format";
};

export type FieldRangeRawProperties = {
  readonly instructionText: string;
  readonly fieldType: string | undefined;
  readonly beginNodeId: string | undefined;
  readonly separateNodeId: string | undefined;
  readonly endNodeId: string | undefined;
};

// -- Preserved raw properties --

export type PreservedBlockRawProperties = {
  readonly qualifiedName: string;
};

export type PreservedRangeRawProperties = {
  readonly qualifiedName: string;
  readonly markerId: string | undefined;
};

// -- Section raw properties (thin/derived) --

export type SectionRawProperties = {
  readonly pageWidth: number | undefined;
  readonly pageHeight: number | undefined;
  readonly marginTop: number | undefined;
  readonly marginBottom: number | undefined;
  readonly marginLeft: number | undefined;
  readonly marginRight: number | undefined;
  readonly headerRefs: string[];
  readonly footerRefs: string[];
  readonly orientation: string | undefined;
  readonly cols: number | undefined;
};

// ---- Mapped type: EntityKind → raw properties -------------------------------

export type RawPropertiesForKind = {
  mainStory: StoryRawProperties;
  headerStory: StoryRawProperties;
  footerStory: StoryRawProperties;
  footnoteStory: StoryRawProperties;
  endnoteStory: StoryRawProperties;
  commentStory: StoryRawProperties;
  textboxStory: StoryRawProperties;
  paragraph: ParagraphRawProperties;
  run: RunRawProperties;
  table: TableRawProperties;
  tableRow: TableRowRawProperties;
  tableCell: TableCellRawProperties;
  drawing: DrawingRawProperties;
  contentControl: ContentControlRawProperties;
  mathObject: Record<string, never>;
  hyperlink: HyperlinkRawProperties;
  style: StyleRawProperties;
  numberingDefinition: NumberingDefinitionRawProperties;
  abstractNum: AbstractNumRawProperties;
  theme: Record<string, never>;
  mediaResource: Record<string, never>;
  headerFooterDefinition: Record<string, never>;
  commentThread: Record<string, never>;
  footnoteBody: Record<string, never>;
  endnoteBody: Record<string, never>;
  bookmark: BookmarkRawProperties;
  commentRange: CommentRangeRawProperties;
  permissionRange: Record<string, never>;
  revisionRange: RevisionRangeRawProperties;
  fieldRange: FieldRangeRawProperties;
  section: SectionRawProperties;
  preservedBlock: PreservedBlockRawProperties;
  preservedRange: PreservedRangeRawProperties;
};

// ---- Typed entity interface -------------------------------------------------

/**
 * A semantic entity — a lazy live view over the source kernel.
 *
 * **Phase 2 lifetime contract:**
 * Entity handles are valid within a single graph generation. After
 * `model.rebuild()`, all previously returned handles are stale.
 * Cache `EntityRef` values (by `.ref.id`), not entity objects, if you
 * need references that survive mutation + rebuild. Re-query from the
 * model after rebuild to get fresh handles.
 *
 * Stable live handles across mutations are a Phase 5+ concern.
 */
export type Entity<K extends EntityKind = EntityKind> = EntityBase & {
  readonly kind: K;
  /** Lazily extracted raw properties from source XML. */
  raw(): RawPropertiesForKind[K];
  /** Ordered child entity refs. */
  childRefs(): readonly EntityRef[];
  /** Whether the backing source XML has been deleted. */
  isDeleted(): boolean;
};

// ---- Convenience type aliases -----------------------------------------------

export type ParagraphEntity = Entity<"paragraph">;
export type RunEntity = Entity<"run">;
export type TableEntity = Entity<"table">;
export type TableRowEntity = Entity<"tableRow">;
export type TableCellEntity = Entity<"tableCell">;
export type DrawingEntity = Entity<"drawing">;
export type StoryEntity = Entity<StoryEntityKind>;
export type StyleEntity = Entity<"style">;
export type NumberingDefinitionEntity = Entity<"numberingDefinition">;
export type BookmarkEntity = Entity<"bookmark">;
export type SectionEntity = Entity<"section">;
export type PreservedBlockEntity = Entity<"preservedBlock">;
