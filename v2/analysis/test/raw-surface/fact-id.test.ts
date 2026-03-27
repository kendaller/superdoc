import { describe, it, expect } from 'vitest';
import { buildRawFactId } from '../../src/raw-surface/fact-id.js';

describe('buildRawFactId', () => {
  it('returns a deterministic ID for the same inputs', () => {
    const id1 = buildRawFactId('doc.docx', 'word/document.xml', 'element', 'word/document.xml::/w:document[1]');
    const id2 = buildRawFactId('doc.docx', 'word/document.xml', 'element', 'word/document.xml::/w:document[1]');
    expect(id1).toBe(id2);
  });

  it('returns different IDs for different inputs', () => {
    const id1 = buildRawFactId('doc.docx', 'word/document.xml', 'element', 'word/document.xml::/w:document[1]');
    const id2 = buildRawFactId(
      'doc.docx',
      'word/document.xml',
      'attribute',
      'word/document.xml::/w:document[1]/@xmlns:w',
    );
    expect(id1).not.toBe(id2);
  });

  it("starts with the 'raw:' prefix", () => {
    const id = buildRawFactId('doc.docx', 'word/document.xml', 'element', 'word/document.xml::/w:document[1]');
    expect(id).toMatch(/^raw:[0-9a-f]{16}$/);
  });

  it('differs when only docId changes', () => {
    const id1 = buildRawFactId('a.docx', 'word/document.xml', 'element', 'path');
    const id2 = buildRawFactId('b.docx', 'word/document.xml', 'element', 'path');
    expect(id1).not.toBe(id2);
  });

  it('differs when only partUri changes', () => {
    const id1 = buildRawFactId('doc.docx', 'word/document.xml', 'element', 'path');
    const id2 = buildRawFactId('doc.docx', 'word/styles.xml', 'element', 'path');
    expect(id1).not.toBe(id2);
  });
});
