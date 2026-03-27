// ---------------------------------------------------------------------------
// Provenance Hooks
// ---------------------------------------------------------------------------
// Helper functions that handlers call during import to record provenance.
// These are exposed via extraParams and are no-ops when provenance is disabled.
//
// Usage in a handler:
//   const { provenanceHooks } = extraParams;
//   if (provenanceHooks) {
//     provenanceHooks.bindNode(xmlNode, emittedJsonNode, { nodeType: 'paragraph' });
//   }
// ---------------------------------------------------------------------------

import type { ImportProvenanceCollector, V1SourceIndex, V1BindingMeta } from './provenance-types.js';

/**
 * Provenance hooks interface, passed to handlers via extraParams.
 *
 * Handlers should check for presence before calling (provenance is opt-in).
 * Each method is a thin wrapper that looks up the XML node in the source
 * index and delegates to the collector.
 */
export type ProvenanceHooks = {
  /** Bind a JSON node to the source anchor of the given XML element. */
  bindNode(xmlNode: object, jsonNode: object, meta: Partial<V1BindingMeta>): void;

  /** Bind a mark on a JSON node to the source anchor of the given XML element. */
  bindMark(xmlNode: object, jsonNode: object, markType: string): void;

  /** Bind a synthetic node (from preprocessing) to multiple XML source nodes. */
  bindSynthetic(xmlNodes: object[], jsonNode: object, meta?: Partial<V1BindingMeta>): void;

  /** Bind a feature-level observation directly to the source anchor of the given XML element. */
  bindFeature(xmlNode: object, featureKey: string, meta?: Partial<V1BindingMeta>): void;

  /** Add a diagnostic for a specific XML node. */
  addDiagnostic(xmlNode: object, message: string, severity?: 'info' | 'warning' | 'error'): void;
};

/**
 * Create provenance hooks backed by a source index and collector.
 */
export function createProvenanceHooks(
  sourceIndex: V1SourceIndex,
  collector: ImportProvenanceCollector,
): ProvenanceHooks {
  function bindNode(xmlNode: object, jsonNode: object, meta: Partial<V1BindingMeta> = {}): void {
    const anchorId = sourceIndex.getAnchorId(xmlNode);
    if (!anchorId) return;

    collector.bindJsonNode([anchorId], jsonNode, {
      featureKey: meta.featureKey,
      nodeType: meta.nodeType,
      traceability: meta.traceability ?? 'occurrence',
      status: meta.status ?? 'clean',
      statusReason: meta.statusReason,
    });
  }

  function bindMark(xmlNode: object, jsonNode: object, markType: string): void {
    const anchorId = sourceIndex.getAnchorId(xmlNode);
    if (!anchorId) return;

    collector.bindMark([anchorId], jsonNode, markType, {
      traceability: 'feature', // marks are always feature-level until mark-range resolution
    });
  }

  function bindSynthetic(xmlNodes: object[], jsonNode: object, meta: Partial<V1BindingMeta> = {}): void {
    const anchorIds = xmlNodes.map((n) => sourceIndex.getAnchorId(n)).filter((id): id is string => id !== undefined);

    if (anchorIds.length === 0) return;

    collector.bindSynthetic(anchorIds, jsonNode, {
      featureKey: meta.featureKey,
      nodeType: meta.nodeType,
      traceability: meta.traceability ?? 'feature',
      status: meta.status ?? 'synthetic',
      statusReason: meta.statusReason ?? 'Produced by preprocessing',
    });
  }

  function addDiagnostic(xmlNode: object, message: string, severity: 'info' | 'warning' | 'error' = 'info'): void {
    const anchorId = sourceIndex.getAnchorId(xmlNode);
    if (!anchorId) return;

    collector.addDiagnostic([anchorId], message, severity);
  }

  function bindFeature(xmlNode: object, featureKey: string, meta: Partial<V1BindingMeta> = {}): void {
    const anchorId = sourceIndex.getAnchorId(xmlNode);
    if (!anchorId) return;

    collector.bindFeature([anchorId], featureKey, {
      featureKey,
      nodeType: meta.nodeType,
      traceability: meta.traceability ?? 'feature',
      status: meta.status ?? 'clean',
      statusReason: meta.statusReason,
    });
  }

  return { bindNode, bindMark, bindSynthetic, bindFeature, addDiagnostic };
}

/** No-op provenance hooks for when provenance is disabled. */
export const NULL_PROVENANCE_HOOKS: ProvenanceHooks = {
  bindNode() {},
  bindMark() {},
  bindSynthetic() {},
  bindFeature() {},
  addDiagnostic() {},
};
