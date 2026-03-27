import { describe, it, expect } from 'vitest';
import { buildUniverseFromCorpus } from '../../src/universe/api.js';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx, createDocxWithHeaderFooterComments } from '../helpers/create-test-docx.js';

describe('buildCorpusUniverse', () => {
  it('aggregates features across two documents', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc-a.docx');
    const r2 = await scanRawSurface(createDocxWithHeaderFooterComments(), 'doc-b.docx');

    const result = buildUniverseFromCorpus([r1, r2]);

    expect(result.corpusUniverse.schemaVersion).toBe(1);
    expect(result.corpusUniverse.includedDocuments).toBe(2);
    expect(result.corpusUniverse.excludedDocuments).toBe(0);

    // paragraph should appear in both docs
    const paraRow = result.corpusUniverse.features.find((f) => f.featureKey === 'paragraph');
    expect(paraRow).toBeDefined();
    expect(paraRow!.docCount).toBe(2);
    expect(paraRow!.occurrenceCount).toBeGreaterThan(1);
  });

  it('features are sorted by featureKey ascending', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc.docx');
    const result = buildUniverseFromCorpus([r1]);

    for (let i = 1; i < result.corpusUniverse.features.length; i++) {
      const prev = result.corpusUniverse.features[i - 1].featureKey;
      const curr = result.corpusUniverse.features[i].featureKey;
      expect(prev.localeCompare(curr)).toBeLessThan(0);
    }
  });

  it('tracks claimedRawFactCount correctly', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc.docx');
    const result = buildUniverseFromCorpus([r1]);

    // For absorbed features, claimedRawFactCount >= occurrenceCount
    for (const feature of result.corpusUniverse.features) {
      expect(feature.claimedRawFactCount).toBeGreaterThanOrEqual(feature.occurrenceCount);
    }
  });

  it('produces unmapped report', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc.docx');
    const result = buildUniverseFromCorpus([r1]);

    expect(result.unmappedRawSurface.schemaVersion).toBe(1);
    // There should be some unmapped facts (elements we don't match)
    expect(result.unmappedRawSurface.totalUnmapped).toBeGreaterThan(0);
    // And ignored facts from non-content-bearing parts
    expect(result.unmappedRawSurface.totalIgnoredByRule).toBeGreaterThan(0);
    expect(Object.keys(result.unmappedRawSurface.ignoredByRuleSummary).length).toBeGreaterThan(0);
  });

  it('produces universe manifest with document status', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc.docx');
    const result = buildUniverseFromCorpus([r1]);

    expect(result.universeManifest.schemaVersion).toBe(1);
    expect(result.universeManifest.registryVersion).toBe(1);
    expect(result.universeManifest.totalDocuments).toBe(1);
    expect(result.universeManifest.documentStatus).toHaveLength(1);
    expect(result.universeManifest.documentStatus[0].status).toBe('complete');
  });

  it('handles excluded documents in corpus with correct denominators', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'good.docx');
    const r2 = await scanRawSurface(createMinimalDocx(), 'bad.docx');

    // Simulate failed main-document
    const mutatedEntries = r2.packageIndex.entries.map((e) =>
      e.partKind === 'main-document' ? { ...e, parseStatus: 'failed' as const } : e,
    );
    const badResult = { ...r2, packageIndex: { ...r2.packageIndex, entries: mutatedEntries } };

    const result = buildUniverseFromCorpus([r1, badResult]);

    // Manifest should have correct counts
    expect(result.universeManifest.totalDocuments).toBe(2);
    expect(result.universeManifest.includedDocuments).toBe(1);
    expect(result.universeManifest.excludedDocuments).toBe(1);

    // Corpus universe should also have correct counts
    expect(result.corpusUniverse.totalDocuments).toBe(2);
    expect(result.corpusUniverse.includedDocuments).toBe(1);
    expect(result.corpusUniverse.excludedDocuments).toBe(1);

    const excludedDoc = result.documentUniverses.find((du) => du.docId === 'bad.docx');
    expect(excludedDoc!.status).toBe('excluded');
  });

  it('populates exampleOccurrenceIds in corpus feature rows', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc.docx');
    const result = buildUniverseFromCorpus([r1]);

    // Features with occurrences should have non-empty exampleOccurrenceIds
    for (const feature of result.corpusUniverse.features) {
      expect(feature.exampleOccurrenceIds.length).toBeGreaterThan(0);
      // Every example ID should start with "occ:"
      for (const id of feature.exampleOccurrenceIds) {
        expect(id).toMatch(/^occ:/);
      }
    }
  });
});
