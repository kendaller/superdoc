import { describe, it, expect } from 'vitest';
import { buildOccurrenceId } from '../../src/universe/occurrence-id.js';

describe('buildOccurrenceId', () => {
  it('returns an "occ:" prefixed 16-char hex string', () => {
    const id = buildOccurrenceId('doc.docx', 'format.bold.direct', 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]/w:r[1]/w:rPr[1]/w:b[1]');
    expect(id).toMatch(/^occ:[0-9a-f]{16}$/);
  });

  it('is deterministic — same inputs produce same output', () => {
    const args = ['doc.docx', 'paragraph', 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]'] as const;
    expect(buildOccurrenceId(...args)).toBe(buildOccurrenceId(...args));
  });

  it('produces different IDs for different docIds', () => {
    const path = 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]';
    const a = buildOccurrenceId('a.docx', 'paragraph', path);
    const b = buildOccurrenceId('b.docx', 'paragraph', path);
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different feature keys', () => {
    const path = 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]';
    const a = buildOccurrenceId('doc.docx', 'paragraph', path);
    const b = buildOccurrenceId('doc.docx', 'run', path);
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different anchor paths', () => {
    const a = buildOccurrenceId('doc.docx', 'paragraph', 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]');
    const b = buildOccurrenceId('doc.docx', 'paragraph', 'word/document.xml::/w:document[1]/w:body[1]/w:p[2]');
    expect(a).not.toBe(b);
  });
});
