// ---------------------------------------------------------------------------
// Fact ID Generation
// ---------------------------------------------------------------------------
// Deterministic ID for each raw fact, derived from its canonical identity
// string: docId + partUri + factKind + xpathLikePath.
// ---------------------------------------------------------------------------

import type { FactKind } from './types.js';

/**
 * Build a deterministic rawFactId from the fact's identity components.
 *
 * Uses a simple string hash rather than SHA-1 to avoid crypto dependencies
 * while still producing stable, collision-resistant IDs for analysis purposes.
 */
export function buildRawFactId(docId: string, partUri: string, factKind: FactKind, xpathLikePath: string): string {
  const canonical = `${docId}\n${partUri}\n${factKind}\n${xpathLikePath}`;
  return `raw:${stringHash(canonical)}`;
}

/**
 * Fast deterministic string hash (FNV-1a 64-bit, hex-encoded).
 * Not cryptographic — used for stable content-addressing only.
 */
function stringHash(input: string): string {
  // FNV-1a parameters (using BigInt for 64-bit)
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, '0');
}
