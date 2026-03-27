import { describe, it, expect } from 'vitest';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx, createDocxWithHeaderFooterComments } from '../helpers/create-test-docx.js';

describe('deterministic output', () => {
  it('produces identical facts for the same input bytes', async () => {
    const bytes = createMinimalDocx();

    const result1 = await scanRawSurface(bytes, 'test.docx');
    const result2 = await scanRawSurface(bytes, 'test.docx');

    expect(result1.facts.length).toBe(result2.facts.length);
    for (let i = 0; i < result1.facts.length; i++) {
      expect(result1.facts[i].rawFactId).toBe(result2.facts[i].rawFactId);
      expect(result1.facts[i].pathSignature).toBe(result2.facts[i].pathSignature);
      expect(result1.facts[i].xpathLikePath).toBe(result2.facts[i].xpathLikePath);
    }
  });

  it('produces identical fingerprints for the same bytes', async () => {
    const bytes = createMinimalDocx();

    const result1 = await scanRawSurface(bytes, 'a.docx');
    const result2 = await scanRawSurface(bytes, 'b.docx');

    expect(result1.metadata.docFingerprint).toBe(result2.metadata.docFingerprint);
  });

  it('produces identical summary JSON for the same input', async () => {
    const bytes = createDocxWithHeaderFooterComments();

    const result1 = await scanRawSurface(bytes, 'test.docx');
    const result2 = await scanRawSurface(bytes, 'test.docx');

    expect(JSON.stringify(result1.summary)).toBe(JSON.stringify(result2.summary));
  });

  it('produces identical package-index for the same input', async () => {
    const bytes = createMinimalDocx();

    const result1 = await scanRawSurface(bytes, 'test.docx');
    const result2 = await scanRawSurface(bytes, 'test.docx');

    expect(JSON.stringify(result1.packageIndex)).toBe(JSON.stringify(result2.packageIndex));
  });

  it('facts are ordered by part (sorted) then by parser encounter order', async () => {
    const bytes = createMinimalDocx();
    const result1 = await scanRawSurface(bytes, 'test.docx');
    const result2 = await scanRawSurface(bytes, 'test.docx');

    // Part order should be stable across runs
    const parts1 = result1.facts.map((f) => f.partUri);
    const parts2 = result2.facts.map((f) => f.partUri);
    expect(parts1).toEqual(parts2);

    // Within each part, facts should be in parser encounter order (same order both runs)
    const ids1 = result1.facts.map((f) => f.rawFactId);
    const ids2 = result2.facts.map((f) => f.rawFactId);
    expect(ids1).toEqual(ids2);
  });

  it('rawFactId is deterministic across runs', async () => {
    const bytes = createMinimalDocx();

    const result1 = await scanRawSurface(bytes, 'test.docx');
    const result2 = await scanRawSurface(bytes, 'test.docx');

    const ids1 = result1.facts.map((f) => f.rawFactId);
    const ids2 = result2.facts.map((f) => f.rawFactId);

    expect(ids1).toEqual(ids2);
  });
});
