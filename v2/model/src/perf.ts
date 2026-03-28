// ---------------------------------------------------------------------------
// v2/model performance instrumentation
//
// Thin wrappers around the shared PerfTimeline for model-layer operations.
// All calls are no-ops when the timeline is disabled (zero overhead).
// ---------------------------------------------------------------------------

import {
  v2PerfTimeline,
  OPEN_START,
  OPEN_FAST_OPEN_COMPLETE,
  OPEN_BYTES_READ_BEFORE_FIRST_PAINT,
  OPEN_STRUCTURE_READY,
  OPEN_XML_PARTS_MATERIALIZED_BEFORE_FIRST_PAINT,
  PROJECTION_FIRST_WINDOW_COMPLETE,
  PROJECTION_FIRST_WINDOW_START,
  SPAN_OPEN,
  SPAN_FAST_OPEN,
  SPAN_MATERIALIZE_XML,
  SPAN_ADVANCE_TO_STRUCTURE,
  SPAN_INDEX_XML_PARTS,
  SPAN_PROJECTION,
  PROJECTION_BLOCKS_PROJECTED_BEFORE_FIRST_PAINT,
} from '@superdoc/v2-perf';

const tl = v2PerfTimeline;

// ---- Open / Session marks --------------------------------------------------

export function markOpenStart(): void {
  tl.mark(OPEN_START);
}

export function markFastOpenComplete(): void {
  tl.mark(OPEN_FAST_OPEN_COMPLETE);
}

export function markStructureReady(): void {
  tl.mark(OPEN_STRUCTURE_READY);
}

export function recordBytesReadBeforeFirstPaint(bytes: number): void {
  tl.gauge(OPEN_BYTES_READ_BEFORE_FIRST_PAINT, bytes);
}

// ---- Open / Session spans --------------------------------------------------

export function startOpenSpan(): () => void {
  return tl.startSpan(SPAN_OPEN);
}

export function startFastOpenSpan(): () => void {
  return tl.startSpan(SPAN_FAST_OPEN);
}

export function startMaterializeXmlSpan(): () => void {
  return tl.startSpan(SPAN_MATERIALIZE_XML);
}

export function startAdvanceToStructureSpan(): () => void {
  return tl.startSpan(SPAN_ADVANCE_TO_STRUCTURE);
}

export function startIndexXmlPartsSpan(): () => void {
  return tl.startSpan(SPAN_INDEX_XML_PARTS);
}

// ---- Open / Session counts -------------------------------------------------

export function recordXmlPartsMaterialized(count: number): void {
  tl.gauge(OPEN_XML_PARTS_MATERIALIZED_BEFORE_FIRST_PAINT, count);
}

// ---- Projection spans ------------------------------------------------------

export function markProjectionFirstWindowStart(): void {
  tl.mark(PROJECTION_FIRST_WINDOW_START);
}

export function markProjectionFirstWindowComplete(blockCount: number): void {
  tl.mark(PROJECTION_FIRST_WINDOW_COMPLETE, { blockCount });
}

export function startProjectionSpan(): () => void {
  return tl.startSpan(SPAN_PROJECTION);
}

export function recordBlocksProjected(count: number): void {
  tl.gauge(PROJECTION_BLOCKS_PROJECTED_BEFORE_FIRST_PAINT, count);
}
