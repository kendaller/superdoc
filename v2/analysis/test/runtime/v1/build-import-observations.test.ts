import { describe, it, expect } from 'vitest';
import { buildImportObservations } from '../../../src/runtime/v1/build-import-observations.js';
import type { V1ResolvedProvenance, V1ResolvedBinding, V1SourceAnchor } from '../../../src/runtime/v1/types.js';
import type { DocumentUniverse } from '../../../src/universe/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvenance(
  anchors: V1SourceAnchor[],
  bindings: V1ResolvedBinding[] = [],
): V1ResolvedProvenance {
  return {
    schemaVersion: 1,
    docId: 'test-doc',
    snapshotRevision: 'imported',
    stories: [{ storyRef: { storyKind: 'main', storyKey: 'main' }, partUri: 'word/document.xml', positionMapAvailable: true }],
    sourceAnchors: anchors,
    bindings,
    diagnostics: [],
    stats: {
      totalAnchors: anchors.length,
      totalBindings: bindings.length,
      occurrenceLevelBindings: bindings.filter((b) => b.traceability === 'occurrence').length,
      featureLevelBindings: bindings.filter((b) => b.traceability === 'feature').length,
    },
  };
}

function makeUniverse(occurrences: DocumentUniverse['occurrences']): DocumentUniverse {
  return {
    schemaVersion: 1,
    docId: 'test-doc',
    docFingerprint: 'abc',
    status: 'complete',
    occurrences,
    summary: { totalOccurrences: occurrences.length, totalClaimedRawFacts: 0, featureCounts: {} },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildImportObservations', () => {
  it('produces observations from matched anchors', () => {
    const xpath = 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]';
    const anchor: V1SourceAnchor = {
      anchorId: 'a:1',
      partUri: 'word/document.xml',
      xpathLikePath: xpath,
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    };
    const binding: V1ResolvedBinding = {
      bindingId: 'b:0',
      anchorIds: ['a:1'],
      storyRef: { storyKind: 'main', storyKey: 'main' },
      bindingKind: 'pm-node',
      featureKey: 'paragraph',
      nodeType: 'paragraph',
      traceability: 'occurrence',
      status: 'clean',
    };
    const provenance = makeProvenance([anchor], [binding]);
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

    const result = buildImportObservations({ provenance, universe, docId: 'test-doc' });

    expect(result.observations).toHaveLength(1);
    const obs = result.observations[0];
    expect(obs.featureKey).toBe('paragraph');
    expect(obs.stage).toBe('import');
    expect(obs.runtime).toBe('v1');
    expect(obs.traceabilityLevel).toBe('occurrence');
    expect(obs.universeLinks?.linkMode).toBe('exact');
    expect(obs.universeLinks?.occurrenceIds).toContain('occ:1');
  });

  it('emits one exact observation per matched occurrence', () => {
    const xpaths = [
      'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
      'word/document.xml::/w:document[1]/w:body[1]/w:p[2]',
    ];
    const anchors = xpaths.map((xpath, i) => ({
      anchorId: `a:${i}`,
      partUri: 'word/document.xml',
      xpathLikePath: xpath,
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main' as const,
    }));
    const bindings: V1ResolvedBinding[] = anchors.map((anchor, i) => ({
      bindingId: `b:${i}`,
      anchorIds: [anchor.anchorId],
      storyRef: { storyKind: 'main', storyKey: 'main' },
      bindingKind: 'pm-node',
      featureKey: 'paragraph',
      nodeType: 'paragraph',
      traceability: 'occurrence',
      status: 'clean',
    }));
    const provenance = makeProvenance(anchors, bindings);
    const universe = makeUniverse(
      xpaths.map((xpath, i) => ({
        occurrenceId: `occ:${i}`,
        docId: 'test-doc',
        featureKey: 'paragraph',
        tier: 'structural' as const,
        rawFactIds: [`raw:${i}`],
        sourceRefs: [{ partUri: 'word/document.xml', xpathLikePath: xpath }],
      })),
    );

    const result = buildImportObservations({ provenance, universe, docId: 'test-doc' });

    expect(result.observations).toHaveLength(2);
    expect(result.observations.every((observation) => observation.featureKey === 'paragraph')).toBe(true);
    expect(result.observations.map((observation) => observation.universeLinks?.occurrenceIds?.[0])).toEqual([
      'occ:0',
      'occ:1',
    ]);
  });

  it('sorts observations by featureKey', () => {
    const entries = [
      { xpath: 'word/document.xml::/w:document[1]/w:body[1]/w:tbl[1]', feature: 'table' },
      { xpath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]', feature: 'paragraph' },
    ];
    const anchors = entries.map((e, i) => ({
      anchorId: `a:${i}`,
      partUri: 'word/document.xml',
      xpathLikePath: e.xpath,
      pathSignature: e.xpath.replace(/\[\d+\]/g, ''),
      storyKind: 'main' as const,
    }));
    const bindings: V1ResolvedBinding[] = entries.map((entry, i) => ({
      bindingId: `b:${i}`,
      anchorIds: [`a:${i}`],
      storyRef: { storyKind: 'main', storyKey: 'main' },
      bindingKind: 'pm-node',
      featureKey: entry.feature,
      nodeType: entry.feature === 'table' ? 'table' : 'paragraph',
      traceability: 'occurrence',
      status: 'clean',
    }));
    const provenance = makeProvenance(anchors, bindings);
    const universe = makeUniverse(
      entries.map((e, i) => ({
        occurrenceId: `occ:${i}`,
        docId: 'test-doc',
        featureKey: e.feature,
        tier: 'structural' as const,
        rawFactIds: [`raw:${i}`],
        sourceRefs: [{ partUri: 'word/document.xml', xpathLikePath: e.xpath }],
      })),
    );

    const result = buildImportObservations({ provenance, universe, docId: 'test-doc' });

    expect(result.observations.map((o) => o.featureKey)).toEqual(['paragraph', 'table']);
  });

  it('produces feature-level observations for mark bindings', () => {
    const xpath = 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]/w:r[1]/w:rPr[1]/w:b[1]';
    const anchor: V1SourceAnchor = {
      anchorId: 'a:bold',
      partUri: 'word/document.xml',
      xpathLikePath: xpath,
      pathSignature: 'word/document.xml::/w:document/w:body/w:p/w:r/w:rPr/w:b',
      storyKind: 'main',
    };
    const binding: V1ResolvedBinding = {
      bindingId: 'b:bold',
      anchorIds: ['a:bold'],
      storyRef: { storyKind: 'main', storyKey: 'main' },
      bindingKind: 'feature-anchor',
      featureKey: 'format.bold.direct',
      traceability: 'feature', // marks are feature-level
      status: 'clean',
    };
    const provenance = makeProvenance([anchor], [binding]);
    const universe = makeUniverse([
      {
        occurrenceId: 'occ:bold',
        docId: 'test-doc',
        featureKey: 'format.bold.direct',
        tier: 'formatting',
        rawFactIds: ['raw:bold'],
        sourceRefs: [{ partUri: 'word/document.xml', xpathLikePath: xpath }],
      },
    ]);

    const result = buildImportObservations({ provenance, universe, docId: 'test-doc' });

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].featureKey).toBe('format.bold.direct');
    expect(result.observations[0].traceabilityLevel).toBe('feature');
    expect(result.observations[0].universeLinks?.linkMode).toBe('feature-only');
  });

  it('does not emit observations for matched anchors without runtime bindings', () => {
    const xpath = 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]';
    const anchor: V1SourceAnchor = {
      anchorId: 'a:1',
      partUri: 'word/document.xml',
      xpathLikePath: xpath,
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    };
    const provenance = makeProvenance([anchor], []);
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

    const result = buildImportObservations({ provenance, universe, docId: 'test-doc' });
    expect(result.observations).toHaveLength(0);
  });

  it('matches occurrences by partUri and xpathLikePath together', () => {
    const xpath = 'word/shared.xml::/w:root[1]/w:p[1]';
    const provenance = makeProvenance(
      [
        {
          anchorId: 'a:header',
          partUri: 'word/header1.xml',
          xpathLikePath: xpath,
          pathSignature: 'word/header1.xml::/w:root/w:p',
          storyKind: 'header',
        },
      ],
      [
        {
          bindingId: 'b:header',
          anchorIds: ['a:header'],
          storyRef: { storyKind: 'header', storyKey: 'header:rId1' },
          bindingKind: 'pm-node',
          featureKey: 'paragraph',
          nodeType: 'paragraph',
          traceability: 'occurrence',
          status: 'clean',
        },
      ],
    );
    const universe = makeUniverse([
      {
        occurrenceId: 'occ:footer',
        docId: 'test-doc',
        featureKey: 'paragraph',
        tier: 'structural',
        rawFactIds: ['raw:footer'],
        sourceRefs: [{ partUri: 'word/footer1.xml', xpathLikePath: xpath }],
      },
    ]);

    const result = buildImportObservations({ provenance, universe, docId: 'test-doc' });

    expect(result.observations).toHaveLength(0);
  });
});
