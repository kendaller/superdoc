import { describe, it, expect } from 'vitest';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx, createDocxWithHeaderFooterComments } from '../helpers/create-test-docx.js';

describe('relationship extraction', () => {
  it('extracts root-level relationships', async () => {
    const bytes = createMinimalDocx();
    const result = await scanRawSurface(bytes, 'test.docx');
    const { relationships } = result.packageIndex;

    const rootRel = relationships.find((r) => r.sourcePartUri === '/');
    expect(rootRel).toBeDefined();
    expect(rootRel!.target).toBe('word/document.xml');
    expect(rootRel!.type).toContain('officeDocument');
  });

  it('extracts word-level relationships', async () => {
    const bytes = createMinimalDocx();
    const result = await scanRawSurface(bytes, 'test.docx');
    const { relationships } = result.packageIndex;

    const stylesRel = relationships.find((r) => r.target === 'styles.xml');
    expect(stylesRel).toBeDefined();
    expect(stylesRel!.type).toContain('styles');
    expect(stylesRel!.sourcePartUri).toBe('word/document.xml');
  });

  it('counts relationship types in summary', async () => {
    const bytes = createDocxWithHeaderFooterComments();
    const result = await scanRawSurface(bytes, 'test.docx');
    const { countsByRelationshipType } = result.summary;

    expect(Object.keys(countsByRelationshipType).length).toBeGreaterThan(0);

    // Should include header, footer, comments, image relationship types
    const types = Object.keys(countsByRelationshipType);
    expect(types.some((t) => t.includes('header'))).toBe(true);
    expect(types.some((t) => t.includes('footer'))).toBe(true);
    expect(types.some((t) => t.includes('comments'))).toBe(true);
    expect(types.some((t) => t.includes('image'))).toBe(true);
  });

  it('includes relationship part URI and ID', async () => {
    const bytes = createMinimalDocx();
    const result = await scanRawSurface(bytes, 'test.docx');
    const { relationships } = result.packageIndex;

    for (const rel of relationships) {
      expect(rel.id).toBeTruthy();
      expect(rel.type).toBeTruthy();
      expect(rel.target).toBeTruthy();
      expect(rel.relationshipPartUri).toMatch(/\.rels$/);
    }
  });
});
