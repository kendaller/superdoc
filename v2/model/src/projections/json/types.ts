// ---------------------------------------------------------------------------
// Semantic JSON types — a clean, lossy, consumer-friendly JSON view
//
// This is a READ-ONLY, LOSSY projection of the semantic model.
// It is NOT the raw XML, NOT the internal entity graph, and MUST NEVER
// be used as a persistence or round-trip format. It exists solely to give
// API consumers a convenient, self-describing JSON tree of document content.
//
// Properties are projected from raw entity properties with intentional
// simplification: string IDs instead of EntityRefs, optional booleans
// instead of nullable formatting structs, flat run properties instead of
// nested formatting objects. Fields that are undefined in the source are
// omitted entirely — no null values.
// ---------------------------------------------------------------------------

// ---- Top-level document -----------------------------------------------------

/** Top-level semantic JSON document. */
export type SemanticDocument = {
  readonly kind: "document";
  readonly stories: SemanticStory[];
  readonly styles: SemanticStyleSummary[];
  readonly metadata: DocumentMetadata;
};

/** A story (main, header, footer, footnote, etc.). */
export type SemanticStory = {
  readonly kind: "story";
  readonly storyType: string;
  readonly blocks: SemanticBlock[];
};

// ---- Block types (discriminated union) --------------------------------------

/** Discriminated union of block types. */
export type SemanticBlock =
  | SemanticParagraph
  | SemanticTable
  | SemanticSection
  | SemanticDrawingBlock
  | SemanticUnsupportedBlock;

export type SemanticParagraph = {
  readonly kind: "paragraph";
  readonly entityRef: string;
  readonly styleId?: string;
  readonly alignment?: string;
  readonly runs: SemanticRun[];
  readonly numbering?: { numId: number; ilvl: number };
};

export type SemanticRun = {
  readonly kind: "run";
  readonly entityRef: string;
  readonly text: string;
  readonly segments?: SemanticInlineSegment[];
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly color?: string;
};

export type SemanticInlineSegment =
  | SemanticTextSegment
  | SemanticDeletedTextSegment
  | SemanticInstrTextSegment
  | SemanticTabSegment
  | SemanticBreakSegment
  | SemanticSymbolSegment
  | SemanticFootnoteRefSegment
  | SemanticEndnoteRefSegment
  | SemanticDrawingSegment
  | SemanticFieldCharSegment
  | SemanticSoftHyphenSegment
  | SemanticNoBreakHyphenSegment
  | SemanticPreservedInlineSegment;

export type SemanticTextSegment = {
  readonly kind: "text";
  readonly text: string;
};

export type SemanticDeletedTextSegment = {
  readonly kind: "deletedText";
  readonly text: string;
};

export type SemanticInstrTextSegment = {
  readonly kind: "instrText";
  readonly text: string;
};

export type SemanticTabSegment = {
  readonly kind: "tab";
};

export type SemanticBreakSegment = {
  readonly kind: "break";
  readonly breakType: string;
};

export type SemanticSymbolSegment = {
  readonly kind: "symbol";
  readonly char: string;
  readonly font?: string;
};

export type SemanticFootnoteRefSegment = {
  readonly kind: "footnoteRef";
  readonly footnoteId: string;
};

export type SemanticEndnoteRefSegment = {
  readonly kind: "endnoteRef";
  readonly endnoteId: string;
};

export type SemanticDrawingSegment = {
  readonly kind: "drawing";
  readonly isInline: boolean;
};

export type SemanticFieldCharSegment = {
  readonly kind: "fieldChar";
  readonly fieldCharType: string;
};

export type SemanticSoftHyphenSegment = {
  readonly kind: "softHyphen";
};

export type SemanticNoBreakHyphenSegment = {
  readonly kind: "noBreakHyphen";
};

export type SemanticPreservedInlineSegment = {
  readonly kind: "preserved";
  readonly qualifiedName: string;
};

// ---- Table types ------------------------------------------------------------

export type SemanticTable = {
  readonly kind: "table";
  readonly entityRef: string;
  readonly styleId?: string;
  readonly rows: SemanticTableRow[];
};

export type SemanticTableRow = {
  readonly kind: "tableRow";
  readonly cells: SemanticTableCell[];
};

export type SemanticTableCell = {
  readonly kind: "tableCell";
  readonly blocks: SemanticBlock[];
  readonly colSpan?: number;
  readonly rowSpan?: number;
};

// ---- Section type -----------------------------------------------------------

export type SemanticSection = {
  readonly kind: "section";
  readonly pageWidth?: number;
  readonly pageHeight?: number;
  readonly orientation?: string;
};

export type SemanticDrawingBlock = {
  readonly kind: "drawing";
  readonly entityRef: string;
  readonly drawingType?: string;
  readonly width?: number;
  readonly height?: number;
  readonly description?: string;
};

export type SemanticUnsupportedBlock = {
  readonly kind: "unsupported";
  readonly entityRef: string;
  readonly sourceKind: string;
};

// ---- Style summary ----------------------------------------------------------

export type SemanticStyleSummary = {
  readonly styleId: string;
  readonly name?: string;
  readonly type?: string;
  readonly basedOn?: string;
};

// ---- Document metadata ------------------------------------------------------

export type DocumentMetadata = {
  readonly entityCount: number;
  readonly storyCount: number;
  readonly diagnosticCount: number;
};
