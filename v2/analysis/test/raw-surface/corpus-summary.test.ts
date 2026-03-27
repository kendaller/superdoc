import { describe, it, expect } from 'vitest';
import { scanRawSurfaceCorpus } from '../../src/raw-surface/index.js';
import { createMinimalDocx, createDocxWithHeaderFooterComments } from '../helpers/create-test-docx.js';

describe('corpus summary', () => {
  it('aggregates multiple documents into a corpus result', async () => {
    const result = await scanRawSurfaceCorpus([
      { bytes: createMinimalDocx(), docId: 'doc1.docx' },
      { bytes: createDocxWithHeaderFooterComments(), docId: 'doc2.docx' },
    ]);

    expect(result.documents).toHaveLength(2);
    expect(result.corpusSummary.totalDocuments).toBe(2);
    expect(result.corpusSummary.totalFacts).toBe(
      result.documents[0].summary.totalFacts + result.documents[1].summary.totalFacts,
    );
  });

  it('builds a signature matrix with document counts', async () => {
    const result = await scanRawSurfaceCorpus([
      { bytes: createMinimalDocx(), docId: 'doc1.docx' },
      { bytes: createMinimalDocx(), docId: 'doc2.docx' },
    ]);

    expect(result.signatureMatrix.length).toBeGreaterThan(0);

    // Both docs have the same content, so all signatures appear in 2 docs
    for (const entry of result.signatureMatrix) {
      expect(entry.documentCount).toBe(2);
      expect(entry.docIds).toContain('doc1.docx');
      expect(entry.docIds).toContain('doc2.docx');
    }
  });

  it('signature matrix is sorted by documentCount descending', async () => {
    const result = await scanRawSurfaceCorpus([
      { bytes: createMinimalDocx(), docId: 'doc1.docx' },
      { bytes: createDocxWithHeaderFooterComments(), docId: 'doc2.docx' },
    ]);

    for (let i = 1; i < result.signatureMatrix.length; i++) {
      expect(result.signatureMatrix[i - 1].documentCount).toBeGreaterThanOrEqual(
        result.signatureMatrix[i].documentCount,
      );
    }
  });

  it('collects examples per signature', async () => {
    const result = await scanRawSurfaceCorpus([
      { bytes: createMinimalDocx(), docId: 'doc1.docx' },
      { bytes: createMinimalDocx(), docId: 'doc2.docx' },
    ]);

    expect(result.examplesBySignature.length).toBeGreaterThan(0);

    for (const entry of result.examplesBySignature) {
      expect(entry.pathSignature).toBeTruthy();
      expect(entry.examples.length).toBeGreaterThan(0);
    }
  });

  it('respects maxExamplesPerSignature option', async () => {
    const result = await scanRawSurfaceCorpus(
      [
        { bytes: createMinimalDocx(), docId: 'doc1.docx' },
        { bytes: createMinimalDocx(), docId: 'doc2.docx' },
        { bytes: createMinimalDocx(), docId: 'doc3.docx' },
      ],
      { maxExamplesPerSignature: 2 },
    );

    for (const entry of result.examplesBySignature) {
      expect(entry.examples.length).toBeLessThanOrEqual(2);
    }
  });

  it('aggregates diagnostic counts', async () => {
    const result = await scanRawSurfaceCorpus([{ bytes: createMinimalDocx(), docId: 'doc1.docx' }]);

    // Minimal docx should have no diagnostics
    expect(result.corpusSummary.diagnosticCounts).toEqual({});
  });

  it('corpus summary keys are sorted', async () => {
    const result = await scanRawSurfaceCorpus([
      { bytes: createMinimalDocx(), docId: 'doc1.docx' },
      { bytes: createDocxWithHeaderFooterComments(), docId: 'doc2.docx' },
    ]);

    const sigKeys = Object.keys(result.corpusSummary.countsByPathSignature);
    expect(sigKeys).toEqual([...sigKeys].sort());
  });
});
