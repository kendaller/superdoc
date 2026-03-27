// ---------------------------------------------------------------------------
// Trace chain utilities — Phase 4B
//
// Trace entries link semantic entities back to their source XML and
// forward to downstream projection fragments (layout, render). This
// provides end-to-end provenance: source XML node → entity → layout
// block → rendered DOM element.
//
// The projection leg is populated when a layout projection result is
// available (its blockToEntityRef map provides the entity→block link).
// ---------------------------------------------------------------------------

import type { SemanticModel } from "../../model.js";
import type { EntityRef, ProjectionRef } from "../../identity/types.js";
import type { Entity } from "../../entities/types.js";
import type { TraceEntry } from "./types.js";

/**
 * Build a trace entry from an entity, optionally linking to a projection
 * block via the blockToEntityRef map from a layout projection result.
 *
 * @param entity - The entity to trace.
 * @param blockToEntityRef - Map from block IDs → entity refs, produced by
 *   `projectToFlowBlocks()`. If provided, the trace entry includes the
 *   projection ref linking entity → layout block.
 */
export function buildTraceEntry(
  entity: Entity,
  blockToEntityRef?: ReadonlyMap<string, EntityRef>,
): TraceEntry | undefined {
  const primarySource = entity.sourceRefs[0];
  if (!primarySource) return undefined;

  // Find the projection ref by reverse-looking up the entity ref in the map
  let projectionRef: ProjectionRef | undefined;
  if (blockToEntityRef) {
    for (const [blockId, entityRef] of blockToEntityRef) {
      if (entityRef.id === entity.ref.id) {
        projectionRef = { id: blockId, sourceEntityRef: entity.ref };
        break;
      }
    }
  }

  return {
    sourceRef: primarySource,
    entityRef: entity.ref,
    ...(projectionRef ? { projectionRef } : {}),
  };
}

/**
 * Look up an entity by ref and build its trace entry.
 *
 * @param model - The semantic model to look up the entity.
 * @param entityRef - The entity ref to trace.
 * @param blockToEntityRef - Optional projection map for the projection leg.
 */
export function buildTraceChain(
  model: SemanticModel,
  entityRef: EntityRef,
  blockToEntityRef?: ReadonlyMap<string, EntityRef>,
): TraceEntry | undefined {
  const entity = model.entity(entityRef);
  if (!entity) return undefined;
  return buildTraceEntry(entity, blockToEntityRef);
}
