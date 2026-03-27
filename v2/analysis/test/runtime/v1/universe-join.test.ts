import { describe, it, expect } from 'vitest';
import { joinUniverseProvenance } from '../../../src/runtime/v1/universe-join.js';
import type { V1SourceAnchor } from '../../../src/runtime/v1/types.js';
import type { DocumentUniverse } from '../../../src/universe/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnchor(overrides: Partial<V1SourceAnchor> = {}): V1SourceAnchor {
  return {
    anchorId: 'a:test',
    partUri: 'word/document.xml',
    xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
    pathSignature: 'word/document.xml::/w:document/w:body/w:p',
    storyKind: 'main',
    ...overrides,
  };
}

function makeUniverse(occurrences: DocumentUniverse['occurrences']): DocumentUniverse {
  return {
    schemaVersion: 1,
    docId: 'test-doc',
    docFingerprint: 'abc',
    status: 'complete',
    occurrences,
    summary: {
      totalOccurrences: occurrences.length,
      totalClaimedRawFacts: 0,
      featureCounts: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('joinUniverseProvenance', () => {
  it('matches an anchor to a universe occurrence by xpathLikePath', () => {
    const xpath = 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]';
    const anchor = makeAnchor({ anchorId: 'a:1', xpathLikePath: xpath });
    const universe = makeUniverse([
      {
        occurrenceId: 'occ:1',
        docId: 'test-doc',
        featureKey: 'paragraph',
        tier: 'structural',
        rawFactIds: ['raw:1'],
        sourceRefs: [{ partUri: 'word/document.xml', xpathLikePath: xpath }],
      },
    ]);

    const result = joinUniverseProvenance([anchor], universe);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].anchor.anchorId).toBe('a:1');
    expect(result.matched[0].occurrence.occurrenceId).toBe('occ:1');
    expect(result.provenanceOnly).toHaveLength(0);
    expect(result.universeOnly).toHaveLength(0);
  });

  it('reports anchors with no universe match as provenanceOnly', () => {
    const anchor = makeAnchor({
      anchorId: 'a:1',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[99]',
    });
    const universe = makeUniverse([]);

    const result = joinUniverseProvenance([anchor], universe);

    expect(result.matched).toHaveLength(0);
    expect(result.provenanceOnly).toHaveLength(1);
    expect(result.provenanceOnly[0].anchorId).toBe('a:1');
  });

  it('reports occurrences with no matching anchor as universeOnly', () => {
    const universe = makeUniverse([
      {
        occurrenceId: 'occ:1',
        docId: 'test-doc',
        featureKey: 'paragraph',
        tier: 'structural',
        rawFactIds: ['raw:1'],
        sourceRefs: [{ partUri: 'word/document.xml', xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]' }],
      },
    ]);

    const result = joinUniverseProvenance([], universe);

    expect(result.matched).toHaveLength(0);
    expect(result.universeOnly).toHaveLength(1);
    expect(result.universeOnly[0].occurrenceId).toBe('occ:1');
  });

  it('handles many-to-one: multiple occurrences from the same xpath', () => {
    const xpath = 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]';
    const anchor = makeAnchor({ anchorId: 'a:1', xpathLikePath: xpath });
    const universe = makeUniverse([
      {
        occurrenceId: 'occ:1',
        docId: 'test-doc',
        featureKey: 'paragraph',
        tier: 'structural',
        rawFactIds: ['raw:1'],
        sourceRefs: [{ partUri: 'word/document.xml', xpathLikePath: xpath }],
      },
      {
        occurrenceId: 'occ:2',
        docId: 'test-doc',
        featureKey: 'style-reference.paragraph',
        tier: 'reference',
        rawFactIds: ['raw:2'],
        sourceRefs: [{ partUri: 'word/document.xml', xpathLikePath: xpath }],
      },
    ]);

    const result = joinUniverseProvenance([anchor], universe);

    // Both occurrences should match the same anchor
    expect(result.matched).toHaveLength(2);
    expect(result.provenanceOnly).toHaveLength(0);
    expect(result.universeOnly).toHaveLength(0);
  });
});
