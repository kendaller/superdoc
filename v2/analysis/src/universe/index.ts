// ---------------------------------------------------------------------------
// Universe (Layer 1)
// ---------------------------------------------------------------------------

// Public API
export { buildUniverseFromCorpus, buildDocumentUniverse } from './api.js';
export type { BuildCorpusUniverseOptions, BuildDocumentUniverseOptions } from './api.js';

// Artifact writing
export { writeUniverseArtifacts } from './write-artifacts.js';

// Feature registry
export { FEATURE_REGISTRY, REGISTRY_VERSION, getRegistryMap } from './feature-registry.js';
export type { FeatureRule } from './feature-registry.js';

// Part scope
export { CONTENT_BEARING_PARTS, isContentBearing } from './part-scope.js';

// Types
export type {
  FeatureTier,
  ClaimMode,
  FeatureOccurrence,
  DocumentStatus,
  DocumentUniverse,
  CorpusFeatureRow,
  CorpusUniverse,
  ExampleSelection,
  FeatureExamples,
  UnmappedFactEntry,
  UnmappedRawSurface,
  ManifestDocumentStatus,
  UniverseManifest,
  UniverseResult,
} from './types.js';
