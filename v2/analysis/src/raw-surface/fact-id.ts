// ---------------------------------------------------------------------------
// Fact ID Generation
// ---------------------------------------------------------------------------
// Deterministic ID for each raw fact, derived from its canonical identity
// string: docId + partUri + factKind + xpathLikePath.
// ---------------------------------------------------------------------------

import type { FactKind } from './types.js';
import { fnv1a64 } from '../shared/fnv1a.js';

/**
 * Build a deterministic rawFactId from the fact's identity components.
 *
 * Uses FNV-1a 64-bit hash for stable, collision-resistant IDs.
 */
export function buildRawFactId(docId: string, partUri: string, factKind: FactKind, xpathLikePath: string): string {
  const canonical = `${docId}\n${partUri}\n${factKind}\n${xpathLikePath}`;
  return `raw:${fnv1a64(canonical)}`;
}
