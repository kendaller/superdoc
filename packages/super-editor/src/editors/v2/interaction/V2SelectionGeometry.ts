// ---------------------------------------------------------------------------
// V2 Selection Geometry
//
// Computes caret rectangles and selection highlight rectangles from
// native v2 positions, without depending on PM positions.
//
// Phase 2C deliverable — provides the geometry foundation that editor-side
// selection rendering consumes.
// ---------------------------------------------------------------------------

import { DATA_ATTRS, DATASET_KEYS } from '@superdoc/dom-contract';
import type { EntityRef, StoryPosition, StoryRange } from '@superdoc/v2-model';
import type { V2SelectionRectsRequest } from './types.js';

// ---- Public API -------------------------------------------------------------

/** Result of computing selection rectangles. */
export type SelectionRectsResult = {
  readonly rects: DOMRect[];
};

/**
 * Compute selection/caret rectangles for v2 selection requests.
 *
 * Works by reading painted DOM elements that carry v2 data attributes.
 * The host element is the root container where pages are rendered.
 */
export function computeSelectionRects(
  request: V2SelectionRectsRequest,
  hostElement: HTMLElement,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): SelectionRectsResult {
  switch (request.kind) {
    case 'block':
      return computeBlockRects(request.blockId, hostElement);
    case 'entity':
      return computeEntityRects(request.entityRef, hostElement, blockToEntityRef);
    case 'storyRange':
      return computeStoryRangeRects(request.range, hostElement, blockToEntityRef);
  }
}

/**
 * Compute a caret rectangle at a specific story position.
 *
 * Returns a zero-width rect at the character boundary if resolvable,
 * or the block's leading edge as a fallback.
 */
export function computeCaretRect(
  position: StoryPosition,
  hostElement: HTMLElement,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): DOMRect | null {
  // Find block element for this entity
  const blockId = findBlockIdForEntity(position.entityRef, blockToEntityRef);
  if (!blockId) return null;

  const blockElement = findBlockElementById(blockId, hostElement);
  if (!blockElement) return null;

  // If we have segment-level position, try to resolve exact character position
  if (position.segmentIndex !== undefined && position.charOffset !== undefined) {
    const segmentElements = Array.from(blockElement.querySelectorAll(`[${DATA_ATTRS.SD_SEGMENT_ID}]`));

    for (const segEl of segmentElements) {
      const segId = (segEl as HTMLElement).dataset[DATASET_KEYS.SD_SEGMENT_ID];
      if (segId === String(position.segmentIndex)) {
        const caretRect = computeCharacterCaretRect(segEl as HTMLElement, position.charOffset);
        if (caretRect) return caretRect;
      }
    }
  }

  // Fallback: use the block element's leading edge
  const blockRect = blockElement.getBoundingClientRect();
  return new DOMRect(blockRect.left, blockRect.top, 1, blockRect.height);
}

// ---- Block rects ------------------------------------------------------------

function computeBlockRects(blockId: string, hostElement: HTMLElement): SelectionRectsResult {
  const blockElement = findBlockElementById(blockId, hostElement);
  if (!blockElement) return { rects: [] };

  return { rects: [blockElement.getBoundingClientRect()] };
}

// ---- Entity rects -----------------------------------------------------------

function computeEntityRects(
  entityRef: EntityRef,
  hostElement: HTMLElement,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): SelectionRectsResult {
  const blockId = findBlockIdForEntity(entityRef, blockToEntityRef);
  if (!blockId) return { rects: [] };

  return computeBlockRects(blockId, hostElement);
}

// ---- Story range rects ------------------------------------------------------

function computeStoryRangeRects(
  range: StoryRange,
  hostElement: HTMLElement,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): SelectionRectsResult {
  const startBlockId = findBlockIdForEntity(range.start.entityRef, blockToEntityRef);
  const endBlockId = findBlockIdForEntity(range.end.entityRef, blockToEntityRef);

  if (!startBlockId || !endBlockId) return { rects: [] };

  // Same block: compute inline rects
  if (startBlockId === endBlockId) {
    const blockElement = findBlockElementById(startBlockId, hostElement);
    if (!blockElement) return { rects: [] };
    return { rects: [blockElement.getBoundingClientRect()] };
  }

  // Cross-block: collect all block rects between start and end
  const allBlockElements = Array.from(hostElement.querySelectorAll(`[data-block-id]`));
  const rects: DOMRect[] = [];
  let collecting = false;

  for (const el of allBlockElements) {
    const id = (el as HTMLElement).dataset[DATASET_KEYS.BLOCK_ID];

    if (id === startBlockId) {
      collecting = true;
    }

    if (collecting) {
      rects.push(el.getBoundingClientRect());
    }

    if (id === endBlockId) {
      break;
    }
  }

  return { rects };
}

// ---- Character caret rect ---------------------------------------------------

function computeCharacterCaretRect(segmentElement: HTMLElement, charOffset: number): DOMRect | null {
  const textNode = findFirstTextNode(segmentElement);
  if (!textNode || !textNode.textContent) return null;

  const clampedOffset = Math.min(charOffset, textNode.textContent.length);

  const range = document.createRange();
  if (clampedOffset < textNode.textContent.length) {
    range.setStart(textNode, clampedOffset);
    range.setEnd(textNode, clampedOffset + 1);
    const rect = range.getBoundingClientRect();
    return new DOMRect(rect.left, rect.top, 1, rect.height);
  }

  // At end of text — position caret at trailing edge
  if (textNode.textContent.length > 0) {
    range.setStart(textNode, textNode.textContent.length - 1);
    range.setEnd(textNode, textNode.textContent.length);
    const rect = range.getBoundingClientRect();
    return new DOMRect(rect.right, rect.top, 1, rect.height);
  }

  return null;
}

// ---- DOM helpers ------------------------------------------------------------

function findBlockElementById(blockId: string, hostElement: HTMLElement): HTMLElement | null {
  return hostElement.querySelector(`[data-block-id="${blockId}"]`);
}

function findBlockIdForEntity(
  entityRef: EntityRef,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): string | undefined {
  for (const [blockId, ref] of blockToEntityRef) {
    if (ref.id === entityRef.id) {
      return blockId;
    }
  }
  return undefined;
}

function findFirstTextNode(element: HTMLElement): Text | null {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      return child as Text;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const found = findFirstTextNode(child as HTMLElement);
      if (found) return found;
    }
  }
  return null;
}
