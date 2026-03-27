// ---------------------------------------------------------------------------
// Import Provenance Types
// ---------------------------------------------------------------------------
// Internal type definitions for the v1 import provenance system.
// These types are NOT exported from the package — they are internal to
// the super-converter analysis layer.
//
// The serialized JSON shapes (V1ResolvedProvenance, etc.) live in
// v2/analysis/src/runtime/v1/types.ts and are the cross-package contract.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Story Model
// ---------------------------------------------------------------------------

export type V1StoryKind = 'main' | 'header' | 'footer' | 'comment' | 'footnote' | 'endnote' | 'other';

export type V1StoryRef = {
  storyKind: V1StoryKind;
  storyKey: string;
};

// ---------------------------------------------------------------------------
// Source Anchor
// ---------------------------------------------------------------------------

export type V1SourceAnchor = {
  anchorId: string;
  partUri: string;
  xpathLikePath: string;
  pathSignature: string;
  qname?: string;
  storyKind: V1StoryKind;
  rawFactIds?: string[];
};

// ---------------------------------------------------------------------------
// Binding Metadata (passed by handlers during import)
// ---------------------------------------------------------------------------

export type V1BindingKind =
  | 'pm-node'
  | 'pm-range'
  | 'mark-on-node'
  | 'synthetic-node'
  | 'feature-anchor'
  | 'layout-block';

export type V1BindingStatus = 'clean' | 'synthetic' | 'degraded' | 'partial';

export type V1BindingMeta = {
  featureKey?: string;
  nodeType?: string;
  markTypes?: string[];
  traceability: 'occurrence' | 'feature';
  status?: V1BindingStatus;
  statusReason?: string;
};

export type V1RangeBindingMeta = V1BindingMeta & {
  startJsonNode?: object;
  endJsonNode?: object;
};

// ---------------------------------------------------------------------------
// Collected Provenance (finalized in-memory form before PM-position resolution)
// ---------------------------------------------------------------------------

export type V1CollectedBinding = {
  bindingId: string;
  anchorIds: string[];
  storyRef: V1StoryRef;
  bindingKind: V1BindingKind;
  featureKey?: string;
  jsonNode?: object;
  nodeType?: string;
  markType?: string;
  traceability: 'occurrence' | 'feature';
  status: V1BindingStatus;
  statusReason?: string;
};

export type V1ProvenanceDiagnostic = {
  anchorIds: string[];
  message: string;
  severity: 'info' | 'warning' | 'error';
};

export type V1CollectedProvenance = {
  sourceAnchors: V1SourceAnchor[];
  bindings: V1CollectedBinding[];
  diagnostics: V1ProvenanceDiagnostic[];
};

// ---------------------------------------------------------------------------
// Resolved Provenance Snapshot
// ---------------------------------------------------------------------------

export type V1StorySnapshot = {
  storyRef: V1StoryRef;
  partUri: string;
  positionMapAvailable: boolean;
};

export type V1ResolvedBinding = {
  bindingId: string;
  anchorIds: string[];
  storyRef: V1StoryRef;
  bindingKind: V1BindingKind;
  featureKey?: string;
  nodeType?: string;
  markType?: string;
  pmRange?: { start: number; end: number };
  traceability: 'occurrence' | 'feature';
  status: V1BindingStatus;
  statusReason?: string;
};

export type V1ResolvedProvenance = {
  schemaVersion: 1;
  docId: string;
  docFingerprint?: string;
  snapshotRevision: 'imported';
  stories: V1StorySnapshot[];
  sourceAnchors: V1SourceAnchor[];
  bindings: V1ResolvedBinding[];
  diagnostics: V1ProvenanceDiagnostic[];
  stats: {
    totalAnchors: number;
    totalBindings: number;
    occurrenceLevelBindings: number;
    featureLevelBindings: number;
  };
};

// ---------------------------------------------------------------------------
// Source Index
// ---------------------------------------------------------------------------

/** Pre-traversal source index mapping XML DOM objects to source anchors. */
export type V1SourceIndex = {
  getAnchorId(node: object): string | undefined;
  getAnchor(node: object): V1SourceAnchor | undefined;
};

// ---------------------------------------------------------------------------
// Provenance Collector Interface
// ---------------------------------------------------------------------------

export type ImportProvenanceCollector = {
  /** Register a source anchor. Returns the anchorId. */
  createAnchor(input: {
    partUri: string;
    xpathLikePath: string;
    pathSignature: string;
    qname?: string;
    storyKind: V1StoryKind;
  }): string;

  /** Bind a JSON node to one or more source anchors. */
  bindJsonNode(anchorIds: string[], jsonNode: object, meta: V1BindingMeta): void;

  /** Bind a PM mark (on a JSON node) to one or more source anchors. */
  bindMark(anchorIds: string[], jsonNode: object, markType: string, meta: V1BindingMeta): void;

  /** Bind a synthetic node (from preprocessing) to source anchors. */
  bindSynthetic(anchorIds: string[], jsonNode: object, meta: V1BindingMeta): void;

  /** Bind a feature observation directly to one or more source anchors. */
  bindFeature(anchorIds: string[], featureKey: string, meta: V1BindingMeta): void;

  /** Bind a range (start/end JSON nodes) to source anchors. */
  bindRange(anchorIds: string[], meta: V1RangeBindingMeta): void;

  /** Add a diagnostic associated with source anchors. */
  addDiagnostic(anchorIds: string[], message: string, severity?: 'info' | 'warning' | 'error'): void;

  /** Set the current story context for new bindings. */
  setStoryContext(storyRef: V1StoryRef): void;

  /** Finalize collection and return the collected provenance. */
  finalize(): V1CollectedProvenance;
};
