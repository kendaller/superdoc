import { describe, it, expect } from 'vitest';
import { formatXpathLikePath, formatPathSignature, stripIndicesToSignature } from '../../src/shared/xpath-format.js';

describe('formatXpathLikePath', () => {
  it('formats a simple path with indices', () => {
    const result = formatXpathLikePath('word/document.xml', [
      { formattedName: 'w:document', siblingIndex: 1 },
      { formattedName: 'w:body', siblingIndex: 1 },
      { formattedName: 'w:p', siblingIndex: 3 },
    ]);
    expect(result).toBe('word/document.xml::/w:document[1]/w:body[1]/w:p[3]');
  });

  it('handles single-segment paths', () => {
    const result = formatXpathLikePath('word/document.xml', [
      { formattedName: 'w:document', siblingIndex: 1 },
    ]);
    expect(result).toBe('word/document.xml::/w:document[1]');
  });

  it('handles empty segments', () => {
    const result = formatXpathLikePath('word/document.xml', []);
    expect(result).toBe('word/document.xml::/');
  });
});

describe('formatPathSignature', () => {
  it('formats an unindexed path signature', () => {
    const result = formatPathSignature('word/document.xml', [
      'w:document', 'w:body', 'w:p',
    ]);
    expect(result).toBe('word/document.xml::/w:document/w:body/w:p');
  });
});

describe('stripIndicesToSignature', () => {
  it('strips all sibling indices from an xpath-like path', () => {
    const input = 'word/document.xml::/w:document[1]/w:body[1]/w:p[3]';
    const result = stripIndicesToSignature(input);
    expect(result).toBe('word/document.xml::/w:document/w:body/w:p');
  });

  it('handles paths without indices (no-op)', () => {
    const input = 'word/document.xml::/w:document/w:body/w:p';
    const result = stripIndicesToSignature(input);
    expect(result).toBe(input);
  });

  it('handles multi-digit indices', () => {
    const input = 'word/document.xml::/w:document[1]/w:body[1]/w:p[123]';
    const result = stripIndicesToSignature(input);
    expect(result).toBe('word/document.xml::/w:document/w:body/w:p');
  });
});
