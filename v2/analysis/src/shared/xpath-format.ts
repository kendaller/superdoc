// ---------------------------------------------------------------------------
// XPath-Like Path Formatting
// ---------------------------------------------------------------------------
// Shared path-formatting helpers used by both raw-surface (SAX-based) and
// the v1 source index (DOM-based). Ensures both paths produce identical
// xpathLikePath and pathSignature values for the same XML element.
// ---------------------------------------------------------------------------

/**
 * Format an indexed xpath-like path from a partUri and an array of path segments.
 *
 * Each segment must include the formatted element name and its 1-based sibling index.
 *
 * Example: `word/document.xml::/w:document[1]/w:body[1]/w:p[3]`
 */
export function formatXpathLikePath(
  partUri: string,
  segments: ReadonlyArray<{ formattedName: string; siblingIndex: number }>,
): string {
  const parts = segments.map((s) => `${s.formattedName}[${s.siblingIndex}]`);
  return `${partUri}::/${parts.join('/')}`;
}

/**
 * Format an unindexed path signature from a partUri and formatted element names.
 *
 * Example: `word/document.xml::/w:document/w:body/w:p`
 */
export function formatPathSignature(partUri: string, formattedNames: readonly string[]): string {
  return `${partUri}::/${formattedNames.join('/')}`;
}

/**
 * Strip sibling indices from an xpathLikePath to produce a pathSignature.
 *
 * `word/document.xml::/w:document[1]/w:body[1]/w:p[3]`
 * → `word/document.xml::/w:document/w:body/w:p`
 */
export function stripIndicesToSignature(xpathLikePath: string): string {
  return xpathLikePath.replace(/\[\d+\]/g, '');
}
