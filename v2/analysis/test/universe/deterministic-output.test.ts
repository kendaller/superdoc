import { describe, it, expect } from 'vitest';
import { buildUniverseFromCorpus } from '../../src/universe/api.js';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx } from '../helpers/create-test-docx.js';

const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

describe('deterministic universe output', () => {
  it('same input produces byte-identical DocumentUniverse JSON', async () => {
    const bytes = createMinimalDocx();
    const r1 = await scanRawSurface(bytes, 'test.docx');
    const r2 = await scanRawSurface(bytes, 'test.docx');

    const u1 = buildUniverseFromCorpus([r1], { buildTimestamp: FIXED_TIMESTAMP });
    const u2 = buildUniverseFromCorpus([r2], { buildTimestamp: FIXED_TIMESTAMP });

    expect(JSON.stringify(u1.documentUniverses)).toBe(JSON.stringify(u2.documentUniverses));
  });

  it('same input produces byte-identical CorpusUniverse JSON', async () => {
    const bytes = createMinimalDocx();
    const r1 = await scanRawSurface(bytes, 'test.docx');
    const r2 = await scanRawSurface(bytes, 'test.docx');

    const u1 = buildUniverseFromCorpus([r1], { buildTimestamp: FIXED_TIMESTAMP });
    const u2 = buildUniverseFromCorpus([r2], { buildTimestamp: FIXED_TIMESTAMP });

    expect(JSON.stringify(u1.corpusUniverse)).toBe(JSON.stringify(u2.corpusUniverse));
  });

  it('same input produces byte-identical FeatureExamples JSON', async () => {
    const bytes = createMinimalDocx();
    const r1 = await scanRawSurface(bytes, 'test.docx');
    const r2 = await scanRawSurface(bytes, 'test.docx');

    const u1 = buildUniverseFromCorpus([r1], { buildTimestamp: FIXED_TIMESTAMP });
    const u2 = buildUniverseFromCorpus([r2], { buildTimestamp: FIXED_TIMESTAMP });

    expect(JSON.stringify(u1.featureExamples)).toBe(JSON.stringify(u2.featureExamples));
  });

  it('same input produces byte-identical UnmappedRawSurface JSON', async () => {
    const bytes = createMinimalDocx();
    const r1 = await scanRawSurface(bytes, 'test.docx');
    const r2 = await scanRawSurface(bytes, 'test.docx');

    const u1 = buildUniverseFromCorpus([r1], { buildTimestamp: FIXED_TIMESTAMP });
    const u2 = buildUniverseFromCorpus([r2], { buildTimestamp: FIXED_TIMESTAMP });

    expect(JSON.stringify(u1.unmappedRawSurface)).toBe(JSON.stringify(u2.unmappedRawSurface));
  });

  it('same input produces byte-identical UniverseManifest JSON', async () => {
    const bytes = createMinimalDocx();
    const r1 = await scanRawSurface(bytes, 'test.docx');
    const r2 = await scanRawSurface(bytes, 'test.docx');

    const u1 = buildUniverseFromCorpus([r1], { buildTimestamp: FIXED_TIMESTAMP });
    const u2 = buildUniverseFromCorpus([r2], { buildTimestamp: FIXED_TIMESTAMP });

    expect(JSON.stringify(u1.universeManifest)).toBe(JSON.stringify(u2.universeManifest));
  });
});
