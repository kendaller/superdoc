// ---------------------------------------------------------------------------
// Write Helpers
// ---------------------------------------------------------------------------
// Shared file-writing utilities for artifact output.
// Used by both raw-surface and universe artifact writers.
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';

/** Write a value as pretty-printed JSON with a trailing newline. */
export function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/** Write an array of records as newline-delimited JSON (one JSON object per line). */
export function writeNdjson(filePath: string, records: unknown[]): void {
  const lines = records.map((r) => JSON.stringify(r));
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

/** Ensure a directory exists, creating it recursively if needed. */
export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}
