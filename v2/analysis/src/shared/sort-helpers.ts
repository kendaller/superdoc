// ---------------------------------------------------------------------------
// Sort Helpers
// ---------------------------------------------------------------------------
// Shared counting and sorting utilities for deterministic output.
// Used by both raw-surface and universe summarization.
// ---------------------------------------------------------------------------

/** Increment a count in a string-keyed record. */
export function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Sort a record's keys alphabetically for deterministic JSON output. */
export function sortRecord(record: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}
