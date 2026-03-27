import { describe, it, expect } from 'vitest';
import { buildDocumentUniverse } from '../../src/universe/build-document-universe.js';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx, createDocxWithHeaderFooterComments } from '../helpers/create-test-docx.js';

describe('buildDocumentUniverse', () => {
  it('produces a complete document universe from a minimal docx', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const du = buildDocumentUniverse(result);

    expect(du.schemaVersion).toBe(1);
    expect(du.docId).toBe('test.docx');
    expect(du.status).toBe('complete');
    expect(du.occurrences.length).toBeGreaterThan(0);
    expect(du.summary.totalOccurrences).toBe(du.occurrences.length);
  });

  it('finds paragraph, run, and bold features in minimal docx', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const du = buildDocumentUniverse(result);

    const featureKeys = new Set(du.occurrences.map((o) => o.featureKey));
    expect(featureKeys.has('paragraph')).toBe(true);
    expect(featureKeys.has('run')).toBe(true);
    expect(featureKeys.has('format.bold.direct')).toBe(true);
  });

  it('occurrences are sorted by featureKey then occurrenceId', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const du = buildDocumentUniverse(result);

    for (let i = 1; i < du.occurrences.length; i++) {
      const prev = du.occurrences[i - 1];
      const curr = du.occurrences[i];
      const cmp = prev.featureKey.localeCompare(curr.featureKey) || prev.occurrenceId.localeCompare(curr.occurrenceId);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });

  it('feature counts match occurrence counts', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const du = buildDocumentUniverse(result);

    const countFromOccs: Record<string, number> = {};
    for (const occ of du.occurrences) {
      countFromOccs[occ.featureKey] = (countFromOccs[occ.featureKey] ?? 0) + 1;
    }

    for (const [key, count] of Object.entries(du.summary.featureCounts)) {
      expect(countFromOccs[key]).toBe(count);
    }
  });

  it('finds features from headers, footers, and comments', async () => {
    const result = await scanRawSurface(createDocxWithHeaderFooterComments(), 'complex.docx');
    const du = buildDocumentUniverse(result);

    // Complex doc has comment references
    const featureKeys = new Set(du.occurrences.map((o) => o.featureKey));
    expect(featureKeys.has('paragraph')).toBe(true);
    // Should have more paragraphs than a minimal doc (headers/footers/comments)
    expect(du.summary.featureCounts['paragraph']).toBeGreaterThan(1);
  });

  it('excludes documents with failed main-document parse', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');

    // Simulate a failed main-document parse
    const mutatedEntries = result.packageIndex.entries.map((e) =>
      e.partKind === 'main-document' ? { ...e, parseStatus: 'failed' as const } : e,
    );
    const mutatedResult = {
      ...result,
      packageIndex: { ...result.packageIndex, entries: mutatedEntries },
    };

    const du = buildDocumentUniverse(mutatedResult);
    expect(du.status).toBe('excluded');
    expect(du.statusReason).toContain('main-document');
    expect(du.occurrences).toHaveLength(0);
  });

  it('marks documents with partial content-bearing parts', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');

    // Simulate a partial parse
    const mutatedEntries = result.packageIndex.entries.map((e) =>
      e.partKind === 'main-document' ? { ...e, parseStatus: 'partial' as const } : e,
    );
    const mutatedResult = {
      ...result,
      packageIndex: { ...result.packageIndex, entries: mutatedEntries },
    };

    const du = buildDocumentUniverse(mutatedResult);
    expect(du.status).toBe('partial');
    expect(du.statusReason).toContain('partial');
    // Partial docs still have occurrences
    expect(du.occurrences.length).toBeGreaterThan(0);
  });
});
