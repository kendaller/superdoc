// ---------------------------------------------------------------------------
// Analysis projection — public API surface
// ---------------------------------------------------------------------------

export type {
  SemanticOccurrence,
  SupportStatus,
  AnalysisResult,
  TraceEntry,
} from "./types.js";

export { projectToOccurrences } from "./project.js";
export { buildTraceEntry, buildTraceChain } from "./trace.js";
