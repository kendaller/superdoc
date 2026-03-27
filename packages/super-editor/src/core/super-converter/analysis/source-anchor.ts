// ---------------------------------------------------------------------------
// Source Anchor Helpers
// ---------------------------------------------------------------------------
// Deterministic anchor ID generation and source anchor construction.
// ---------------------------------------------------------------------------

// FNV-1a 64-bit hash (inlined to avoid cross-package dependency on v2/analysis)
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Build a deterministic anchorId from the source anchor's identity components.
 *
 * The canonical key is `${partUri}\n${xpathLikePath}`. The anchorId is a
 * compact hash of this key with an `a:` prefix.
 */
export function buildAnchorId(partUri: string, xpathLikePath: string): string {
  const canonical = `${partUri}\n${xpathLikePath}`;
  return `a:${fnv1a64(canonical)}`;
}

/**
 * Strip sibling indices from an xpathLikePath to produce a pathSignature.
 *
 * `word/document.xml::/w:document[1]/w:body[1]/w:p[3]`
 * -> `word/document.xml::/w:document/w:body/w:p`
 */
export function toPathSignature(xpathLikePath: string): string {
  return xpathLikePath.replace(/\[\d+\]/g, '');
}
