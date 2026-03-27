// ---------------------------------------------------------------------------
// Open DOCX
// ---------------------------------------------------------------------------
// ZIP loading and part byte access. Returns the raw entries from a .docx
// package without any interpretation — just bytes and paths.
// ---------------------------------------------------------------------------

import { unzipSync, type Unzipped } from 'fflate';

/** A single raw entry from the ZIP package. */
export type ZipEntry = {
  path: string;
  bytes: Uint8Array;
};

/** Open a .docx file from raw bytes and return all ZIP entries, sorted by path. */
export function openDocx(input: Uint8Array): ZipEntry[] {
  const unzipped: Unzipped = unzipSync(input);

  return Object.entries(unzipped)
    .map(([path, bytes]) => ({ path, bytes }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
