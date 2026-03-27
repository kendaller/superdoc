import { describe, it, expect } from 'vitest';
import { checkHonestyInvariant } from '../../src/universe/honesty-check.js';
import { buildDocumentUniverse } from '../../src/universe/build-document-universe.js';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx, createDocxWithHeaderFooterComments } from '../helpers/create-test-docx.js';

describe('honesty invariant', () => {
  it('passes for checkHonestyInvariant when counts add up', () => {
    const result = checkHonestyInvariant(100, 30, 50, 20);
    expect(result.passed).toBe(true);
  });

  it('fails when counts do not add up', () => {
    const result = checkHonestyInvariant(100, 30, 50, 10); // 30+10+50 = 90 ≠ 100
    expect(result.passed).toBe(false);
    expect(result.details).toContain('mismatch');
  });

  it('holds for minimal docx end-to-end', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    // If honesty invariant fails, buildDocumentUniverse throws
    const du = buildDocumentUniverse(result);
    expect(du.status).toBe('complete');
  });

  it('holds for complex docx end-to-end', async () => {
    const result = await scanRawSurface(createDocxWithHeaderFooterComments(), 'complex.docx');
    const du = buildDocumentUniverse(result);
    expect(du.status).toBe('complete');
  });
});
