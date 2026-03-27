import { describe, it, expect } from 'vitest';
import { FEATURE_REGISTRY, REGISTRY_VERSION, getRegistryMap } from '../../src/universe/feature-registry.js';
import type { RawSurfaceFact } from '../../src/raw-surface/types.js';

/** Build a minimal element fact with the given pathSignature. */
function elementFact(pathSignature: string): RawSurfaceFact {
  return {
    rawFactId: 'raw:0000000000000000',
    docId: 'test.docx',
    docFingerprint: 'abc123',
    partUri: 'word/document.xml',
    partKind: 'main-document',
    factKind: 'element',
    pathSignature,
    xpathLikePath: pathSignature.replace(/\//g, '[1]/').replace(/\[1\]\/$/, '[1]'),
    sourceRef: { partUri: 'word/document.xml', xpathLikePath: '' },
  };
}

describe('feature-registry', () => {
  it('has a positive registry version', () => {
    expect(REGISTRY_VERSION).toBeGreaterThan(0);
  });

  it('has 24 rules in the first slice', () => {
    expect(FEATURE_REGISTRY).toHaveLength(24);
  });

  it('has no duplicate feature keys', () => {
    const keys = FEATURE_REGISTRY.map((r) => r.featureKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every rule has a valid tier', () => {
    const validTiers = new Set(['structural', 'content', 'formatting', 'reference', 'annotation', 'resource']);
    for (const rule of FEATURE_REGISTRY) {
      expect(validTiers.has(rule.tier), `${rule.featureKey} has invalid tier "${rule.tier}"`).toBe(true);
    }
  });

  it('every rule has a valid claim mode', () => {
    const validModes = new Set(['exclusive', 'absorbed', 'shared']);
    for (const rule of FEATURE_REGISTRY) {
      expect(validModes.has(rule.claimMode), `${rule.featureKey} has invalid claimMode "${rule.claimMode}"`).toBe(true);
    }
  });

  it('matches w:p to paragraph', () => {
    const fact = elementFact('word/document.xml::/w:document/w:body/w:p');
    const rule = FEATURE_REGISTRY.find((r) => r.featureKey === 'paragraph')!;
    expect(rule.matchElement(fact)).toBe(true);
  });

  it('does not match w:pPr to paragraph', () => {
    const fact = elementFact('word/document.xml::/w:document/w:body/w:p/w:pPr');
    const rule = FEATURE_REGISTRY.find((r) => r.featureKey === 'paragraph')!;
    expect(rule.matchElement(fact)).toBe(false);
  });

  it('matches w:b to format.bold.direct', () => {
    const fact = elementFact('word/document.xml::/w:document/w:body/w:p/w:r/w:rPr/w:b');
    const rule = FEATURE_REGISTRY.find((r) => r.featureKey === 'format.bold.direct')!;
    expect(rule.matchElement(fact)).toBe(true);
  });

  it('does not match w:bookmarkStart to format.bold.direct', () => {
    const fact = elementFact('word/document.xml::/w:document/w:body/w:p/w:bookmarkStart');
    const rule = FEATURE_REGISTRY.find((r) => r.featureKey === 'format.bold.direct')!;
    expect(rule.matchElement(fact)).toBe(false);
  });

  it('matches wp:inline to drawing.inline', () => {
    const fact = elementFact('word/document.xml::/w:document/w:body/w:p/w:r/w:drawing/wp:inline');
    const rule = FEATURE_REGISTRY.find((r) => r.featureKey === 'drawing.inline')!;
    expect(rule.matchElement(fact)).toBe(true);
  });

  it('matches mc:AlternateContent to alternate-content', () => {
    const fact = elementFact('word/document.xml::/w:document/w:body/mc:AlternateContent');
    const rule = FEATURE_REGISTRY.find((r) => r.featureKey === 'alternate-content')!;
    expect(rule.matchElement(fact)).toBe(true);
  });

  it('getRegistryMap returns a map with all keys', () => {
    const map = getRegistryMap();
    expect(map.size).toBe(FEATURE_REGISTRY.length);
    expect(map.get('paragraph')?.tier).toBe('structural');
  });
});
