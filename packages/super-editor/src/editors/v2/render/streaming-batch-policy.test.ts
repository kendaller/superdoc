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
});
