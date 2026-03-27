// ---------------------------------------------------------------------------
// Resolved Provenance Builder
// ---------------------------------------------------------------------------
// Resolves collected provenance bindings to PM positions using
// buildPositionMapFromPmDoc. Produces the final V1ResolvedProvenance snapshot.
//
// CRITICAL: Position maps must be built from the preserved importer-emitted
// JSON snapshots, NOT from doc.toJSON(). The WeakMap keys must be the same
// objects that handlers emitted during import.
// ---------------------------------------------------------------------------

import type { Node as PMNode, Schema } from 'prosemirror-model';
import { buildPositionMapFromPmDoc } from '../../presentation-editor/utils/PositionMapFromPm.js';
import type {
  V1CollectedProvenance,
  V1ResolvedProvenance,
  V1ResolvedBinding,
  V1StoryRef,
  V1StorySnapshot,
} from './provenance-types.js';

type PositionMap = WeakMap<object, { start: number; end: number }>;

/** Per-story position resolution context. */
type StoryResolution = {
  storyRef: V1StoryRef;
  partUri: string;
  positionMap: PositionMap | null;
};

/** Input for resolving a single story's position map. */
export type StoryInput = {
  storyRef: V1StoryRef;
  partUri: string;
  /** The preserved importer-emitted JSON doc (must be the original objects, not toJSON()). */
  jsonDoc: unknown;
  /** The PM schema to use for nodeFromJSON. */
  schema: Schema;
};

/**
 * Resolve collected provenance to PM positions and produce a snapshot.
 *
 * For each story, builds a PM node from the preserved JSON and creates
 * a position map. Then resolves each binding's jsonNode to a pmRange
 * using the position map for the binding's story.
 */
export function resolveProvenance(
  collected: V1CollectedProvenance,
  stories: StoryInput[],
  docId: string,
  docFingerprint?: string,
): V1ResolvedProvenance {
  // Build position maps for each story
  const storyResolutions = new Map<string, StoryResolution>();
  const storySnapshots: V1StorySnapshot[] = [];

  for (const story of stories) {
    const resolution = resolveStoryPositions(story);
    storyResolutions.set(story.storyRef.storyKey, resolution);
    storySnapshots.push({
      storyRef: story.storyRef,
      partUri: story.partUri,
      positionMapAvailable: resolution.positionMap !== null,
    });
  }

  // Resolve each binding's jsonNode to a pmRange
  const resolvedBindings: V1ResolvedBinding[] = [];
  let occurrenceLevelBindings = 0;
  let featureLevelBindings = 0;

  for (const binding of collected.bindings) {
    const resolution = storyResolutions.get(binding.storyRef.storyKey);
    let pmRange: { start: number; end: number } | undefined;
    let traceability = binding.traceability;

    if (binding.jsonNode && resolution?.positionMap) {
      pmRange = resolution.positionMap.get(binding.jsonNode) ?? undefined;
    }

    // Degrade traceability if position map not available for this story
    if (!resolution?.positionMap && traceability === 'occurrence') {
      traceability = 'feature';
    }

    if (traceability === 'occurrence') {
      occurrenceLevelBindings++;
    } else {
      featureLevelBindings++;
    }

    resolvedBindings.push({
      bindingId: binding.bindingId,
      anchorIds: binding.anchorIds,
      storyRef: binding.storyRef,
      bindingKind: binding.bindingKind,
      featureKey: binding.featureKey,
      nodeType: binding.nodeType,
      markType: binding.markType,
      pmRange,
      traceability,
      status: binding.status,
      statusReason: binding.statusReason,
    });
  }

  return {
    schemaVersion: 1,
    docId,
    docFingerprint,
    snapshotRevision: 'imported',
    stories: storySnapshots,
    sourceAnchors: collected.sourceAnchors,
    bindings: resolvedBindings,
    diagnostics: collected.diagnostics,
    stats: {
      totalAnchors: collected.sourceAnchors.length,
      totalBindings: resolvedBindings.length,
      occurrenceLevelBindings,
      featureLevelBindings,
    },
  };
}

/**
 * Resolve position maps for a single story.
 *
 * For main/header/footer: the jsonDoc is already a PM doc JSON.
 * For comment/footnote/endnote: the content array is wrapped in a
 * synthetic doc node before calling buildPositionMapFromPmDoc.
 */
function resolveStoryPositions(story: StoryInput): StoryResolution {
  try {
    const pmNode: PMNode = story.schema.nodeFromJSON(story.jsonDoc);
    const positionMap = buildPositionMapFromPmDoc(pmNode, story.jsonDoc);

    return {
      storyRef: story.storyRef,
      partUri: story.partUri,
      positionMap,
    };
  } catch {
    // Position map construction failed — degrade gracefully
    return {
      storyRef: story.storyRef,
      partUri: story.partUri,
      positionMap: null,
    };
  }
}
