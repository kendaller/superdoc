// ---------------------------------------------------------------------------
// V2 Targeting Helpers
//
// Convenience functions for resolving semantic entities from projection
// results. These help product code, tests, and demos target entities
// without reimplementing semantic lookup logic.
//
// All helpers operate on the current state of the semantic model and
// the latest projection result — they are read-only and stateless.
// ---------------------------------------------------------------------------

import type {
  SemanticModel,
  EntityRef,
  Entity,
  ParagraphEntity,
  RunEntity,
  ProjectionResult,
} from '@superdoc/v2-model';
import { segmentsToText } from '@superdoc/v2-model';

// ---- Paragraph helpers ------------------------------------------------------

/** Get all paragraph entities in the main story. */
export function getMainStoryParagraphs(model: SemanticModel): ParagraphEntity[] {
  const mainStory = model.mainStory();
  if (!mainStory) return [];

  return model.blockEntities(mainStory.ref).filter((entity): entity is ParagraphEntity => entity.kind === 'paragraph');
}

/** Get a paragraph entity by its block ID from the latest projection. */
export function findParagraphByBlockId(
  blockId: string,
  model: SemanticModel,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): ParagraphEntity | undefined {
  const entityRef = blockToEntityRef.get(blockId);
  if (!entityRef) return undefined;

  const entity = model.entity(entityRef);
  if (!entity || entity.kind !== 'paragraph') return undefined;

  return entity as ParagraphEntity;
}

/** Get the first run entity of a paragraph. */
export function findFirstRun(paragraphRef: EntityRef, model: SemanticModel): RunEntity | undefined {
  const runs = model.runs(paragraphRef);
  return runs[0];
}

/** Get the visible text content of a paragraph. */
export function getParagraphText(paragraphRef: EntityRef, model: SemanticModel): string {
  const runs = model.runs(paragraphRef);
  return runs.map((run) => segmentsToText(model.segments(run.ref))).join('');
}

// ---- Block-to-entity helpers ------------------------------------------------

/** Resolve an entity ref from a block ID using the projection's block-to-entity map. */
export function resolveEntityRef(
  blockId: string,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): EntityRef | undefined {
  return blockToEntityRef.get(blockId);
}

/** Get all block IDs that map to a given entity ref. */
export function findBlockIdsForEntity(
  entityRef: EntityRef,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): string[] {
  const results: string[] = [];
  for (const [blockId, ref] of blockToEntityRef) {
    if (ref.id === entityRef.id) {
      results.push(blockId);
    }
  }
  return results;
}

// ---- Run helpers ------------------------------------------------------------

/** Check whether a paragraph has exactly one editable text run (safe for overlay editing). */
export function isSingleRunParagraph(paragraphRef: EntityRef, model: SemanticModel): boolean {
  const runs = model.runs(paragraphRef);
  if (runs.length !== 1) return false;

  const segments = model.segments(runs[0].ref);
  return segments.every(
    (seg) => seg.segmentKind === 'text' || seg.segmentKind === 'tab' || seg.segmentKind === 'break',
  );
}
