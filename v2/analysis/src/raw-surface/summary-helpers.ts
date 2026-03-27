// ---------------------------------------------------------------------------
// Summary Helpers
// ---------------------------------------------------------------------------
// Counting and sorting utilities for raw-surface summarization.
// Core helpers (increment, sortRecord) live in shared/ and are re-exported
// here for backward compatibility within the raw-surface layer.
// ---------------------------------------------------------------------------

import type { SignatureCount } from './types.js';

export { increment, sortRecord } from '../shared/sort-helpers.js';

/** Merge source counts into target counts. */
export function mergeRecordCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + count;
  }
}

/** Build a top-N signature list sorted by count descending, then by name. */
export function buildTopSignatures(counts: Record<string, number>, limit: number): SignatureCount[] {
  return Object.entries(counts)
    .map(([pathSignature, count]) => ({ pathSignature, count }))
    .sort((a, b) => b.count - a.count || a.pathSignature.localeCompare(b.pathSignature))
    .slice(0, limit);
}
