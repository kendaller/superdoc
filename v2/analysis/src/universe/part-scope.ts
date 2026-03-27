// ---------------------------------------------------------------------------
// Part Scope
// ---------------------------------------------------------------------------
// Defines which PartKind values are content-bearing (in scope for Layer 1
// feature extraction) vs intentionally ignored by rule.
//
// This is the single source of truth for the first-slice part-scope boundary.
// ---------------------------------------------------------------------------

import type { PartKind } from '../raw-surface/types.js';

/**
 * Content-bearing parts: scanned for feature occurrences.
 * Facts from these parts are either claimed or unmapped.
 */
export const CONTENT_BEARING_PARTS: ReadonlySet<PartKind> = new Set([
  'main-document',
  'header',
  'footer',
  'footnotes',
  'endnotes',
  'comments',
  'glossary-document',
]);

/** Returns true if the part kind is content-bearing (in scope for feature extraction). */
export function isContentBearing(partKind: PartKind): boolean {
  return CONTENT_BEARING_PARTS.has(partKind);
}

/**
 * Build the ignored-by-rule summary key for a non-content-bearing part.
 * Example: "part-scope:styles"
 */
export function ignoredByRuleKey(partKind: PartKind): string {
  return `part-scope:${partKind}`;
}
