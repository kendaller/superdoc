// ---------------------------------------------------------------------------
// V2 Inline Target Resolver
//
// Resolves pointer events to native v2 inline positions (StoryPosition).
// Reads data-sd-* attributes stamped by DomPainter and normalizes them
// into V2PositionHit results.
//
// Phase 2B deliverable — builds on Phase 2A block targeting by adding
// segment-level resolution within a paragraph.
// ---------------------------------------------------------------------------

import { DATASET_KEYS } from '@superdoc/dom-contract';
import type { EntityRef, StoryPosition, SemanticModel } from '@superdoc/v2-model';
import { createStoryPosition } from '@superdoc/v2-model';
import type { V2PositionHit, V2SegmentTarget } from './types.js';

// ---- Resolver ---------------------------------------------------------------

/**
 * Resolve pointer events to native v2 inline positions.
 *
 * Uses data-sd-* attributes and DOM text measurement to determine the
 * exact character position the user clicked.
 */
export class V2InlineTargetResolver {
  readonly #model: SemanticModel;
  #blockToEntityRef: ReadonlyMap<string, EntityRef>;

  constructor(model: SemanticModel, blockToEntityRef: ReadonlyMap<string, EntityRef>) {
    this.#model = model;
    this.#blockToEntityRef = blockToEntityRef;
  }

  /** Update projection maps after rerender. */
  updateProjection(blockToEntityRef: ReadonlyMap<string, EntityRef>): void {
    this.#blockToEntityRef = blockToEntityRef;
  }

  /** Resolve a pointer event to a V2PositionHit. Returns null if not resolvable. */
  resolveFromEvent(event: MouseEvent | PointerEvent): V2PositionHit | null {
    const element = event.target;
    if (!(element instanceof HTMLElement)) return null;

    return this.resolveFromPoint(element, event.clientX, event.clientY);
  }

  /**
   * Resolve a specific point within an element to a V2PositionHit.
   *
   * Walks up the DOM to find block and segment metadata, then uses
   * Range-based measurement to determine character offset.
   */
  resolveFromPoint(element: HTMLElement, clientX: number, clientY: number): V2PositionHit | null {
    // Walk up to find block context
    const blockContext = findBlockContext(element);
    if (!blockContext) return null;

    const { blockId, blockElement } = blockContext;
    const entityRef = this.#blockToEntityRef.get(blockId);
    if (!entityRef) return null;

    // Try to find inline segment context
    const segmentContext = findSegmentContext(element);
    const segmentTarget = segmentContext
      ? resolveCharOffset(segmentContext.element, clientX, clientY, segmentContext)
      : undefined;

    // Build story position
    const storyPosition = this.#buildStoryPosition(entityRef, segmentTarget);

    // Determine page index from block element position
    const pageIndex = resolvePageIndex(blockElement);

    return {
      kind: 'v2',
      blockId,
      entityRef,
      storyPosition,
      segmentTarget,
      geometry: { pageIndex, x: clientX, y: clientY },
    };
  }

  #buildStoryPosition(entityRef: EntityRef, segmentTarget?: V2SegmentTarget): StoryPosition | undefined {
    const entity = this.#model.entity(entityRef);
    if (!entity) return undefined;

    const storyId = entity.storyId;
    if (!storyId) return undefined;

    if (segmentTarget) {
      return createStoryPosition(
        storyId,
        entityRef,
        parseInt(segmentTarget.segmentId, 10) || 0,
        segmentTarget.charOffset,
      );
    }

    return createStoryPosition(storyId, entityRef);
  }
}

// ---- DOM walking helpers ----------------------------------------------------

type BlockContext = {
  blockId: string;
  blockElement: HTMLElement;
};

type SegmentContext = {
  element: HTMLElement;
  segmentId: string;
  segmentStart: number;
  segmentEnd: number;
};

function findBlockContext(element: HTMLElement): BlockContext | null {
  const MAX_DEPTH = 20;
  let current: HTMLElement | null = element;

  for (let i = 0; i < MAX_DEPTH && current; i++) {
    const blockId = current.dataset[DATASET_KEYS.BLOCK_ID];
    if (blockId) {
      return { blockId, blockElement: current };
    }
    current = current.parentElement;
  }

  return null;
}

function findSegmentContext(element: HTMLElement): SegmentContext | null {
  const MAX_DEPTH = 10;
  let current: HTMLElement | null = element;

  for (let i = 0; i < MAX_DEPTH && current; i++) {
    const segmentId = current.dataset[DATASET_KEYS.SD_SEGMENT_ID];
    if (segmentId) {
      return {
        element: current,
        segmentId,
        segmentStart: parseInt(current.dataset[DATASET_KEYS.SD_SEGMENT_START] ?? '0', 10),
        segmentEnd: parseInt(current.dataset[DATASET_KEYS.SD_SEGMENT_END] ?? '0', 10),
      };
    }
    current = current.parentElement;
  }

  return null;
}

// ---- Character offset resolution --------------------------------------------

/**
 * Resolve the character offset at a given point within a text element.
 *
 * Uses the browser's Range API to measure character positions and find
 * the closest character boundary to the click point.
 */
function resolveCharOffset(
  element: HTMLElement,
  clientX: number,
  _clientY: number,
  context: SegmentContext,
): V2SegmentTarget | undefined {
  const textNode = findTextNode(element);
  if (!textNode || !textNode.textContent) {
    return { segmentId: context.segmentId, charOffset: 0 };
  }

  const text = textNode.textContent;
  const range = document.createRange();

  // Binary search for the character boundary closest to clientX
  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    range.setStart(textNode, mid);
    range.setEnd(textNode, mid + 1);
    const rect = range.getBoundingClientRect();

    if (clientX < rect.left + rect.width / 2) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return { segmentId: context.segmentId, charOffset: low };
}

/** Find the first text node within an element. */
function findTextNode(element: HTMLElement): Text | null {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      return child as Text;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const found = findTextNode(child as HTMLElement);
      if (found) return found;
    }
  }
  return null;
}

/** Determine the page index from a block element's DOM position. */
function resolvePageIndex(element: HTMLElement): number {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.classList.contains('superdoc-page')) {
      const index = current.dataset['pageIndex'];
      return index ? parseInt(index, 10) : 0;
    }
    current = current.parentElement;
  }
  return 0;
}
