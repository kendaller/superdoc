// ---------------------------------------------------------------------------
// Semantic JSON projection — public API
//
// Lossy, read-only JSON view of the semantic model for API consumers.
// ---------------------------------------------------------------------------

export type {
  SemanticDocument,
  SemanticStory,
  SemanticBlock,
  SemanticParagraph,
  SemanticRun,
  SemanticTable,
  SemanticTableRow,
  SemanticTableCell,
  SemanticSection,
  SemanticStyleSummary,
  DocumentMetadata,
} from "./types.js";

export { projectToSemanticJson } from "./project.js";
