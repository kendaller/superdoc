// ---------------------------------------------------------------------------
// V1 Runtime Bridge
// ---------------------------------------------------------------------------

export type {
  V1StoryKind,
  V1StoryRef,
  V1StorySnapshot,
  V1SourceAnchor,
  V1BindingKind,
  V1BindingStatus,
  V1ResolvedBinding,
  V1ProvenanceDiagnostic,
  V1ResolvedProvenance,
} from './types.js';

export { buildImportObservations } from './build-import-observations.js';
export type { BuildImportObservationsInput, BuildImportObservationsResult } from './build-import-observations.js';

export { joinUniverseProvenance } from './universe-join.js';
export type { JoinMatch, UniverseJoinResult } from './universe-join.js';

export { detectGaps } from './gaps.js';
export type { DetectGapsInput } from './gaps.js';

export {
  buildRuntimeSummary,
  buildRuntimeManifest,
  buildDocumentManifestEntry,
  wrapObservations,
} from './summarize.js';

export { buildV1Capabilities, V1_ADAPTER_VERSION } from './capabilities.js';

export { writeDocObservations, writeCorpusRuntimeArtifacts } from './write-artifacts.js';

export { runV1Pipeline } from './pipeline.js';
export type { V1PipelineInput, V1PipelineResult } from './pipeline.js';
