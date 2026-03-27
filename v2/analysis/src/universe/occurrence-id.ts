// ---------------------------------------------------------------------------
// Occurrence ID Generation
// ---------------------------------------------------------------------------
// Deterministic ID for each feature occurrence, derived from:
//   docId + featureKey + anchorXpathLikePath
//
// Uses the same FNV-1a hash as rawFactId for consistency.
// Null-byte separators prevent concatenation ambiguity.
// ---------------------------------------------------------------------------

import { fnv1a64 } from '../shared/fnv1a.js';

/**
 * Build a deterministic occurrenceId from the occurrence's identity components.
 *
 * Returns "occ:" + 16-character hex hash.
 */
export function buildOccurrenceId(docId: string, featureKey: string, anchorXpathLikePath: string): string {
  const canonical = `${docId}\0${featureKey}\0${anchorXpathLikePath}`;
  return `occ:${fnv1a64(canonical)}`;
}
