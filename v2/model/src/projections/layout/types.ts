// ---------------------------------------------------------------------------
// Layout-compatible types for the v2 projection layer
//
// These mirror the @superdoc/contracts FlowBlock type hierarchy without
// introducing a dependency on that package. The layout-engine consumes
// structurally-typed objects, so these are wire-compatible as long as the
// shapes match.
//
// Only the subset needed by the projection is defined here.
// ---------------------------------------------------------------------------

/** Unique block identifier. */
export type BlockId = string;

// ---- Run types --------------------------------------------------------------

/** Common formatting marks applied to any run. */
export type RunMarks = {
  bold?: boolean;
  italic?: boolean;
  letterSpacing?: number;
  color?: string;
  underline?: {
    style?: 'single' | 'double' | 'dotted' | 'dashed' | 'wavy';
    color?: string;
  } | null;
  strike?: boolean;
  highlight?: string;
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  vertAlign?: 'superscript' | 'subscript' | 'baseline';
  baselineShift?: number;
};

export type TextRun = RunMarks & {
  kind?: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
};

export type ImageRun = {
  kind: 'image';
  src: string;
  width: number;
  height: number;
  alt?: string;
  title?: string;
  clipPath?: string;
  distTop?: number;
  distBottom?: number;
  distLeft?: number;
  distRight?: number;
  verticalAlign?: 'bottom';
  pmStart?: number;
  pmEnd?: number;
};

export type TabRun = RunMarks & {
  kind: 'tab';
  text: '\t';
};

export type LineBreakRun = {
  kind: 'lineBreak';
  attrs?: {
    lineBreakType?: string;
    clear?: string;
  };
};

export type BreakRun = {
  kind: 'break';
  breakType?: 'line' | 'page' | 'column' | string;
};

export type Run = TextRun | ImageRun | TabRun | LineBreakRun | BreakRun;

// ---- Paragraph types --------------------------------------------------------

export type ParagraphSpacing = {
  before?: number;
  after?: number;
  line?: number;
  lineUnit?: 'px' | 'multiplier';
  lineRule?: 'auto' | 'exact' | 'atLeast';
  beforeAutospacing?: boolean;
  afterAutospacing?: boolean;
};

export type ParagraphIndent = {
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
};

export type ParagraphBorder = {
  style?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
  width?: number;
  color?: string;
  space?: number;
};

export type ParagraphBorders = {
  top?: ParagraphBorder;
  right?: ParagraphBorder;
  bottom?: ParagraphBorder;
  left?: ParagraphBorder;
  between?: ParagraphBorder;
};

export type ParagraphShading = {
  fill?: string;
  color?: string;
  val?: string;
};

export type TabStop = {
  val: 'start' | 'end' | 'center' | 'decimal' | 'bar' | 'clear';
  pos: number;
  leader?: 'none' | 'dot' | 'hyphen' | 'heavy' | 'underscore' | 'middleDot';
};

export type ParagraphAttrs = {
  styleId?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spacing?: ParagraphSpacing;
  contextualSpacing?: boolean;
  indent?: ParagraphIndent;
  numberingProperties?: { ilvl?: number; numId?: number } | null;
  borders?: ParagraphBorders;
  shading?: ParagraphShading;
  tabs?: TabStop[];
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  direction?: 'ltr' | 'rtl';
  rtl?: boolean;
};

export type ParagraphBlock = {
  kind: 'paragraph';
  id: BlockId;
  runs: Run[];
  attrs?: ParagraphAttrs;
};

// ---- Table types ------------------------------------------------------------

export type BorderSpec = {
  style?: string;
  width?: number;
  color?: string;
  space?: number;
};

export type TableBorderValue = null | { none: true } | BorderSpec;

export type TableBorders = {
  top?: TableBorderValue;
  right?: TableBorderValue;
  bottom?: TableBorderValue;
  left?: TableBorderValue;
  insideH?: TableBorderValue;
  insideV?: TableBorderValue;
};

export type CellBorders = {
  top?: BorderSpec;
  right?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
};

export type BoxSpacing = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type TableCellAttrs = {
  borders?: CellBorders;
  padding?: BoxSpacing;
  verticalAlign?: 'top' | 'middle' | 'center' | 'bottom';
  background?: string;
};

export type TableAttrs = {
  borders?: TableBorders;
  [key: string]: unknown;
};

export type TableCell = {
  id: BlockId;
  blocks?: (ParagraphBlock | TableBlock)[];
  paragraph?: ParagraphBlock;
  rowSpan?: number;
  colSpan?: number;
  attrs?: TableCellAttrs;
};

export type TableRowAttrs = {
  tableRowProperties?: {
    repeatHeader?: boolean;
    cantSplit?: boolean;
  };
  rowHeight?: {
    value: number;
    rule?: 'auto' | 'atLeast' | 'exact' | string;
  };
};

export type TableRow = {
  id: BlockId;
  cells: TableCell[];
  attrs?: TableRowAttrs;
};

export type TableBlock = {
  kind: 'table';
  id: BlockId;
  rows: TableRow[];
  attrs?: TableAttrs;
  columnWidths?: number[];
};

// ---- Section break types ----------------------------------------------------

export type SectionBreakBlock = {
  kind: 'sectionBreak';
  id: BlockId;
  type?: 'continuous' | 'nextPage' | 'evenPage' | 'oddPage';
  pageSize?: { w: number; h: number };
  orientation?: 'portrait' | 'landscape';
  margins: {
    header?: number;
    footer?: number;
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  headerRefs?: {
    default?: string;
    first?: string;
    even?: string;
    odd?: string;
  };
  footerRefs?: {
    default?: string;
    first?: string;
    even?: string;
    odd?: string;
  };
  columns?: {
    count: number;
    gap: number;
    widths?: number[];
    equalWidth?: boolean;
  };
  attrs?: {
    source?: string;
    [key: string]: unknown;
  };
};

// ---- FlowBlock union --------------------------------------------------------

export type FlowBlock = ParagraphBlock | TableBlock | SectionBreakBlock;

// ---- Windowed projection types ----------------------------------------------

import type { SourceAnchor } from './source-anchor.js';
import type { DependencyManifest } from './dependency-manifest.js';

/** Specification for what to project in a window. */
export type WindowSpec = {
  /** First body-child index to include. */
  startBodyChildIndex: number;
  /** Maximum number of body children to project. */
  maxBodyChildCount: number;
  /**
   * Stop after estimating this many pages of content.
   * Uses page height from primary section geometry for estimation.
   * Optional — if omitted, projects all children in the range.
   */
  stopAfterPageEstimate?: number;
  /** Whether to collect a dependency manifest for the window. */
  includeDependencyManifest?: boolean;
};

/** Continuation token for requesting the next window. */
export type WindowContinuation = {
  /** The next body-child index to start from. */
  nextBodyChildIndex: number;
  /** Whether there are more body children after this window. */
  hasMore: boolean;
  /** Total body child count (for progress estimation). */
  totalBodyChildCount: number;
};

/** Section metadata emitted when a section boundary is encountered. */
export type SectionMetadataDelta = {
  /** Section break blocks encountered in this window. */
  sectionBreaks: SectionBreakBlock[];
  /** Primary page geometry (from the document-level sectPr). */
  primaryPageGeometry?: {
    width: number;
    height: number;
    margins: { top: number; right: number; bottom: number; left: number };
  };
};

/** Result of a windowed projection. */
export type WindowedProjectionResult = {
  /** The projected FlowBlocks for this window. */
  readonly blocks: FlowBlock[];
  /** Window metadata for resumption. */
  readonly continuation: WindowContinuation;
  /**
   * Maps block IDs to source anchors.
   * The projection-to-source leg of the trace chain.
   */
  readonly blockToSourceRef: ReadonlyMap<string, SourceAnchor>;
  /** Section metadata encountered in this window. */
  readonly sectionMetadata: SectionMetadataDelta;
  /**
   * Typed references to resources needed by the projected content.
   * Only populated when WindowSpec.includeDependencyManifest is true.
   */
  readonly dependencyManifest?: DependencyManifest;
};
