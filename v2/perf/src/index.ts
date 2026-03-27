// ---------------------------------------------------------------------------
// @superdoc/v2-perf — public API
// ---------------------------------------------------------------------------

// Core timeline
export { PerfTimeline, v2PerfTimeline } from "./timeline.js";
export type { MarkEntry, SpanEntry, TimelineSnapshot } from "./timeline.js";

// Metric vocabulary
export * from "./metrics.js";

// Benchmark artifact schema
export {
  createArtifact,
  toSummaryRow,
  compareArtifacts,
} from "./artifact.js";
export type {
  BenchmarkMode,
  BenchmarkArtifact,
  BenchmarkSummaryRow,
  ArtifactDelta,
  MachineInfo,
  GitInfo,
} from "./artifact.js";

// Corpus manifest
export {
  DOCUMENT_CLASSES,
  DEFAULT_CORPUS_MANIFEST,
  entriesByClass,
  entriesByProfile,
  getEntry,
  isManifestPopulated,
} from "./corpus.js";
export type {
  DocumentClass,
  ContentProfile,
  CorpusEntry,
  CorpusManifest,
} from "./corpus.js";

// Reporters
export { formatSummaryTable, formatDeltaTable } from "./reporters/table-reporter.js";
export {
  artifactFilename,
  serializeArtifact,
  deserializeArtifact,
  serializeBatch,
} from "./reporters/json-reporter.js";
