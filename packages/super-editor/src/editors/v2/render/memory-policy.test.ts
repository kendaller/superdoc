// ---------------------------------------------------------------------------
// Memory policy unit tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { evaluateEviction, applyEviction, DEFAULT_MEMORY_POLICY } from './memory-policy.js';
import type { MemoryPolicy, WindowRecord } from './streaming-host-types.js';

// ---- Helpers ----------------------------------------------------------------

function makeWindowRecord(
  index: number,
  startBodyChildIndex: number,
  bodyChildCount: number,
  blockCount: number,
): WindowRecord {
  return {
    index,
    startBodyChildIndex,
    bodyChildCount,
    blockCount,
    blocks: Array.from({ length: blockCount }, (_, i) => ({
      id: `w${index}-b${i}`,
      kind: 'paragraph' as const,
      runs: [],
      attrs: {},
    })),
    sectionMetadataDelta: { sectionBreaks: [] },
    status: 'laid-out',
  };
}

// ---- evaluateEviction -------------------------------------------------------

describe('evaluateEviction', () => {
  it('returns no eviction when under the block limit', () => {
    const policy: MemoryPolicy = { ...DEFAULT_MEMORY_POLICY, maxAccumulatedBlocks: 100 };
    const records = [makeWindowRecord(0, 0, 10, 20), makeWindowRecord(1, 10, 10, 20)];
    const plan = evaluateEviction(policy, records, 40, { first: 1, last: 2 }, 2);
    expect(plan.shouldEvict).toBe(false);
  });

  it('evicts oldest windows when over the block limit', () => {
    const policy: MemoryPolicy = { ...DEFAULT_MEMORY_POLICY, maxAccumulatedBlocks: 100 };
    // 4 windows, 50 blocks each = 200 total, limit is 100
    const records = [
      makeWindowRecord(0, 0, 25, 50),
      makeWindowRecord(1, 25, 25, 50),
      makeWindowRecord(2, 50, 25, 50),
      makeWindowRecord(3, 75, 25, 50),
    ];
    // Visible pages 7-8, with 2 pages per window, so:
    // window 0 covers pages 1-2, window 1 covers pages 3-4
    // window 2 covers pages 5-6, window 3 covers pages 7-8
    // Safe to evict: windows where last page < visible first (7) - 1 = 6
    // window 0 last page = 2 < 6 → evict
    // window 1 last page = 4 < 6 → evict
    // window 2 last page = 6 >= 6 → stop
    const plan = evaluateEviction(policy, records, 200, { first: 7, last: 8 }, 2);
    expect(plan.shouldEvict).toBe(true);
    expect(plan.evictWindowIndices).toEqual([0, 1]);
    expect(plan.evictedBlockCount).toBe(100);
    expect(plan.newRetainedStartBodyChildIndex).toBe(50);
  });

  it('does not evict windows overlapping visible range', () => {
    const policy: MemoryPolicy = { ...DEFAULT_MEMORY_POLICY, maxAccumulatedBlocks: 10 };
    // All windows overlap with visible range (pages 1-4)
    const records = [makeWindowRecord(0, 0, 10, 20), makeWindowRecord(1, 10, 10, 20)];
    const plan = evaluateEviction(policy, records, 40, { first: 1, last: 4 }, 2);
    expect(plan.shouldEvict).toBe(false);
  });

  it('stops evicting once under the limit', () => {
    const policy: MemoryPolicy = { ...DEFAULT_MEMORY_POLICY, maxAccumulatedBlocks: 150 };
    const records = [
      makeWindowRecord(0, 0, 10, 50),
      makeWindowRecord(1, 10, 10, 50),
      makeWindowRecord(2, 20, 10, 50),
      makeWindowRecord(3, 30, 10, 50),
    ];
    // Visible pages 7-8, 2 pages per window
    // window 0 last page = 2, window 1 = 4, window 2 = 6
    // Evict window 0: 200 - 50 = 150 ≤ 150 → stop
    const plan = evaluateEviction(policy, records, 200, { first: 7, last: 8 }, 2);
    expect(plan.shouldEvict).toBe(true);
    expect(plan.evictWindowIndices).toEqual([0]);
    expect(plan.evictedBlockCount).toBe(50);
  });

  it('handles empty window records', () => {
    const policy: MemoryPolicy = { ...DEFAULT_MEMORY_POLICY, maxAccumulatedBlocks: 10 };
    const plan = evaluateEviction(policy, [], 0, { first: 1, last: 1 }, 2);
    expect(plan.shouldEvict).toBe(false);
  });
});

// ---- applyEviction ----------------------------------------------------------

describe('applyEviction', () => {
  it('trims blocks and records for evicted windows', () => {
    const records = [makeWindowRecord(0, 0, 10, 3), makeWindowRecord(1, 10, 10, 3), makeWindowRecord(2, 20, 10, 3)];
    const blocks = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

    const plan = {
      shouldEvict: true,
      evictWindowIndices: [0, 1],
      evictedBlockCount: 6,
      newRetainedStartBodyChildIndex: 20,
    };

    const result = applyEviction(plan, records, blocks);

    expect(result.blocks).toEqual(['g', 'h', 'i']);
    expect(result.windowRecords).toHaveLength(1);
    expect(result.windowRecords[0].index).toBe(2);
    expect(result.evictionRecords).toHaveLength(2);
    expect(result.evictionRecords[0].windowIndex).toBe(0);
    expect(result.evictionRecords[0].blockRange).toEqual([0, 3]);
    expect(result.evictionRecords[1].windowIndex).toBe(1);
    expect(result.evictionRecords[1].blockRange).toEqual([3, 6]);
  });

  it('returns copies when no eviction is needed', () => {
    const records = [makeWindowRecord(0, 0, 10, 3)];
    const blocks = ['a', 'b', 'c'];
    const plan = {
      shouldEvict: false,
      evictWindowIndices: [],
      evictedBlockCount: 0,
      newRetainedStartBodyChildIndex: 0,
    };

    const result = applyEviction(plan, records, blocks);
    expect(result.blocks).toEqual(blocks);
    expect(result.windowRecords).toEqual(records);
    expect(result.evictionRecords).toHaveLength(0);

    // Should be copies, not same reference
    expect(result.blocks).not.toBe(blocks);
    expect(result.windowRecords).not.toBe(records);
  });

  it('does not mutate original arrays', () => {
    const records = [makeWindowRecord(0, 0, 10, 3), makeWindowRecord(1, 10, 10, 3)];
    const blocks = ['a', 'b', 'c', 'd', 'e', 'f'];

    const plan = {
      shouldEvict: true,
      evictWindowIndices: [0],
      evictedBlockCount: 3,
      newRetainedStartBodyChildIndex: 10,
    };

    applyEviction(plan, records, blocks);

    // Originals unchanged
    expect(records).toHaveLength(2);
    expect(blocks).toHaveLength(6);
  });
});
