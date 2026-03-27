import { describe, it, expect } from 'vitest';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import {
  createMinimalDocx,
  createDocxWithHeaderFooterComments,
  createUtf16MainDocumentDocx,
} from '../helpers/create-test-docx.js';

describe('single-document scan', () => {
  it('scans a minimal docx and returns facts', async () => {
    const bytes = createMinimalDocx();
    const result = await scanRawSurface(bytes, 'minimal.docx');

    expect(result.metadata.docId).toBe('minimal.docx');
    expect(result.metadata.docFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.summary.totalFacts).toBe(result.facts.length);
  });

  it('includes element and attribute facts', async () => {
    const bytes = createMinimalDocx();
    const result = await scanRawSurface(bytes, 'minimal.docx');

    const elementFacts = result.facts.filter((f) => f.factKind === 'element');
    const attributeFacts = result.facts.filter((f) => f.factKind === 'attribute');

    expect(elementFacts.length).toBeGreaterThan(0);
    expect(attributeFacts.length).toBeGreaterThan(0);
  });

  it('finds w:b element in bold text', async () => {
    const bytes = createMinimalDocx();
    const result = await scanRawSurface(bytes, 'test.docx');

    const boldFact = result.facts.find(
      (f) =>
        f.factKind === 'element' &&
        f.qname?.localName === 'b' &&
        f.qname?.namespaceUri === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    );
    expect(boldFact).toBeDefined();
    expect(boldFact!.pathSignature).toBe('word/document.xml::/w:document/w:body/w:p/w:r/w:rPr/w:b');
  });

  it('classifies parts correctly in package index', async () => {
    const bytes = createDocxWithHeaderFooterComments();
    const result = await scanRawSurface(bytes, 'complex.docx');
    const { entries } = result.packageIndex;

    const mainDoc = entries.find((e) => e.path === 'word/document.xml');
    expect(mainDoc?.partKind).toBe('main-document');

    const header = entries.find((e) => e.path === 'word/header1.xml');
    expect(header?.partKind).toBe('header');

    const footer = entries.find((e) => e.path === 'word/footer1.xml');
    expect(footer?.partKind).toBe('footer');

    const comments = entries.find((e) => e.path === 'word/comments.xml');
    expect(comments?.partKind).toBe('comments');

    const image = entries.find((e) => e.path === 'word/media/image1.png');
    expect(image?.entryKind).toBe('binary');
    expect(image?.parseStatus).toBe('skipped');
  });

  it('extracts relationships into package index', async () => {
    const bytes = createDocxWithHeaderFooterComments();
    const result = await scanRawSurface(bytes, 'complex.docx');
    const { relationships } = result.packageIndex;

    expect(relationships.length).toBeGreaterThan(0);

    const headerRel = relationships.find((r) => r.target === 'header1.xml');
    expect(headerRel).toBeDefined();
    expect(headerRel!.type).toContain('header');

    const imageRel = relationships.find((r) => r.target === 'media/image1.png');
    expect(imageRel).toBeDefined();
    expect(imageRel!.type).toContain('image');
  });

  it('scans all parts including headers, footers, and comments', async () => {
    const bytes = createDocxWithHeaderFooterComments();
    const result = await scanRawSurface(bytes, 'complex.docx');

    const partKinds = new Set(result.facts.map((f) => f.partKind));
    expect(partKinds.has('main-document')).toBe(true);
    expect(partKinds.has('header')).toBe(true);
    expect(partKinds.has('footer')).toBe(true);
    expect(partKinds.has('comments')).toBe(true);
  });

  it('produces a valid summary with sorted keys', async () => {
    const bytes = createMinimalDocx();
    const result = await scanRawSurface(bytes, 'test.docx');
    const { summary } = result;

    expect(summary.totalFacts).toBeGreaterThan(0);
    expect(Object.keys(summary.countsByPartKind).length).toBeGreaterThan(0);
    expect(Object.keys(summary.countsByFactKind).length).toBeGreaterThan(0);

    // Keys should be sorted
    const sigKeys = Object.keys(summary.countsByPathSignature);
    expect(sigKeys).toEqual([...sigKeys].sort());
  });

  it('includes topSignatures sorted by count descending', async () => {
    const bytes = createMinimalDocx();
    const result = await scanRawSurface(bytes, 'test.docx');
    const { topSignatures } = result.summary;

    expect(topSignatures.length).toBeGreaterThan(0);
    for (let i = 1; i < topSignatures.length; i++) {
      expect(topSignatures[i - 1].count).toBeGreaterThanOrEqual(topSignatures[i].count);
    }
  });

  it('scans UTF-16 XML parts instead of misclassifying them as not-xml', async () => {
    const bytes = createUtf16MainDocumentDocx();
    const result = await scanRawSurface(bytes, 'utf16.docx');

    const notXmlDiags = result.summary.scanDiagnostics.filter((d) => d.code === 'not-xml');
    expect(notXmlDiags).toHaveLength(0);

    const mainDocumentFacts = result.facts.filter((f) => f.partUri === 'word/document.xml');
    expect(mainDocumentFacts.length).toBeGreaterThan(0);

    const documentEntry = result.packageIndex.entries.find((e) => e.path === 'word/document.xml');
    expect(documentEntry?.parseStatus).toBe('success');
  });
});
