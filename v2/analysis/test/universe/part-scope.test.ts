import { describe, it, expect } from 'vitest';
import { isContentBearing, CONTENT_BEARING_PARTS, ignoredByRuleKey } from '../../src/universe/part-scope.js';
import type { PartKind } from '../../src/raw-surface/types.js';

const IGNORED_PARTS: PartKind[] = [
  'comments-extended', 'styles', 'numbering', 'settings', 'theme',
  'font-table', 'doc-props', 'content-types', 'relationships',
  'custom-xml', 'unknown-xml-part',
];

describe('part-scope', () => {
  it('identifies all 7 content-bearing part kinds', () => {
    expect(CONTENT_BEARING_PARTS.size).toBe(7);
    expect(isContentBearing('main-document')).toBe(true);
    expect(isContentBearing('header')).toBe(true);
    expect(isContentBearing('footer')).toBe(true);
    expect(isContentBearing('footnotes')).toBe(true);
    expect(isContentBearing('endnotes')).toBe(true);
    expect(isContentBearing('comments')).toBe(true);
    expect(isContentBearing('glossary-document')).toBe(true);
  });

  it('rejects all ignored part kinds', () => {
    for (const partKind of IGNORED_PARTS) {
      expect(isContentBearing(partKind)).toBe(false);
    }
  });

  it('builds ignored-by-rule keys', () => {
    expect(ignoredByRuleKey('styles')).toBe('part-scope:styles');
    expect(ignoredByRuleKey('theme')).toBe('part-scope:theme');
  });
});
