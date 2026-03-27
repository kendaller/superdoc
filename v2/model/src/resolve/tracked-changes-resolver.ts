// ---------------------------------------------------------------------------
// Tracked changes resolver
//
// Mode-aware visibility filter for tracked change content.
// Determines which runs are visible based on the tracked changes mode:
//   - "review": all content visible, changes marked
//   - "original": show document before changes (hide insertions, show deletions)
//   - "final": show document with all changes accepted (hide deletions)
//   - "off": all content visible, no change metadata
// ---------------------------------------------------------------------------

import type { RevisionRangeRawProperties } from "../entities/types.js";
import type { EntityRef } from "../identity/types.js";
import type { SemanticModel } from "../model.js";

export type TrackedChangesMode = "review" | "original" | "final" | "off";

export type TrackedChangeAnnotation = {
  readonly revisionType: RevisionRangeRawProperties["revisionType"];
  readonly revisionId: string;
  readonly author: string | undefined;
  readonly date: string | undefined;
};

export type AnnotatedRun = {
  readonly runRef: EntityRef;
  readonly visible: boolean;
  readonly trackedChange: TrackedChangeAnnotation | undefined;
};

/**
 * Filter and annotate runs based on tracked changes mode.
 *
 * Walks all revision range entities in the model and builds a map of
 * which runs are inside which revision. Then applies visibility rules.
 */
export function resolveTrackedChanges(
  model: SemanticModel,
  paragraphRef: EntityRef,
  mode: TrackedChangesMode,
): AnnotatedRun[] {
  if (mode === "off") {
    return model.runs(paragraphRef).map((r) => ({
      runRef: r.ref,
      visible: true,
      trackedChange: undefined,
    }));
  }

  // Build a map of run ref → revision range annotation
  const runAnnotations = buildRunAnnotationMap(model);
  const runs = model.runs(paragraphRef);

  return runs.map((run) => {
    const annotation = runAnnotations.get(run.ref.id);
    const visible = isVisible(annotation, mode);
    return { runRef: run.ref, visible, trackedChange: annotation };
  });
}

function isVisible(
  annotation: TrackedChangeAnnotation | undefined,
  mode: TrackedChangesMode,
): boolean {
  if (!annotation) return true;

  switch (mode) {
    case "review":
      return true; // All content visible in review mode
    case "original":
      // Hide insertions (they didn't exist in the original)
      return annotation.revisionType !== "insert" && annotation.revisionType !== "moveTo";
    case "final":
      // Hide deletions (they're removed in the final)
      return annotation.revisionType !== "delete" && annotation.revisionType !== "moveFrom";
    default:
      return true;
  }
}

/**
 * Build a map of run entity ref ID → tracked change annotation.
 * This examines all revision range entities and maps their child runs.
 */
function buildRunAnnotationMap(
  model: SemanticModel,
): Map<string, TrackedChangeAnnotation> {
  const map = new Map<string, TrackedChangeAnnotation>();
  const revisionRanges = model.allEntities("revisionRange");

  // Phase 4A+: Build run↔revision association by tracking which runs
  // were discovered inside which tracked-change wrapper during tier-1
  // construction. For now, the revision range entity captures the
  // wrapper metadata but run association is not yet wired.
  for (const rev of revisionRanges) {
    const raw = rev.raw() as RevisionRangeRawProperties;
    map.set(rev.ref.id, {
      revisionType: raw.revisionType,
      revisionId: raw.revisionId,
      author: raw.author,
      date: raw.date,
    });
  }

  return map;
}
