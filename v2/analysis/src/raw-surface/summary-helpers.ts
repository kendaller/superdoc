// ---------------------------------------------------------------------------
// Summary Helpers
// ---------------------------------------------------------------------------
// Shared counting and sorting utilities used by both per-document and
// corpus-level summarization.
// ---------------------------------------------------------------------------

import type { SignatureCount } from './types.js';

/** Increment a count in a string-keyed record. */
export function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

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

/** Sort a record's keys alphabetically for deterministic JSON output. */
export function sortRecord(record: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}
