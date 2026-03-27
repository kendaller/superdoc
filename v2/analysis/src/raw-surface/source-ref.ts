// ---------------------------------------------------------------------------
// Source Reference
// ---------------------------------------------------------------------------
// Builds stable source evidence objects that link a fact back to its exact
// location in the original XML.
// ---------------------------------------------------------------------------

import type { SourceRef } from './types.js';

/** Create a SourceRef for a fact at the current scan position. */
export function buildSourceRef(partUri: string, xpathLikePath: string, line?: number, column?: number): SourceRef {
  const ref: SourceRef = { partUri, xpathLikePath };
  if (line !== undefined) ref.line = line;
  if (column !== undefined) ref.column = column;
  return ref;
}
