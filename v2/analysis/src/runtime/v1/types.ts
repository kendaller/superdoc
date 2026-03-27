// ---------------------------------------------------------------------------
// V1 Runtime Bridge Types
// ---------------------------------------------------------------------------
// Type definitions for the v1 (current SuperDoc) runtime bridge artifacts.
// These define the serialized JSON shapes that super-editor produces and
// v2/analysis consumes. super-editor does NOT import these types directly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Story Model
// ---------------------------------------------------------------------------

export type V1StoryKind =
  | 'main'
  | 'header'
  | 'footer'
  | 'comment'
  | 'footnote'
  | 'endnote'
  | 'other';

export type V1StoryRef = {
  storyKind: V1StoryKind;
  storyKey: string;
};

export type V1StorySnapshot = {
  storyRef: V1StoryRef;
  partUri: string;
  positionMapAvailable: boolean;
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
// Binding
// ---------------------------------------------------------------------------

export type V1BindingKind =
  | 'pm-node'
  | 'pm-range'
  | 'mark-on-node'
  | 'synthetic-node'
  | 'feature-anchor'
  | 'layout-block';

export type V1BindingStatus = 'clean' | 'synthetic' | 'degraded' | 'partial';

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

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type V1ProvenanceDiagnostic = {
  anchorIds: string[];
  message: string;
  severity: 'info' | 'warning' | 'error';
};

// ---------------------------------------------------------------------------
// Resolved Provenance Snapshot
// ---------------------------------------------------------------------------

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
