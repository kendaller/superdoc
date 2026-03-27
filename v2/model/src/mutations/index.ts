// ---------------------------------------------------------------------------
// Mutation module barrel — internal only, NOT re-exported from root src/index.ts
//
// The mutation API is internal-only in Phase 1. It becomes public when
// the internal path is proven and stable.
// ---------------------------------------------------------------------------

// ---- Types ----------------------------------------------------------------

export type {
  // Refs
  PartRef,
  RegionRef,
  NodeRef,
  AttrRef,
  RelationshipRef,
  SerializableRef,

  // Positions
  ChildPosition,
  TextPosition,

  // Serialized node payloads
  SerializedXmlNode,
  SerializedXmlElement,
  SerializedXmlText,
  SerializedXmlAttribute,

  // XML steps
  XmlMutationStep,
  MutationStep,
  XmlInsertNodeStep,
  XmlRemoveNodeStep,
  XmlReplaceNodeStep,
  XmlSetTextStep,
  XmlSetAttributeStep,
  XmlRemoveAttributeStep,

  // Package-level steps
  PkgMutationStep,
  PkgAddPartStep,
  PkgRemovePartStep,
  PkgAddRelationshipStep,
  PkgRemoveRelationshipStep,
  PkgAddContentTypeOverrideStep,
  PkgRemoveContentTypeOverrideStep,
  PkgSetPartBytesStep,

  // Transaction
  MutationTransaction,
  MutationOrigin,
  MutationMetadata,

  // Results
  MutationApplyResult,
  MutationApplySuccess,
  MutationApplyFailure,
  MutationErrorKind,

  // Effects
  StepEffect,

  // Journal
  MutationRecord,
} from "./types.js";

// ---- Engine ---------------------------------------------------------------

export { applyTransaction, getRecentMutations, resetNodeCounter } from "./engine.js";

// ---- Node index -----------------------------------------------------------

export { buildNodeIndex, cloneNodeIndex } from "./node-index.js";

// ---- Materialize ----------------------------------------------------------

export { materializeNode, collectNodeIds } from "./materialize.js";

// ---- Ref resolver ---------------------------------------------------------

export { MutationError } from "./ref-resolver.js";

// ---- ID allocation --------------------------------------------------------

export {
  allocateRelationshipId,
  allocateAnnotationId,
  allocateParagraphId,
  allocateMediaFilename,
} from "./id-allocation.js";
