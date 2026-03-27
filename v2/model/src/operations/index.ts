// ---------------------------------------------------------------------------
// Semantic operations — barrel exports
//
// The operations module is Layer 3 of the semantic model: the ONLY path
// from high-level editing intent to low-level XML surgery. All document
// mutations flow through compileOperation -> applySemanticOperation.
// ---------------------------------------------------------------------------

// ---- Types ------------------------------------------------------------------

export type {
  SemanticOperation,
  SemanticOperationKind,
  InsertTextOp,
  SplitParagraphOp,
  MergeParagraphsOp,
  InsertParagraphOp,
  SetParagraphStyleOp,
  ToggleBoldOp,
} from "./types.js";

// ---- Compiler ---------------------------------------------------------------

export { compileOperation } from "./compile.js";

// ---- Validator --------------------------------------------------------------

export { validateIntentPreservation } from "./validate.js";
export type { IntentViolation } from "./validate.js";

// ---- History ----------------------------------------------------------------

export { SemanticHistory, computeReverse, capturePreOpSnapshot } from "./history.js";
export type { PreOpSnapshot } from "./history.js";

// ---- Apply ------------------------------------------------------------------

export { applySemanticOperation, resetOperationCounter } from "./apply.js";
export type { SemanticOperationResult } from "./apply.js";

// ---- Document-API adapter ---------------------------------------------------

export { DocumentApiAdapter } from "./doc-api-adapter.js";
