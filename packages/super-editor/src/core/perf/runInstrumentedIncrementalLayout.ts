import { incrementalLayout, type IncrementalLayoutResult } from '@superdoc/layout-bridge';
import {
  v2PerfTimeline,
  LAYOUT_BLOCKS_MEASURED_BEFORE_FIRST_PAINT,
  LAYOUT_FIRST_MEASURE_COMPLETE,
  LAYOUT_FIRST_MEASURE_START,
  LAYOUT_FIRST_PAGINATION_COMPLETE,
  SPAN_MEASUREMENT,
  SPAN_PAGINATION,
} from '@superdoc/v2-perf';

type IncrementalLayoutMeasureFn = Parameters<typeof incrementalLayout>[4];
type IncrementalLayoutHeaderFooterInput = Parameters<typeof incrementalLayout>[5];

export type InstrumentedIncrementalLayoutOptions = {
  previousBlocks: Parameters<typeof incrementalLayout>[0];
  previousLayout: Parameters<typeof incrementalLayout>[1];
  nextBlocks: Parameters<typeof incrementalLayout>[2];
  layoutOptions: Parameters<typeof incrementalLayout>[3];
  measureBlock: IncrementalLayoutMeasureFn;
  headerFooter?: IncrementalLayoutHeaderFooterInput;
  previousMeasures?: Parameters<typeof incrementalLayout>[6];
};

export type InstrumentedIncrementalLayoutMetrics = {
  blocksMeasured: number;
  measurementDurationMs: number;
  paginationDurationMs: number;
  totalDurationMs: number;
};

export type InstrumentedIncrementalLayoutOutput = {
  result: IncrementalLayoutResult;
  metrics: InstrumentedIncrementalLayoutMetrics;
};

/**
 * Run `incrementalLayout()` and, when benchmark collection is enabled, split
 * the total duration into measurement time and non-measurement pagination time.
 *
 * The layout engine currently exposes one top-level async call. Measuring block
 * durations inside the provided `measureBlock` callback is the least invasive
 * way to produce stable phase metrics without pushing benchmark-only code into
 * the layout engine itself.
 */
export async function runInstrumentedIncrementalLayout(
  options: InstrumentedIncrementalLayoutOptions,
): Promise<InstrumentedIncrementalLayoutOutput> {
  if (!v2PerfTimeline.enabled) {
    const result = await incrementalLayout(
      options.previousBlocks,
      options.previousLayout,
      options.nextBlocks,
      options.layoutOptions,
      options.measureBlock,
      options.headerFooter,
      options.previousMeasures,
    );

    return {
      result,
      metrics: {
        blocksMeasured: 0,
        measurementDurationMs: 0,
        paginationDurationMs: 0,
        totalDurationMs: 0,
      },
    };
  }

  let blocksMeasured = 0;
  let measurementDurationMs = 0;
  let hasMarkedFirstMeasureStart = false;
  let hasMarkedFirstMeasureComplete = false;
  const totalStartMs = perfNow();

  const result = await incrementalLayout(
    options.previousBlocks,
    options.previousLayout,
    options.nextBlocks,
    options.layoutOptions,
    async (block, constraints) => {
      if (!hasMarkedFirstMeasureStart) {
        hasMarkedFirstMeasureStart = true;
        v2PerfTimeline.mark(LAYOUT_FIRST_MEASURE_START);
      }

      const measureStartMs = perfNow();
      const measuredBlock = await options.measureBlock(block, constraints);
      const measuredDurationMs = perfNow() - measureStartMs;

      measurementDurationMs += measuredDurationMs;
      blocksMeasured += 1;

      if (!hasMarkedFirstMeasureComplete) {
        hasMarkedFirstMeasureComplete = true;
        v2PerfTimeline.mark(LAYOUT_FIRST_MEASURE_COMPLETE, {
          blockKind: block.kind,
          blockId: block.id,
        });
      }

      return measuredBlock;
    },
    options.headerFooter,
    options.previousMeasures,
  );

  const totalDurationMs = perfNow() - totalStartMs;
  const paginationDurationMs = Math.max(0, totalDurationMs - measurementDurationMs);

  v2PerfTimeline.recordSpan(SPAN_MEASUREMENT, measurementDurationMs, {
    blocksMeasured,
  });
  v2PerfTimeline.recordSpan(SPAN_PAGINATION, paginationDurationMs, {
    blocksMeasured,
  });
  v2PerfTimeline.mark(LAYOUT_FIRST_PAGINATION_COMPLETE, {
    blocksMeasured,
  });
  v2PerfTimeline.gauge(LAYOUT_BLOCKS_MEASURED_BEFORE_FIRST_PAINT, blocksMeasured);

  return {
    result,
    metrics: {
      blocksMeasured,
      measurementDurationMs,
      paginationDurationMs,
      totalDurationMs,
    },
  };
}

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
