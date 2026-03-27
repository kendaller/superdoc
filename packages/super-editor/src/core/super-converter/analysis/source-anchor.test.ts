import { describe, it, expect } from 'vitest';
import { buildAnchorId, toPathSignature } from './source-anchor.js';

describe('buildAnchorId', () => {
  it('returns an a:-prefixed hex ID', () => {
    const id = buildAnchorId('word/document.xml', 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]');
    expect(id).toMatch(/^a:[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    const a = buildAnchorId('word/document.xml', 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]');
    const b = buildAnchorId('word/document.xml', 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]');
    expect(a).toBe(b);
  });

  it('produces different IDs for different paths', () => {
    const a = buildAnchorId('word/document.xml', 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]');
    const b = buildAnchorId('word/document.xml', 'word/document.xml::/w:document[1]/w:body[1]/w:p[2]');
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different parts', () => {
    const a = buildAnchorId('word/document.xml', 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]');
    const b = buildAnchorId('word/header1.xml', 'word/header1.xml::/w:hdr[1]/w:p[1]');
    expect(a).not.toBe(b);
  });
});

describe('toPathSignature', () => {
  it('strips all sibling indices', () => {
    const result = toPathSignature('word/document.xml::/w:document[1]/w:body[1]/w:p[3]');
    expect(result).toBe('word/document.xml::/w:document/w:body/w:p');
  });

  it('handles multi-digit indices', () => {
    const result = toPathSignature('word/document.xml::/w:document[1]/w:body[1]/w:p[123]');
    expect(result).toBe('word/document.xml::/w:document/w:body/w:p');
  });

  it('is a no-op for paths without indices', () => {
    const input = 'word/document.xml::/w:document/w:body/w:p';
    expect(toPathSignature(input)).toBe(input);
  });
});
