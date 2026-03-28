// ---------------------------------------------------------------------------
// Main projection entry point — walks the semantic model's entity graph
// and produces FlowBlock[] compatible with the layout engine.
//
// Dispatches to the individual projectors for paragraphs, tables, and
// sections. Content controls are treated as transparent wrappers (their
// children are projected directly). Preserved blocks are skipped.
// ---------------------------------------------------------------------------

import type { SemanticModel } from '../../model.js';
import type { Entity } from '../../entities/types.js';
import type { EntityRef } from '../../identity/types.js';
import type { FlowBlock } from './types.js';
import { createProjectionIdAllocator, type ProjectionIdAllocator } from './block-id.js';
import { projectParagraph } from './paragraph-projector.js';
import { projectTable } from './table-projector.js';
import { projectSection } from './section-projector.js';
import type { StyleResolver } from '../../resolve/style-resolver.js';
import {
  startProjectionSpan,
  recordBlocksProjected,
  markProjectionFirstWindowStart,
  markProjectionFirstWindowComplete,
} from '../../perf.js';

/** Options for the layout projection. */
export type ProjectOptions = {
  /** Prefix for generated block IDs. Defaults to "v2-". */
  prefix?: string;
  /** Style resolver for cascaded properties. If omitted, direct formatting only. */
  resolver?: StyleResolver;
  /** Abort signal for cooperative cancellation (checked after each body-child). */
  signal?: AbortSignal;
};

/**
 * Result of a layout projection. Contains the FlowBlock[] output plus
 * a projection map linking block IDs back to their source entity refs.
 * This map is the "projection ref" leg of the trace chain.
 */
export type ProjectionResult = {
  readonly blocks: FlowBlock[];
  /** Maps block IDs → source entity refs. The projection→entity leg of the trace chain. */
  readonly blockToEntityRef: ReadonlyMap<string, EntityRef>;
};

/**
 * Project the semantic model's main story to an array of FlowBlocks.
 *
 * Section breaks are emitted at their actual boundaries — after the
 * paragraph that carries the sectPr — not appended at the end.
 *
 * Returns a ProjectionResult with both the blocks and a map linking
 * block IDs → source entity refs (the projection leg of the trace chain).
 */
export function projectToFlowBlocks(model: SemanticModel, options?: ProjectOptions): ProjectionResult {
  markProjectionFirstWindowStart();
  const endProjection = startProjectionSpan();

  const prefix = options?.prefix ?? 'v2-';
  const ids = createProjectionIdAllocator(prefix);

  const mainStory = model.mainStory();
  if (!mainStory) {
    endProjection();
    recordBlocksProjected(0);
    markProjectionFirstWindowComplete(0);
    return { blocks: [], blockToEntityRef: ids.blockToEntityRef };
  }

  const sectionMap = buildSectionMap(model);
  const blockEntities = model.blockEntities(mainStory.ref);
  const blocks: FlowBlock[] = [];

  for (const entity of blockEntities) {
    if (options?.signal?.aborted) {
      endProjection();
      throw new DOMException('Aborted', 'AbortError');
    }

    projectEntity(entity, model, ids, blocks, options?.resolver);

    if (entity.kind === 'paragraph') {
      const raw = (entity as Entity<'paragraph'>).raw();
      if (raw.hasSectPr) {
        const sectionEntity = sectionMap.get(entity.ref.id);
        if (sectionEntity) {
          blocks.push(projectSection(sectionEntity, ids));
        }
      }
    }
  }

  // Handle the final section (body-level w:sectPr, not inside a paragraph)
  const allSections = model.sections();
  const inlineSectionIds = new Set(sectionMap.values());
  for (const section of allSections) {
    if (!inlineSectionIds.has(section)) {
      blocks.push(projectSection(section, ids));
    }
  }

  endProjection();
  recordBlocksProjected(blocks.length);
  markProjectionFirstWindowComplete(blocks.length);

  return { blocks, blockToEntityRef: ids.blockToEntityRef };
}

/**
 * Build a map from paragraph entity ref → section entity for paragraphs
 * that carry inline sectPr. This links sectPr-bearing paragraphs to
 * their corresponding section entities so breaks are emitted in-flow.
 */
function buildSectionMap(model: SemanticModel): Map<string, Entity<'section'>> {
  const map = new Map<string, Entity<'section'>>();
  const mainStory = model.mainStory();
  if (!mainStory) return map;

  const sections = model.sections();
  const paragraphs = model.blockEntities(mainStory.ref).filter((e) => e.kind === 'paragraph');

  // Sections are derived from sectPr elements. Inline sectPr lives inside
  // a paragraph's pPr. Match section entities to their owning paragraphs
  // by checking which paragraphs have hasSectPr=true, in order.
  const sectPrParagraphs = paragraphs.filter((p) => (p as Entity<'paragraph'>).raw().hasSectPr);

  for (let i = 0; i < Math.min(sectPrParagraphs.length, sections.length); i++) {
    map.set(sectPrParagraphs[i].ref.id, sections[i]);
  }

  return map;
}

// ---- Entity dispatch --------------------------------------------------------

/**
 * Project a single entity into one or more FlowBlocks, appending to the
 * output array. Handles transparent wrappers (contentControl) by recursing
 * into their children.
 */
function projectEntity(
  entity: Entity,
  model: SemanticModel,
  ids: ProjectionIdAllocator,
  output: FlowBlock[],
  resolver?: StyleResolver,
): void {
  switch (entity.kind) {
    case 'paragraph':
      output.push(projectParagraph(entity as Entity<'paragraph'>, model, ids, resolver));
      break;

    case 'table':
      output.push(projectTable(entity as Entity<'table'>, model, ids, resolver));
      break;

    case 'contentControl': {
      // Transparent wrapper: project children directly
      const children = model.blockEntities(entity.ref);
      for (const child of children) {
        projectEntity(child, model, ids, output, resolver);
      }
      break;
    }

    case 'preservedBlock':
    case 'drawing':
      // Skip — no layout representation yet
      break;

    default:
      break;
  }
}
