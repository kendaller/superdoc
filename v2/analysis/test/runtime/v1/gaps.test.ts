import { describe, it, expect } from 'vitest';
import { detectGaps } from '../../../src/runtime/v1/gaps.js';
import { buildV1Capabilities } from '../../../src/runtime/v1/capabilities.js';
import type { V1ResolvedProvenance, V1SourceAnchor, V1ResolvedBinding } from '../../../src/runtime/v1/types.js';
import type { DocumentUniverse } from '../../../src/universe/types.js';
import type { RuntimeObservation } from '../../../src/runtime/types.js';

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
    stories: [],
    sourceAnchors: anchors,
    bindings,
    diagnostics: [],
    stats: {
      totalAnchors: anchors.length,
      totalBindings: bindings.length,
      occurrenceLevelBindings: bindings.filter((binding) => binding.traceability === 'occurrence').length,
      featureLevelBindings: bindings.filter((binding) => binding.traceability === 'feature').length,
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

describe('detectGaps', () => {
  it('detects universe-no-provenance gaps', () => {
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
    const provenance = makeProvenance([]); // no anchors
    const capabilities = buildV1Capabilities();

    const result = detectGaps({
      provenance,
      universe,
      observations: [],
      capabilities,
      docId: 'test-doc',
    });

    expect(result.gaps.some((g) => g.gapKind === 'universe-no-provenance')).toBe(true);
    expect(result.gaps.find((g) => g.gapKind === 'universe-no-provenance')?.featureKey).toBe('paragraph');
  });

  it('detects provenance-no-universe gaps', () => {
    const xpath = 'word/document.xml::/w:document[1]/w:body[1]/w:customEl[1]';
    const anchor: V1SourceAnchor = {
      anchorId: 'a:1',
      partUri: 'word/document.xml',
      xpathLikePath: xpath,
      pathSignature: 'word/document.xml::/w:document/w:body/w:customEl',
      qname: 'w:customEl',
      storyKind: 'main',
    };
    const provenance = makeProvenance([anchor], [
      {
        bindingId: 'b:1',
        anchorIds: ['a:1'],
        storyRef: { storyKind: 'main', storyKey: 'main' },
        bindingKind: 'feature-anchor',
        featureKey: 'custom.unknown',
        traceability: 'feature',
        status: 'clean',
      },
    ]);
    const universe = makeUniverse([]); // no occurrences
    const capabilities = buildV1Capabilities();

    const result = detectGaps({
      provenance,
      universe,
      observations: [],
      capabilities,
      docId: 'test-doc',
    });

    expect(result.gaps.some((g) => g.gapKind === 'provenance-no-universe')).toBe(true);
  });

  it('detects degraded-traceability gaps', () => {
    const capabilities = buildV1Capabilities();
    // paragraph is expected at occurrence level
    const paragraphCap = capabilities.find((c) => c.featureKey === 'paragraph');
    expect(paragraphCap?.expectedTraceabilityLevel).toBe('occurrence');

    const observation: RuntimeObservation = {
      schemaVersion: 1,
      runtime: 'v1',
      docId: 'test-doc',
      stage: 'import',
      traceabilityLevel: 'feature', // degraded from expected 'occurrence'
      observationId: 'obs:1',
      featureKey: 'paragraph',
    };

    const result = detectGaps({
      provenance: makeProvenance([]),
      universe: makeUniverse([]),
      observations: [observation],
      capabilities,
      docId: 'test-doc',
    });

    expect(result.gaps.some((g) => g.gapKind === 'degraded-traceability' && g.featureKey === 'paragraph')).toBe(true);
  });

  it('sorts gaps deterministically', () => {
    const anchors: V1SourceAnchor[] = [
      {
        anchorId: 'a:z',
        partUri: 'word/document.xml',
        xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:z[1]',
        pathSignature: 'word/document.xml::/w:document/w:body/w:z',
        qname: 'w:z',
        storyKind: 'main',
      },
      {
        anchorId: 'a:a',
        partUri: 'word/document.xml',
        xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:a[1]',
        pathSignature: 'word/document.xml::/w:document/w:body/w:a',
        qname: 'w:a',
        storyKind: 'main',
      },
    ];
    const bindings: V1ResolvedBinding[] = anchors.map((anchor, index) => ({
      bindingId: `b:${index}`,
      anchorIds: [anchor.anchorId],
      storyRef: { storyKind: 'main', storyKey: 'main' },
      bindingKind: 'feature-anchor',
      featureKey: `custom:${index}`,
      traceability: 'feature',
      status: 'clean',
    }));
    const provenance = makeProvenance(anchors, bindings);
    const universe = makeUniverse([]);
    const capabilities = buildV1Capabilities();

    const result = detectGaps({
      provenance,
      universe,
      observations: [],
      capabilities,
      docId: 'test-doc',
    });

    // All gaps should be provenance-no-universe, sorted by gapKind then featureKey
    expect(result.totalGaps).toBe(2);
    expect(result.gaps[0].gapKind).toBe('provenance-no-universe');
  });

  it('treats unbound source anchors as missing provenance rather than importer evidence', () => {
    const xpath = 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]';
    const provenance = makeProvenance([
      {
        anchorId: 'a:1',
        partUri: 'word/document.xml',
        xpathLikePath: xpath,
        pathSignature: 'word/document.xml::/w:document/w:body/w:p',
        storyKind: 'main',
      },
    ]);
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

    const result = detectGaps({
      provenance,
      universe,
      observations: [],
      capabilities: buildV1Capabilities(),
      docId: 'test-doc',
    });

    expect(result.gaps.some((gap) => gap.gapKind === 'universe-no-provenance')).toBe(true);
    expect(result.gaps.some((gap) => gap.gapKind === 'provenance-no-universe')).toBe(false);
  });

  it('does not cross-match anchors and occurrences from different parts', () => {
    const xpath = 'word/shared.xml::/w:root[1]/w:p[1]';
    const provenance = makeProvenance(
      [
        {
          anchorId: 'a:header',
          partUri: 'word/header1.xml',
          xpathLikePath: xpath,
          pathSignature: 'word/header1.xml::/w:root/w:p',
          qname: 'w:p',
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

    const result = detectGaps({
      provenance,
      universe,
      observations: [],
      capabilities: buildV1Capabilities(),
      docId: 'test-doc',
    });

    expect(result.gaps.some((gap) => gap.gapKind === 'universe-no-provenance')).toBe(true);
    expect(result.gaps.some((gap) => gap.gapKind === 'provenance-no-universe')).toBe(true);
  });
});
