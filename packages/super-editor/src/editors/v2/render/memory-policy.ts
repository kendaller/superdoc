// ---------------------------------------------------------------------------
// Memory policy — pure eviction logic for the streaming paginated host.
//
// All functions are pure: they receive data and return an eviction plan.
// The host decides when and how to apply the plan.
// ---------------------------------------------------------------------------

import type { MemoryPolicy, WindowEvictionRecord, WindowRecord } from './streaming-host-types.js';

// ---- Defaults ---------------------------------------------------------------

export const DEFAULT_MEMORY_POLICY: Readonly<MemoryPolicy> = {
  maxMountedPages: 200,
  maxAccumulatedBlocks: 5_000,
  heapWarningMb: null,
  heapCeilingMb: null,
};

// ---- Eviction plan ----------------------------------------------------------

export type EvictionPlan = {
  /** Whether any eviction is needed. */
  shouldEvict: boolean;
  /** Window indices to evict (from the front of the windowRecords array). */
  evictWindowIndices: number[];
  /** Total block count that would be removed. */
  evictedBlockCount: number;
  /** New start body child index after eviction. */
  newRetainedStartBodyChildIndex: number;
};

/**
 * Evaluate whether window eviction is needed based on the memory policy,
 * the current accumulated state, and the visible page range.
 *
 * Eviction strategy: **tail-only** (trim from the beginning of the block
 * array). This preserves contiguity for `incrementalLayout`. Only windows
 * whose blocks are entirely before the visible range's start are eligible.
 *
 * @param policy - The memory policy to enforce
 * @param windowRecords - Current window records (in order)
 * @param totalBlockCount - Current total accumulated block count
 * @param visiblePageRange - Currently visible pages { first, last } (1-based)
 * @param pagesPerWindow - Estimated pages per window (for mapping windows to pages)
 */
export function evaluateEviction(
  policy: MemoryPolicy,
  windowRecords: readonly WindowRecord[],
  totalBlockCount: number,
  visiblePageRange: { first: number; last: number },
  pagesPerWindow: number,
): EvictionPlan {
  const noEviction: EvictionPlan = {
    shouldEvict: false,
    evictWindowIndices: [],
    evictedBlockCount: 0,
    newRetainedStartBodyChildIndex: windowRecords.length > 0 ? windowRecords[0].startBodyChildIndex : 0,
  };

  if (totalBlockCount <= policy.maxAccumulatedBlocks) {
    return noEviction;
  }

  // Determine which windows are safe to evict: those entirely before the
  // visible range. Use a conservative estimate: each window covers
  // `pagesPerWindow` pages, so window i covers pages [i*ppw+1, (i+1)*ppw].
  const safeEvictionThresholdPage = Math.max(1, visiblePageRange.first - 1);

  const evictWindowIndices: number[] = [];
  let evictedBlockCount = 0;
  let newRetainedStart = windowRecords.length > 0 ? windowRecords[0].startBodyChildIndex : 0;

  for (const record of windowRecords) {
    // Estimate the last page this window contributes to
    const windowLastPage = (record.index + 1) * pagesPerWindow;
    if (windowLastPage >= safeEvictionThresholdPage) {
      break; // This window may overlap with visible pages
    }

    evictWindowIndices.push(record.index);
    evictedBlockCount += record.blockCount;
    newRetainedStart = record.startBodyChildIndex + record.bodyChildCount;

    // Stop if we've evicted enough to get under the limit
    if (totalBlockCount - evictedBlockCount <= policy.maxAccumulatedBlocks) {
      break;
    }
  }

  if (evictWindowIndices.length === 0) {
    return noEviction;
  }

  return {
    shouldEvict: true,
    evictWindowIndices,
    evictedBlockCount,
    newRetainedStartBodyChildIndex: newRetainedStart,
  };
}

/**
 * Apply an eviction plan to window records and blocks, returning the
 * trimmed state and eviction records.
 *
 * Does NOT mutate inputs — returns new arrays.
 */
export function applyEviction<B>(
  plan: EvictionPlan,
  windowRecords: readonly WindowRecord[],
  blocks: readonly B[],
): {
  windowRecords: WindowRecord[];
  blocks: B[];
  evictionRecords: WindowEvictionRecord[];
} {
  if (!plan.shouldEvict || plan.evictWindowIndices.length === 0) {
    return {
      windowRecords: [...windowRecords],
      blocks: [...blocks],
      evictionRecords: [],
    };
  }

  const evictSet = new Set(plan.evictWindowIndices);
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const evictionRecords: WindowEvictionRecord[] = [];
  let blockOffset = 0;

  const trimmedRecords: WindowRecord[] = [];
  const blockSliceStart = plan.evictedBlockCount;

  for (const record of windowRecords) {
    if (evictSet.has(record.index)) {
      evictionRecords.push({
        windowIndex: record.index,
        evictedAt: now,
        blockRange: [blockOffset, blockOffset + record.blockCount],
      });
    } else {
      trimmedRecords.push(record);
    }
    blockOffset += record.blockCount;
  }

  return {
    windowRecords: trimmedRecords,
    blocks: blocks.slice(blockSliceStart) as B[],
    evictionRecords,
  };
}
