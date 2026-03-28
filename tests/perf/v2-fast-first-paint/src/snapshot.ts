import type { TimelineSnapshot, MarkEntry, SpanEntry } from '@superdoc/v2-perf';
import {
  OPEN_START,
  PAINT_FIRST_PAGE_MOUNTED,
  PAINT_FIRST_VISIBLE_PAGE_STABLE,
  PAINT_FULL_VISIBLE_VIEWPORT_MOUNTED,
  PROJECTION_FIRST_WINDOW_START,
  SPAN_OPEN,
  SPAN_RENDER,
} from '@superdoc/v2-perf';

/**
 * Finalize a browser-collected snapshot so artifact generation can treat
 * `render` as true time-to-first-paint and `open` as the phase before the
 * first projection window begins.
 *
 * The browser bridge records the canonical marks. This helper turns them into
 * stable synthetic spans without requiring benchmark-only behavior inside the
 * main rendering code paths.
 */
export function finalizeBrowserBenchmarkSnapshot(snapshot: TimelineSnapshot): TimelineSnapshot {
  const nextSnapshot = cloneSnapshot(snapshot);

  const openStartOffsetMs = findMarkOffset(nextSnapshot.marks, OPEN_START);
  const firstProjectionOffsetMs =
    findMarkOffset(nextSnapshot.marks, PROJECTION_FIRST_WINDOW_START) ??
    findSpanStartOffset(nextSnapshot.spans, 'projection');
  const firstStablePaintOffsetMs =
    findMarkOffset(nextSnapshot.marks, PAINT_FIRST_VISIBLE_PAGE_STABLE) ??
    findMarkOffset(nextSnapshot.marks, PAINT_FULL_VISIBLE_VIEWPORT_MOUNTED) ??
    findMarkOffset(nextSnapshot.marks, PAINT_FIRST_PAGE_MOUNTED);

  if (
    nextSnapshot.timings[SPAN_OPEN] == null &&
    openStartOffsetMs != null &&
    firstProjectionOffsetMs != null &&
    firstProjectionOffsetMs >= openStartOffsetMs
  ) {
    upsertSpan(nextSnapshot.spans, SPAN_OPEN, openStartOffsetMs, firstProjectionOffsetMs);
  }

  if (openStartOffsetMs != null && firstStablePaintOffsetMs != null && firstStablePaintOffsetMs >= openStartOffsetMs) {
    upsertSpan(nextSnapshot.spans, SPAN_RENDER, openStartOffsetMs, firstStablePaintOffsetMs);
  }

  nextSnapshot.timings = buildTimings(nextSnapshot.spans);
  return nextSnapshot;
}

function cloneSnapshot(snapshot: TimelineSnapshot): MutableTimelineSnapshot {
  return {
    originMs: snapshot.originMs,
    marks: snapshot.marks.map((mark) => ({ ...mark })),
    spans: snapshot.spans.map((span) => ({ ...span })),
    counts: { ...snapshot.counts },
    timings: { ...snapshot.timings },
  };
}

function findMarkOffset(marks: readonly MarkEntry[], name: string): number | undefined {
  return marks.find((mark) => mark.name === name)?.offsetMs;
}

function findSpanStartOffset(spans: readonly SpanEntry[], name: string): number | undefined {
  return spans.find((span) => span.name === name)?.startOffsetMs;
}

function upsertSpan(spans: SpanEntry[], name: string, startOffsetMs: number, endOffsetMs: number): void {
  const nextSpan: SpanEntry = {
    name,
    startOffsetMs,
    endOffsetMs,
    durationMs: Math.max(0, endOffsetMs - startOffsetMs),
  };

  const existingIndex = spans.findIndex((span) => span.name === name);
  if (existingIndex >= 0) {
    spans.splice(existingIndex, 1, nextSpan);
    return;
  }

  spans.push(nextSpan);
}

function buildTimings(spans: readonly SpanEntry[]): Record<string, number> {
  const timings: Record<string, number> = {};
  for (const span of spans) {
    timings[span.name] = span.durationMs;
  }
  return timings;
}

type MutableTimelineSnapshot = {
  originMs: TimelineSnapshot['originMs'];
  marks: MarkEntry[];
  spans: SpanEntry[];
  counts: Record<string, number>;
  timings: Record<string, number>;
};
