// ---------------------------------------------------------------------------
// Shadow mode comparison tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { compareShadowResult } from './shadow-mode.js';

describe('compareShadowResult', () => {
  it('returns match when both results are identical', () => {
    const result = compareShadowResult(
      { pageCount: 5, blockCount: 100, firstPaintMs: 200 },
      { pageCount: 5, blockCount: 100, firstPaintMs: 300 },
    );
    expect(result.pageCountMatch).toBe(true);
    expect(result.blockCountDelta).toBe(0);
    expect(result.firstPaintTimeDeltaMs).toBe(-100); // v2 was faster
    expect(result.discrepancies).toHaveLength(0);
  });

  it('detects page count mismatch', () => {
    const result = compareShadowResult(
      { pageCount: 5, blockCount: 100, firstPaintMs: 200 },
      { pageCount: 4, blockCount: 100, firstPaintMs: 200 },
    );
    expect(result.pageCountMatch).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]).toContain('Page count mismatch');
  });

  it('detects block count delta', () => {
    const result = compareShadowResult(
      { pageCount: 5, blockCount: 120, firstPaintMs: 200 },
      { pageCount: 5, blockCount: 100, firstPaintMs: 200 },
    );
    expect(result.blockCountDelta).toBe(20);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]).toContain('Block count delta');
  });

  it('reports multiple discrepancies', () => {
    const result = compareShadowResult(
      { pageCount: 6, blockCount: 120, firstPaintMs: 200 },
      { pageCount: 5, blockCount: 100, firstPaintMs: 200 },
    );
    expect(result.discrepancies).toHaveLength(2);
  });

  it('computes firstPaintTimeDeltaMs correctly', () => {
    const result = compareShadowResult(
      { pageCount: 5, blockCount: 100, firstPaintMs: 500 },
      { pageCount: 5, blockCount: 100, firstPaintMs: 300 },
    );
    expect(result.firstPaintTimeDeltaMs).toBe(200); // v2 was slower
  });
});
