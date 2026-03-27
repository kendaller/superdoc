// ---------------------------------------------------------------------------
// Import Provenance Collector
// ---------------------------------------------------------------------------
// In-memory collector that accumulates source anchors and bindings during
// the DOCX import pipeline. Called by handlers as they emit JSON nodes.
//
// Usage:
//   const collector = createProvenanceCollector();
//   collector.setStoryContext({ storyKind: 'main', storyKey: 'main' });
//   // ... during handler traversal ...
//   collector.createAnchor({ partUri, xpathLikePath, pathSignature, storyKind });
//   collector.bindJsonNode([anchorId], jsonNode, { nodeType: 'paragraph', traceability: 'occurrence' });
//   // ... after all traversal ...
//   const collected = collector.finalize();
// ---------------------------------------------------------------------------

import { buildAnchorId } from './source-anchor.js';
import type {
  ImportProvenanceCollector,
  V1SourceAnchor,
  V1CollectedBinding,
  V1CollectedProvenance,
  V1ProvenanceDiagnostic,
  V1BindingMeta,
  V1RangeBindingMeta,
  V1StoryRef,
  V1StoryKind,
} from './provenance-types.js';

let nextBindingSeq = 0;

function nextBindingId(): string {
  return `b:${(nextBindingSeq++).toString(36)}`;
}

/**
 * Create a fresh import provenance collector.
 *
 * One collector is created per document import. It accumulates source anchors,
 * bindings, and diagnostics as handlers emit JSON nodes during traversal.
 */
export function createProvenanceCollector(): ImportProvenanceCollector {
  const anchors = new Map<string, V1SourceAnchor>();
  const anchorIdsByCanonicalKey = new Map<string, string>();
  const bindings: V1CollectedBinding[] = [];
  const diagnostics: V1ProvenanceDiagnostic[] = [];

  let currentStoryRef: V1StoryRef = { storyKind: 'main', storyKey: 'main' };

  function createAnchor(input: {
    partUri: string;
    xpathLikePath: string;
    pathSignature: string;
    qname?: string;
    storyKind: V1StoryKind;
  }): string {
    const canonicalKey = `${input.partUri}\n${input.xpathLikePath}`;

    // Return existing anchor if already registered (idempotent)
    const existing = anchorIdsByCanonicalKey.get(canonicalKey);
    if (existing) return existing;

    const anchorId = buildAnchorId(input.partUri, input.xpathLikePath);

    // Detect hash collisions within this document
    if (anchors.has(anchorId)) {
      const prev = anchors.get(anchorId)!;
      if (prev.xpathLikePath !== input.xpathLikePath || prev.partUri !== input.partUri) {
        throw new Error(
          `Anchor ID collision: ${anchorId} maps to both ` +
            `"${prev.partUri}::${prev.xpathLikePath}" and ` +
            `"${input.partUri}::${input.xpathLikePath}"`,
        );
      }
    }

    const anchor: V1SourceAnchor = {
      anchorId,
      partUri: input.partUri,
      xpathLikePath: input.xpathLikePath,
      pathSignature: input.pathSignature,
      qname: input.qname,
      storyKind: input.storyKind,
    };

    anchors.set(anchorId, anchor);
    anchorIdsByCanonicalKey.set(canonicalKey, anchorId);
    return anchorId;
  }

  function bindJsonNode(anchorIds: string[], jsonNode: object, meta: V1BindingMeta): void {
    bindings.push({
      bindingId: nextBindingId(),
      anchorIds,
      storyRef: { ...currentStoryRef },
      bindingKind: 'pm-node',
      featureKey: meta.featureKey,
      jsonNode,
      nodeType: meta.nodeType,
      traceability: meta.traceability,
      status: meta.status ?? 'clean',
      statusReason: meta.statusReason,
    });
  }

  function bindMark(anchorIds: string[], jsonNode: object, markType: string, meta: V1BindingMeta): void {
    bindings.push({
      bindingId: nextBindingId(),
      anchorIds,
      storyRef: { ...currentStoryRef },
      bindingKind: 'mark-on-node',
      featureKey: meta.featureKey,
      jsonNode,
      markType,
      traceability: 'feature', // marks are always feature-level until mark-range resolution
      status: meta.status ?? 'clean',
      statusReason: meta.statusReason,
    });
  }

  function bindSynthetic(anchorIds: string[], jsonNode: object, meta: V1BindingMeta): void {
    bindings.push({
      bindingId: nextBindingId(),
      anchorIds,
      storyRef: { ...currentStoryRef },
      bindingKind: 'synthetic-node',
      featureKey: meta.featureKey,
      jsonNode,
      nodeType: meta.nodeType,
      traceability: meta.traceability,
      status: meta.status ?? 'synthetic',
      statusReason: meta.statusReason ?? 'Produced by preprocessing',
    });
  }

  function bindFeature(anchorIds: string[], featureKey: string, meta: V1BindingMeta): void {
    bindings.push({
      bindingId: nextBindingId(),
      anchorIds,
      storyRef: { ...currentStoryRef },
      bindingKind: 'feature-anchor',
      featureKey,
      nodeType: meta.nodeType,
      traceability: meta.traceability,
      status: meta.status ?? 'clean',
      statusReason: meta.statusReason,
    });
  }

  function bindRange(anchorIds: string[], meta: V1RangeBindingMeta): void {
    bindings.push({
      bindingId: nextBindingId(),
      anchorIds,
      storyRef: { ...currentStoryRef },
      bindingKind: 'pm-range',
      nodeType: meta.nodeType,
      traceability: meta.traceability,
      status: meta.status ?? 'clean',
      statusReason: meta.statusReason,
    });
  }

  function addDiagnostic(anchorIds: string[], message: string, severity: 'info' | 'warning' | 'error' = 'info'): void {
    diagnostics.push({ anchorIds, message, severity });
  }

  function setStoryContext(storyRef: V1StoryRef): void {
    currentStoryRef = { ...storyRef };
  }

  function finalize(): V1CollectedProvenance {
    const sortedAnchors = [...anchors.values()].sort((a, b) => a.anchorId.localeCompare(b.anchorId));

    return {
      sourceAnchors: sortedAnchors,
      bindings,
      diagnostics,
    };
  }

  return {
    createAnchor,
    bindJsonNode,
    bindMark,
    bindSynthetic,
    bindFeature,
    bindRange,
    addDiagnostic,
    setStoryContext,
    finalize,
  };
}
