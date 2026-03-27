// ---------------------------------------------------------------------------
// Mutation system types — refs, positions, steps, transactions, results
//
// All types are serializable (JSON-safe) to support worker transport
// and future collaboration. No live object references.
// ---------------------------------------------------------------------------

import type { SessionDiagnostic } from "../types/session.js";

// ---- Refs -----------------------------------------------------------------

export type PartRef = { kind: "part"; uri: string };

export type RegionRef = {
  kind: "region";
  partUri: string;
  regionId: string;
  stability: "indexed-boundary" | "synthetic";
};

export type NodeRef = {
  kind: "node";
  partUri: string;
  nodeId: string;
  stability: "source-anchored" | "session-generated";
};

export type AttrRef = {
  kind: "attr";
  partUri: string;
  nodeId: string;
  attrId: string;
};

export type RelationshipRef = {
  kind: "relationship";
  ownerUri: string | "/";
  relationshipId: string;
};

export type SerializableRef = PartRef | NodeRef | AttrRef | RelationshipRef;

// ---- Positions ------------------------------------------------------------

export type ChildPosition =
  | { kind: "before"; node: NodeRef }
  | { kind: "after"; node: NodeRef }
  | { kind: "at-index"; parent: NodeRef; index: number }
  | { kind: "append"; parent: NodeRef }
  | { kind: "prepend"; parent: NodeRef };

export type TextPosition = { kind: "text-offset"; node: NodeRef; offset: number };

// ---- Serialized node (creation payload) -----------------------------------

/**
 * Strict creation payload for xml.insertNode and xml.replaceNode.
 *
 * Callers describe WHAT to create, not HOW to wire it into the engine.
 * No internal IDs, no source spans, no parent links.
 * The engine assigns all identity during step application.
 */
export type SerializedXmlNode = SerializedXmlElement | SerializedXmlText;

export type SerializedXmlElement = {
  kind: "element";
  name: string;
  namespace?: string;
  prefix?: string;
  attributes?: SerializedXmlAttribute[];
  children?: SerializedXmlNode[];
};

export type SerializedXmlAttribute = {
  name: string;
  value: string;
  namespace?: string;
  prefix?: string;
};

export type SerializedXmlText = {
  kind: "text";
  value: string;
};

// ---- Mutation steps -------------------------------------------------------

export type XmlInsertNodeStep = {
  kind: "xml.insertNode";
  part: PartRef;
  position: ChildPosition;
  content: SerializedXmlNode;
  /** Pending ref label for intra-transaction references (e.g. "pending:myPara"). */
  assignId?: string;
};

export type XmlRemoveNodeStep = {
  kind: "xml.removeNode";
  part: PartRef;
  node: NodeRef;
};

export type XmlReplaceNodeStep = {
  kind: "xml.replaceNode";
  part: PartRef;
  node: NodeRef;
  content: SerializedXmlNode;
  assignId?: string;
};

export type XmlSetTextStep = {
  kind: "xml.setText";
  part: PartRef;
  node: NodeRef;
  value: string;
};

export type XmlSetAttributeStep = {
  kind: "xml.setAttribute";
  part: PartRef;
  node: NodeRef;
  name: string;
  namespace?: string;
  prefix?: string;
  value: string;
};

export type XmlRemoveAttributeStep = {
  kind: "xml.removeAttribute";
  part: PartRef;
  node: NodeRef;
  name: string;
  namespace?: string;
};

// ---- Package-level mutation steps -----------------------------------------

export type PkgAddPartStep = {
  kind: "pkg.addPart";
  uri: string;
  contentType: string;
  initialContent: Uint8Array | SerializedXmlElement;
};

export type PkgRemovePartStep = {
  kind: "pkg.removePart";
  uri: string;
};

export type PkgAddRelationshipStep = {
  kind: "pkg.addRelationship";
  ownerUri: string | "/";
  type: string;
  target: string;
  /** If omitted, auto-allocated via allocateRelationshipId. */
  assignRelId?: string;
};

export type PkgRemoveRelationshipStep = {
  kind: "pkg.removeRelationship";
  ownerUri: string | "/";
  relationshipId: string;
};

export type PkgAddContentTypeOverrideStep = {
  kind: "pkg.addContentTypeOverride";
  partUri: string;
  contentType: string;
};

export type PkgRemoveContentTypeOverrideStep = {
  kind: "pkg.removeContentTypeOverride";
  partUri: string;
};

export type PkgSetPartBytesStep = {
  kind: "pkg.setPartBytes";
  uri: string;
  bytes: Uint8Array;
};

export type PkgMutationStep =
  | PkgAddPartStep
  | PkgRemovePartStep
  | PkgAddRelationshipStep
  | PkgRemoveRelationshipStep
  | PkgAddContentTypeOverrideStep
  | PkgRemoveContentTypeOverrideStep
  | PkgSetPartBytesStep;

// ---- Unified step union ---------------------------------------------------

export type XmlMutationStep =
  | XmlInsertNodeStep
  | XmlRemoveNodeStep
  | XmlReplaceNodeStep
  | XmlSetTextStep
  | XmlSetAttributeStep
  | XmlRemoveAttributeStep;

export type MutationStep = XmlMutationStep | PkgMutationStep;

// ---- Transaction ----------------------------------------------------------

export type MutationOrigin =
  | { kind: "local"; source?: string }
  | { kind: "worker"; source?: string }
  | { kind: "yjs"; clientId?: string; updateId?: string }
  | { kind: "system"; source?: string };

export type MutationMetadata = {
  label?: string;
  userFacing?: boolean;
  mergeGroup?: string;
  timestamp?: string;
  /** Ephemeral, for debugging only — not used for correctness. */
  sessionInstanceId?: string;
};

export type MutationTransaction = {
  id: string;
  baseRevision: string;
  origin: MutationOrigin;
  metadata?: MutationMetadata;
  steps: MutationStep[];
};

// ---- Results --------------------------------------------------------------

export type MutationErrorKind =
  | "stale-base"
  | "ref-not-found"
  | "invalid-position"
  | "structural-violation"
  | "hydration-failure"
  | "internal-error";

export type MutationApplySuccess = {
  ok: true;
  transactionId: string;
  baseRevision: string;
  appliedRevision: string;
  diagnostics: SessionDiagnostic[];
  touchedParts: string[];
  createdRefs: SerializableRef[];
  invalidatedRefs: SerializableRef[];
};

export type MutationApplyFailure = {
  ok: false;
  transactionId: string;
  baseRevision: string;
  error: MutationErrorKind;
  message: string;
  /** Which step failed (absent for transaction-level rejection). */
  failedStepIndex?: number;
  diagnostics: SessionDiagnostic[];
};

export type MutationApplyResult = MutationApplySuccess | MutationApplyFailure;

// ---- Step effects ---------------------------------------------------------

/** Structured description of what a single step changed. */
export type StepEffect = {
  touchedPartUris: string[];
  createdNodeIds: string[];
  removedNodeIds: string[];
  packageMetadataChanged: boolean;
};

// ---- Journal --------------------------------------------------------------

export type MutationRecord = {
  transaction: MutationTransaction;
  result: MutationApplyResult;
  committedAt: string;
};
