// ---------------------------------------------------------------------------
// Projection feeder abstraction
//
// Provides a uniform interface for projectors to consume document structure
// from either the semantic model or the render-shell. Both feeders produce
// the same raw property types and SourceAnchor identities, so projectors
// never need to know which data source is driving them.
// ---------------------------------------------------------------------------

import type {
  ParagraphRawProperties,
  RunRawProperties,
  TableRawProperties,
  TableRowRawProperties,
  TableCellRawProperties,
  SectionRawProperties,
  ContentControlRawProperties,
  DrawingRawProperties,
} from '../../entities/types.js';
import type { SourceAnchor } from './source-anchor.js';

// ---- Source anchor -----------------------------------------------------------

export type { SourceAnchor } from './source-anchor.js';

// ---- Feeder node ------------------------------------------------------------

export type FeederNodeKind =
  | 'paragraph'
  | 'run'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'section'
  | 'contentControl'
  | 'drawing';

/** Maps feeder node kind → raw properties type (same types entities produce). */
export type RawPropertiesForFeederKind = {
  paragraph: ParagraphRawProperties;
  run: RunRawProperties;
  table: TableRawProperties;
  tableRow: TableRowRawProperties;
  tableCell: TableCellRawProperties;
  section: SectionRawProperties;
  contentControl: ContentControlRawProperties;
  drawing: DrawingRawProperties;
};

/**
 * A node handle that projectors consume. Wraps either a semantic Entity
 * or a raw XmlElementNode + extracted properties. Projectors never see
 * the difference.
 */
export type FeederNode<K extends FeederNodeKind = FeederNodeKind> = {
  readonly kind: K;
  /** Source-backed identity anchor — used for stable block IDs. */
  readonly sourceAnchor: SourceAnchor;
  /** Lazily extracted raw properties (same types entities produce). */
  raw(): RawPropertiesForFeederKind[K];
};

export type DisplayRunSource = {
  readonly raw: Pick<RunRawProperties, 'formatting' | 'segments'>;
};

// ---- Projection feeder interface --------------------------------------------

/**
 * The projection feeder — the abstraction both the semantic-model path
 * and the render-shell path implement. Provides child-traversal over
 * an entity-like structure without coupling to the concrete data source.
 */
export type ProjectionFeeder = {
  /** Iterate runs within a paragraph node. */
  paragraphRuns(node: FeederNode<'paragraph'>): FeederNode<'run'>[];

  /**
   * Iterate visible result runs within a paragraph node.
   *
   * This is the display-first fast path used for field-heavy paragraphs such
   * as TOC entries. Instruction-only runs must be omitted by the caller.
   */
  paragraphDisplayRuns(node: FeederNode<'paragraph'>, instructionRunIds: ReadonlySet<string>): DisplayRunSource[];

  /** Iterate rows within a table node. */
  tableRows(node: FeederNode<'table'>): FeederNode<'tableRow'>[];

  /** Iterate cells within a table row node. */
  tableCells(node: FeederNode<'tableRow'>): FeederNode<'tableCell'>[];

  /** Iterate block content within a table cell node. */
  cellContent(node: FeederNode<'tableCell'>): FeederNode<'paragraph' | 'table'>[];

  /**
   * Resolve a drawing segment to its extracted properties and image source.
   *
   * Returns undefined if the drawing cannot be resolved (e.g., anchored
   * drawing without inline representation, or missing relationship).
   */
  resolveDrawing(
    runNode: FeederNode<'run'>,
    drawingLocalId: string,
  ): { raw: DrawingRawProperties; imageSrc: string | undefined } | undefined;
};
