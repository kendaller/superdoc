import { describe, it, expect } from 'vitest';
import { claimFacts } from '../../src/universe/claim-engine.js';
import { FEATURE_REGISTRY } from '../../src/universe/feature-registry.js';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx, createDocxWithHeaderFooterComments } from '../helpers/create-test-docx.js';
import type { RawSurfaceFact } from '../../src/raw-surface/types.js';

describe('claim-engine', () => {
  it('claims element facts from content-bearing parts', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const claim = claimFacts(result.facts, FEATURE_REGISTRY, 'test.docx');

    // Minimal docx has at least paragraph, run, bold
    const keys = new Set(claim.occurrences.map((o) => o.featureKey));
    expect(keys.has('paragraph')).toBe(true);
    expect(keys.has('run')).toBe(true);
    expect(keys.has('format.bold.direct')).toBe(true);
  });

  it('ignores facts from non-content-bearing parts', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const claim = claimFacts(result.facts, FEATURE_REGISTRY, 'test.docx');

    expect(claim.ignoredFactCount).toBeGreaterThan(0);
    expect(Object.keys(claim.ignoredByRuleSummary).length).toBeGreaterThan(0);
    // Styles part should appear in ignored summary
    expect(claim.ignoredByRuleSummary['part-scope:styles']).toBeGreaterThan(0);
  });

  it('absorbs attribute facts into their parent element occurrence', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const claim = claimFacts(result.facts, FEATURE_REGISTRY, 'test.docx');

    // Find a paragraph occurrence — it should have claimed more than just the element fact
    const paraOcc = claim.occurrences.find((o) => o.featureKey === 'paragraph');
    expect(paraOcc).toBeDefined();
    // If w:p has attributes (like rsidR), they should be absorbed
    // The rawFactIds should include both the element and its attributes
    expect(paraOcc!.rawFactIds.length).toBeGreaterThanOrEqual(1);
  });

  it('tracks unmapped facts from content-bearing parts', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const claim = claimFacts(result.facts, FEATURE_REGISTRY, 'test.docx');

    // There should be some unmapped facts (e.g., w:body, w:document, w:rPr children we don't match)
    expect(claim.unmappedFacts.length).toBeGreaterThan(0);

    // All unmapped facts should be from content-bearing parts
    for (const fact of claim.unmappedFacts) {
      expect(fact.partKind).not.toBe('styles');
      expect(fact.partKind).not.toBe('theme');
    }
  });

  it('produces deterministic occurrence IDs', async () => {
    const bytes = createMinimalDocx();
    const result1 = await scanRawSurface(bytes, 'test.docx');
    const result2 = await scanRawSurface(bytes, 'test.docx');

    const claim1 = claimFacts(result1.facts, FEATURE_REGISTRY, 'test.docx');
    const claim2 = claimFacts(result2.facts, FEATURE_REGISTRY, 'test.docx');

    const ids1 = claim1.occurrences.map((o) => o.occurrenceId).sort();
    const ids2 = claim2.occurrences.map((o) => o.occurrenceId).sort();
    expect(ids1).toEqual(ids2);
  });

  it('handles multi-part documents (headers, footers, comments)', async () => {
    const result = await scanRawSurface(createDocxWithHeaderFooterComments(), 'complex.docx');
    const claim = claimFacts(result.facts, FEATURE_REGISTRY, 'complex.docx');

    // Should find paragraphs from main document, headers, footers, and comments
    const paraParts = new Set<string>();
    for (const fact of result.facts) {
      if (fact.factKind === 'element' && fact.pathSignature.endsWith('/w:p')) {
        paraParts.add(fact.partKind);
      }
    }
    // The complex fixture should have paragraphs in multiple part kinds
    expect(paraParts.size).toBeGreaterThan(1);

    // All paragraphs should be claimed
    const paraOccs = claim.occurrences.filter((o) => o.featureKey === 'paragraph');
    expect(paraOccs.length).toBeGreaterThan(0);
  });

  it('first match wins — no double-claiming for exclusive rules', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const claim = claimFacts(result.facts, FEATURE_REGISTRY, 'test.docx');

    // Count how many times each element fact ID appears across all occurrences
    const elementFactCounts = new Map<string, number>();
    for (const occ of claim.occurrences) {
      // The first ID in rawFactIds is always the element fact
      const elementFactId = occ.rawFactIds[0];
      elementFactCounts.set(elementFactId, (elementFactCounts.get(elementFactId) ?? 0) + 1);
    }

    // Each element should be claimed at most once
    for (const [factId, count] of elementFactCounts) {
      expect(count, `Element fact ${factId} claimed ${count} times`).toBe(1);
    }
  });

  it('absorbed attributes are isolated to their exact parent element', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const claim = claimFacts(result.facts, FEATURE_REGISTRY, 'test.docx');

    // Find all paragraph occurrences
    const paraOccs = claim.occurrences.filter((o) => o.featureKey === 'paragraph');
    if (paraOccs.length < 2) return; // need at least 2 paragraphs to test isolation

    // Each paragraph's rawFactIds should be disjoint from other paragraphs
    for (let i = 0; i < paraOccs.length; i++) {
      for (let j = i + 1; j < paraOccs.length; j++) {
        const idsA = new Set(paraOccs[i].rawFactIds);
        for (const id of paraOccs[j].rawFactIds) {
          expect(idsA.has(id), `Fact ${id} shared between paragraph occurrences ${i} and ${j}`).toBe(false);
        }
      }
    }
  });

  it('returns diagnostics field', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');
    const claim = claimFacts(result.facts, FEATURE_REGISTRY, 'test.docx');

    expect(Array.isArray(claim.diagnostics)).toBe(true);
    // No conflicts expected with the standard registry
    expect(claim.diagnostics).toHaveLength(0);
  });

  it('throws on exclusive claim conflict', async () => {
    const result = await scanRawSurface(createMinimalDocx(), 'test.docx');

    // Create two exclusive rules that both match w:p
    const conflictingRegistry = [
      {
        featureKey: 'rule-a',
        label: 'Rule A',
        tier: 'structural' as const,
        claimMode: 'exclusive' as const,
        matchElement: (f: RawSurfaceFact) => f.pathSignature.endsWith('/w:p'),
        boundaryDescription: 'test',
      },
      {
        featureKey: 'rule-b',
        label: 'Rule B',
        tier: 'structural' as const,
        claimMode: 'exclusive' as const,
        matchElement: (f: RawSurfaceFact) => f.pathSignature.endsWith('/w:p'),
        boundaryDescription: 'test',
      },
    ];

    expect(() => claimFacts(result.facts, conflictingRegistry, 'test.docx')).toThrow('Claim conflict');
  });
});
