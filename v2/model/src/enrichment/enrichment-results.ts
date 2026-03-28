// ---------------------------------------------------------------------------
// Enrichment result types — structured-cloneable payloads per target
//
// Each result carries its merge policy discriminant so the host knows
// how to apply it: overlay-only (no relayout), decoration (repaint only),
// or layout-affecting (triggers incremental relayout).
// ---------------------------------------------------------------------------

import type { FlowBlock } from '../projections/layout/types.js';

// ---- Merge policy -----------------------------------------------------------

export type MergePolicy = 'overlay-only' | 'decoration' | 'layout-affecting';

// ---- Per-target item types --------------------------------------------------

export type HeaderFooterItem = {
  relationshipId: string;
  type: 'header' | 'footer';
  partUri: string;
  blocks: FlowBlock[];
};

export type AnnotationItem = {
  wordId: string;
  blocks: FlowBlock[];
};

export type CommentItem = {
  commentId: string;
  author?: string;
  date?: string;
  initials?: string;
  blocks: FlowBlock[];
};

export type ImageItem = {
  relationshipId: string;
  partUri: string;
  mimeType: string;
  /** Raw image bytes. Transferable across worker boundary. */
  data: ArrayBuffer;
};

// ---- Per-target result types ------------------------------------------------

export type HeaderFooterEnrichmentResult = {
  target: 'headers-footers';
  mergePolicy: 'layout-affecting';
  items: HeaderFooterItem[];
};

export type FootnoteEnrichmentResult = {
  target: 'footnotes';
  mergePolicy: 'layout-affecting';
  items: AnnotationItem[];
};

export type EndnoteEnrichmentResult = {
  target: 'endnotes';
  mergePolicy: 'decoration';
  items: AnnotationItem[];
};

export type CommentEnrichmentResult = {
  target: 'comments';
  mergePolicy: 'overlay-only';
  items: CommentItem[];
};

export type ImageEnrichmentResult = {
  target: 'images';
  mergePolicy: 'decoration';
  items: ImageItem[];
};

// ---- Union ------------------------------------------------------------------

export type EnrichmentResult =
  | HeaderFooterEnrichmentResult
  | FootnoteEnrichmentResult
  | EndnoteEnrichmentResult
  | CommentEnrichmentResult
  | ImageEnrichmentResult;
