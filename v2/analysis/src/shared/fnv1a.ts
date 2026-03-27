// ---------------------------------------------------------------------------
// FNV-1a 64-bit Hash
// ---------------------------------------------------------------------------
// Fast deterministic string hash used for stable content-addressing.
// Not cryptographic — collision-resistant enough for analysis IDs.
//
// Shared by raw-surface (rawFactId) and universe (occurrenceId).
// ---------------------------------------------------------------------------

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * Compute a 64-bit FNV-1a hash of the input string.
 *
 * Returns a 16-character lowercase hex string (zero-padded).
 */
export function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }

  return hash.toString(16).padStart(16, '0');
}
