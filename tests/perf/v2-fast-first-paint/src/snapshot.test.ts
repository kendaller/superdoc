import { describe, expect, it } from 'vitest';
import type { TimelineSnapshot } from '@superdoc/v2-perf';
import { finalizeBrowserBenchmarkSnapshot } from './snapshot.js';

function createSnapshot(overrides: Partial<TimelineSnapshot> = {}): TimelineSnapshot {
  return {
    originMs: 0,
    marks: [
      { name: 'open.start', offsetMs: 0 },
      { name: 'projection.firstWindowStart', offsetMs: 12 },
      { name: 'paint.firstVisiblePageStable', offsetMs: 48 },
    ],
    spans: [
      { name: 'projection', startOffsetMs: 12, endOffsetMs: 25, durationMs: 13 },
      { name: 'layout.measurement', startOffsetMs: 25, endOffsetMs: 35, durationMs: 10 },
      { name: 'layout.pagination', startOffsetMs: 35, endOffsetMs: 43, durationMs: 8 },
      { name: 'paint', startOffsetMs: 43, endOffsetMs: 48, durationMs: 5 },
    ],
    counts: {},
    timings: {
      projection: 13,
      'layout.measurement': 10,
      'layout.pagination': 8,
      paint: 5,
    },
    ...overrides,
  };
}

describe('finalizeBrowserBenchmarkSnapshot', () => {
  it('derives an open span when one is missing', () => {
    const snapshot = finalizeBrowserBenchmarkSnapshot(createSnapshot());

    expect(snapshot.timings.open).toBe(12);
  });

  it('replaces render timing with true browser TTFFP from marks', () => {
    const snapshot = finalizeBrowserBenchmarkSnapshot(
      createSnapshot({
        spans: [{ name: 'render', startOffsetMs: 12, endOffsetMs: 48, durationMs: 36 }],
        timings: {
          render: 36,
        },
      }),
    );

    expect(snapshot.timings.render).toBe(48);
  });

  it('leaves existing open timing intact when already recorded', () => {
    const snapshot = finalizeBrowserBenchmarkSnapshot(
      createSnapshot({
        spans: [
          { name: 'open', startOffsetMs: 0, endOffsetMs: 20, durationMs: 20 },
          { name: 'projection', startOffsetMs: 20, endOffsetMs: 30, durationMs: 10 },
        ],
        timings: {
          open: 20,
          projection: 10,
        },
        marks: [
          { name: 'open.start', offsetMs: 0 },
          { name: 'projection.firstWindowStart', offsetMs: 20 },
          { name: 'paint.firstVisiblePageStable', offsetMs: 50 },
        ],
      }),
    );

    expect(snapshot.timings.open).toBe(20);
    expect(snapshot.timings.render).toBe(50);
  });
});
