import { describe, expect, it } from 'vitest';
import { advanceStreamingBatchPolicy, createInitialStreamingBatchPolicy } from './streaming-batch-policy.js';

describe('streaming batch policy', () => {
  it('starts with a small bounded append window', () => {
    expect(createInitialStreamingBatchPolicy(50)).toEqual({
      bodyChildLimit: 13,
      maxBodyChildLimit: 50,
      pageEstimate: 2,
    });
  });

  it('shrinks the body-child limit after a slow append', () => {
    const initialPolicy = createInitialStreamingBatchPolicy(50);

    expect(
      advanceStreamingBatchPolicy(initialPolicy, {
        durationMs: 300,
        bodyChildrenConsumed: 13,
        pagesAdded: 2,
      }),
    ).toEqual({
      ...initialPolicy,
      bodyChildLimit: 9,
    });
  });

  it('grows the body-child limit when a fast append underfills the page target', () => {
    const initialPolicy = createInitialStreamingBatchPolicy(50);

    expect(
      advanceStreamingBatchPolicy(initialPolicy, {
        durationMs: 60,
        bodyChildrenConsumed: 13,
        pagesAdded: 1,
      }),
    ).toEqual({
      ...initialPolicy,
      bodyChildLimit: 20,
    });
  });

  it('applies aggressive shrink for a moderately slow field-heavy batch', () => {
    const initialPolicy = createInitialStreamingBatchPolicy(50);

    // Without fieldHeavyRatio, 300ms uses moderate shrink (0.75) → 9
    expect(
      advanceStreamingBatchPolicy(initialPolicy, {
        durationMs: 300,
        bodyChildrenConsumed: 13,
        pagesAdded: 2,
        fieldHeavyRatio: 0.8,
      }),
    ).toEqual({
      ...initialPolicy,
      bodyChildLimit: 6, // aggressive shrink (0.5) instead of moderate (0.75)
    });
  });

  it('uses moderate shrink for a slow batch with low field-heavy ratio', () => {
    const initialPolicy = createInitialStreamingBatchPolicy(50);

    expect(
      advanceStreamingBatchPolicy(initialPolicy, {
        durationMs: 300,
        bodyChildrenConsumed: 13,
        pagesAdded: 2,
        fieldHeavyRatio: 0.2,
      }),
    ).toEqual({
      ...initialPolicy,
      bodyChildLimit: 9, // moderate shrink (0.75) — not field-heavy
    });
  });
});
