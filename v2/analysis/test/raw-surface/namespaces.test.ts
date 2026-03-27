import { describe, it, expect } from 'vitest';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { resolveCanonicalPrefix, CANONICAL_NAMESPACE_PREFIXES } from '../../src/raw-surface/canonical-namespaces.js';
import { createMinimalDocx, createDocxWithNonStandardPrefix } from '../helpers/create-test-docx.js';

describe('namespace handling', () => {
  describe('canonical prefix table', () => {
    it('maps well-known OOXML URIs to conventional prefixes', () => {
      expect(resolveCanonicalPrefix('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'anything')).toBe(
        'w',
      );

      expect(resolveCanonicalPrefix('http://schemas.openxmlformats.org/markup-compatibility/2006', 'anything')).toBe(
        'mc',
      );

      expect(resolveCanonicalPrefix('http://schemas.microsoft.com/office/word/2010/wordml', 'anything')).toBe('w14');
    });

    it('falls back to literal prefix for unknown URIs', () => {
      expect(resolveCanonicalPrefix('http://example.com/unknown', 'custom')).toBe('custom');
    });

    it('returns undefined when both URI and prefix are missing', () => {
      expect(resolveCanonicalPrefix(undefined, undefined)).toBeUndefined();
    });

    it('contains no duplicate values in the canonical table', () => {
      const values = Array.from(CANONICAL_NAMESPACE_PREFIXES.values());
      const uniqueValues = new Set(values);
      // Allow 'a' to appear for multiple DrawingML URIs but nothing else
      const dupes = values.filter((v, i) => values.indexOf(v) !== i);
      for (const dupe of dupes) {
        expect(dupe).toBe('a'); // only 'a' is expected to be duplicated
      }
    });
  });

  describe('non-standard prefix canonicalization', () => {
    it('produces canonical w: signatures even with wordml: prefix in source', async () => {
      const bytes = createDocxWithNonStandardPrefix();
      const result = await scanRawSurface(bytes, 'nonstandard.docx');

      // The document uses wordml: prefix, but signatures should use canonical w:
      const bodyFact = result.facts.find((f) => f.factKind === 'element' && f.qname?.localName === 'body');
      expect(bodyFact).toBeDefined();
      expect(bodyFact!.pathSignature).toContain('w:body');
      expect(bodyFact!.pathSignature).not.toContain('wordml:');
    });

    it('produces identical signatures for standard and non-standard prefix docs', async () => {
      const standardBytes = createMinimalDocx();
      const nonStandardBytes = createDocxWithNonStandardPrefix();

      const standardResult = await scanRawSurface(standardBytes, 'standard.docx');
      const nonStandardResult = await scanRawSurface(nonStandardBytes, 'nonstandard.docx');

      // Both should have a w:document signature in word/document.xml
      const standardDocSig = standardResult.facts.find(
        (f) => f.partUri === 'word/document.xml' && f.qname?.localName === 'document',
      );
      const nonStandardDocSig = nonStandardResult.facts.find(
        (f) => f.partUri === 'word/document.xml' && f.qname?.localName === 'document',
      );

      expect(standardDocSig?.pathSignature).toBe(nonStandardDocSig?.pathSignature);
    });
  });
});
