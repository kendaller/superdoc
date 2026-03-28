// ---------------------------------------------------------------------------
// Shadow mode — compares v2-streaming output against the legacy PM path.
//
// When SD_V2_STREAMING_SHADOW is enabled, V2StreamingRenderer runs in a
// hidden container alongside the PM path. This module provides the
// comparison logic. Results are emitted as events for telemetry.
// ---------------------------------------------------------------------------

// ---- Types ------------------------------------------------------------------

export type ShadowComparisonInput = {
  pageCount: number;
  blockCount: number;
  firstPaintMs: number;
};

export type ShadowComparison = {
  pageCountMatch: boolean;
  blockCountDelta: number;
  firstPaintTimeDeltaMs: number;
  discrepancies: string[];
};

// ---- Comparison -------------------------------------------------------------

/**
 * Compare a v2-streaming result against a PM (legacy) result.
 *
 * Returns a structured comparison suitable for telemetry and debugging.
 * The caller decides what to do with it (log, emit event, etc.).
 */
export function compareShadowResult(
  v2Result: ShadowComparisonInput,
  pmResult: ShadowComparisonInput,
): ShadowComparison {
  const discrepancies: string[] = [];

  const pageCountMatch = v2Result.pageCount === pmResult.pageCount;
  if (!pageCountMatch) {
    discrepancies.push(`Page count mismatch: v2=${v2Result.pageCount}, pm=${pmResult.pageCount}`);
  }

  const blockCountDelta = v2Result.blockCount - pmResult.blockCount;
  if (blockCountDelta !== 0) {
    discrepancies.push(
      `Block count delta: v2=${v2Result.blockCount}, pm=${pmResult.blockCount} (delta=${blockCountDelta})`,
    );
  }

  const firstPaintTimeDeltaMs = v2Result.firstPaintMs - pmResult.firstPaintMs;

  return {
    pageCountMatch,
    blockCountDelta,
    firstPaintTimeDeltaMs,
    discrepancies,
  };
}
