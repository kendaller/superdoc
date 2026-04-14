import { DATA_ATTRS, DATASET_KEYS } from '@superdoc/dom-contract';
import type { V2EditableParagraph } from './V2EditableDocumentSnapshot.js';
import { V2EditableIndex } from './V2EditableIndex.js';
import { resolveOffsetFromCharacterBoxes, type CharacterBox } from './V2GeometryHitTesting.js';
import type { V2ResolvedTextPosition } from './V2EditingTypes.js';

type DomPoint = {
  readonly node: Node;
  readonly offset: number;
};

type DomEndpoint = {
  readonly element: HTMLElement;
  readonly textNode: Text;
  readonly offset: number;
};

export function resolveTextPositionFromClientPoint(
  container: HTMLElement,
  index: V2EditableIndex,
  clientX: number,
  clientY: number,
): V2ResolvedTextPosition | null {
  const doc = container.ownerDocument;
  const domPoint = getDomPointFromClientPoint(doc, clientX, clientY);
  if (domPoint) {
    const segmentElement = findSegmentElement(domPoint.node);
    if (segmentElement) {
      const paragraph = resolveParagraphForElement(segmentElement, index);
      if (!paragraph?.supported) {
        return null;
      }

      const segmentStart = parseDatasetNumber(segmentElement, DATASET_KEYS.SD_SEGMENT_START);
      const segmentEnd = parseDatasetNumber(segmentElement, DATASET_KEYS.SD_SEGMENT_END);
      if (segmentStart == null || segmentEnd == null) {
        return null;
      }

      const offsetWithinElement = clampOffset(
        measureOffsetWithinElement(segmentElement, domPoint.node, domPoint.offset),
        segmentEnd - segmentStart,
      );

      return index.resolveParagraphOffset(paragraph, segmentStart + offsetWithinElement, 'forward');
    }
  }

  const fallbackElement = doc.elementFromPoint(clientX, clientY);
  if (!(fallbackElement instanceof HTMLElement)) {
    return null;
  }

  const paragraph = resolveParagraphForElement(fallbackElement, index);
  if (!paragraph?.supported) {
    return null;
  }

  return resolveTextPositionWithinParagraph(container, index, paragraph, clientX, clientY);
}

export function resolveParagraphOffsetFromClientPoint(
  container: HTMLElement,
  paragraph: V2EditableParagraph,
  clientX: number,
  clientY: number,
): number | null {
  return resolveParagraphCaretTarget(container, paragraph, clientX, clientY)?.offset ?? null;
}

export function computeCaretRect(container: HTMLElement, position: V2ResolvedTextPosition): DOMRect | null {
  const endpoint = resolveDomEndpoint(container, position);
  if (!endpoint) {
    return null;
  }

  const doc = container.ownerDocument;
  const range = doc.createRange();
  range.setStart(endpoint.textNode, endpoint.offset);
  range.collapse(true);

  const collapsedRect = range.getBoundingClientRect();
  if (hasVisibleRect(collapsedRect)) {
    return toLocalRect(collapsedRect, container);
  }

  const textLength = endpoint.textNode.textContent?.length ?? 0;
  if (endpoint.offset < textLength) {
    range.setEnd(endpoint.textNode, endpoint.offset + 1);
    const nextRect = range.getBoundingClientRect();
    if (hasVisibleRect(nextRect)) {
      return toLocalCaretRect(nextRect.left, nextRect.top, nextRect.height, container);
    }
  }

  if (endpoint.offset > 0) {
    range.setStart(endpoint.textNode, endpoint.offset - 1);
    range.setEnd(endpoint.textNode, endpoint.offset);
    const previousRect = range.getBoundingClientRect();
    if (hasVisibleRect(previousRect)) {
      return toLocalCaretRect(previousRect.right, previousRect.top, previousRect.height, container);
    }
  }

  const elementRect = endpoint.element.getBoundingClientRect();
  if (!hasVisibleRect(elementRect)) {
    return null;
  }

  return toLocalCaretRect(elementRect.left, elementRect.top, elementRect.height, container);
}

export function computeRangeRects(
  container: HTMLElement,
  start: V2ResolvedTextPosition,
  end: V2ResolvedTextPosition,
): DOMRect[] {
  const startEndpoint = resolveDomEndpoint(container, start);
  const endEndpoint = resolveDomEndpoint(container, end);
  if (!startEndpoint || !endEndpoint) {
    return [];
  }

  const doc = container.ownerDocument;
  const range = doc.createRange();
  range.setStart(startEndpoint.textNode, startEndpoint.offset);
  range.setEnd(endEndpoint.textNode, endEndpoint.offset);

  return Array.from(range.getClientRects())
    .filter(hasVisibleRect)
    .map((rect) => toLocalRect(rect, container));
}

function resolveParagraphForElement(element: HTMLElement, index: V2EditableIndex): V2EditableParagraph | undefined {
  const blockElement = element.closest<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}]`);
  const blockId = blockElement?.dataset[DATASET_KEYS.BLOCK_ID];
  if (!blockId) {
    return undefined;
  }

  return index.paragraphByBlockId(blockId);
}

function resolveTextPositionWithinParagraph(
  container: HTMLElement,
  index: V2EditableIndex,
  paragraph: V2EditableParagraph,
  clientX: number,
  clientY: number,
): V2ResolvedTextPosition | null {
  const caretTarget = resolveParagraphCaretTarget(container, paragraph, clientX, clientY);
  if (!caretTarget) {
    return null;
  }

  return index.resolveParagraphOffset(paragraph, caretTarget.offset, caretTarget.affinity);
}

function resolveParagraphCaretTarget(
  container: HTMLElement,
  paragraph: V2EditableParagraph,
  clientX: number,
  clientY: number,
): { offset: number; affinity: 'backward' | 'forward' } | null {
  const blockElement = container.querySelector<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}="${paragraph.blockId}"]`);
  if (!blockElement) {
    return null;
  }

  const segmentElements = collectOrderedSegmentElements(blockElement);
  if (segmentElements.length === 0) {
    return null;
  }

  const characterBoxes = measureParagraphCharacterBoxes(segmentElements);
  const characterTarget = resolveOffsetFromCharacterBoxes(characterBoxes, clientX, clientY);
  if (characterTarget) {
    return characterTarget;
  }

  return resolveNearestSegmentBoundary(segmentElements, paragraph.text.length, clientX, clientY);
}

function resolveDomEndpoint(container: HTMLElement, position: V2ResolvedTextPosition): DomEndpoint | null {
  const blockElement = container.querySelector<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}="${position.blockId}"]`);
  if (!blockElement) {
    return null;
  }

  const segmentElements = Array.from(blockElement.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.SD_SEGMENT_ID}]`));
  const fragmentElement = chooseFragmentElement(segmentElements, position);
  if (!fragmentElement) {
    return null;
  }

  const fragmentStart = parseDatasetNumber(fragmentElement, DATASET_KEYS.SD_SEGMENT_START) ?? position.segmentStart;
  const fragmentEnd = parseDatasetNumber(fragmentElement, DATASET_KEYS.SD_SEGMENT_END) ?? position.segmentEnd;
  const textNode = findFirstTextNode(fragmentElement);
  if (!textNode) {
    return null;
  }

  const localOffset = resolveLocalOffsetForFragment(position.paragraphOffset, fragmentStart, fragmentEnd);

  return {
    element: fragmentElement,
    textNode,
    offset: clampOffset(localOffset, textNode.textContent?.length ?? 0),
  };
}

function chooseFragmentElement(
  segmentElements: readonly HTMLElement[],
  position: V2ResolvedTextPosition,
): HTMLElement | null {
  const matchingFragments = segmentElements.filter((element) => {
    if (element.dataset[DATASET_KEYS.SD_RUN_REF] !== position.runRef.id) {
      return false;
    }

    if (element.dataset[DATASET_KEYS.SD_SEGMENT_ID] !== position.segmentId) {
      return false;
    }

    const fragmentStart = parseDatasetNumber(element, DATASET_KEYS.SD_SEGMENT_START) ?? position.segmentStart;
    const fragmentEnd = parseDatasetNumber(element, DATASET_KEYS.SD_SEGMENT_END) ?? position.segmentEnd;

    if (position.paragraphOffset === position.paragraphLength) {
      return fragmentEnd === position.paragraphOffset;
    }

    return position.paragraphOffset >= fragmentStart && position.paragraphOffset < fragmentEnd;
  });

  if (matchingFragments.length === 0) {
    return null;
  }

  return matchingFragments.sort((left, right) => {
    const leftStart = parseDatasetNumber(left, DATASET_KEYS.SD_SEGMENT_START) ?? 0;
    const rightStart = parseDatasetNumber(right, DATASET_KEYS.SD_SEGMENT_START) ?? 0;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    if (leftRect.top !== rightRect.top) {
      return leftRect.top - rightRect.top;
    }

    return leftRect.left - rightRect.left;
  })[0];
}

function collectOrderedSegmentElements(blockElement: HTMLElement): HTMLElement[] {
  return Array.from(blockElement.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.SD_SEGMENT_ID}]`))
    .filter((element) => parseDatasetNumber(element, DATASET_KEYS.SD_SEGMENT_START) != null)
    .sort((left, right) => {
      const leftStart = parseDatasetNumber(left, DATASET_KEYS.SD_SEGMENT_START) ?? 0;
      const rightStart = parseDatasetNumber(right, DATASET_KEYS.SD_SEGMENT_START) ?? 0;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      if (leftRect.top !== rightRect.top) {
        return leftRect.top - rightRect.top;
      }

      return leftRect.left - rightRect.left;
    });
}

function measureParagraphCharacterBoxes(segmentElements: readonly HTMLElement[]): CharacterBox[] {
  const boxes: CharacterBox[] = [];

  for (const segmentElement of segmentElements) {
    const segmentStart = parseDatasetNumber(segmentElement, DATASET_KEYS.SD_SEGMENT_START);
    if (segmentStart == null) {
      continue;
    }

    let localOffset = 0;
    for (const textNode of collectTextNodes(segmentElement)) {
      const text = textNode.textContent ?? '';
      for (let index = 0; index < text.length; index += 1) {
        const rect = measureCharacterRect(textNode, index);
        if (!rect) {
          continue;
        }

        boxes.push({
          fromOffset: segmentStart + localOffset + index,
          toOffset: segmentStart + localOffset + index + 1,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        });
      }

      localOffset += text.length;
    }
  }

  return boxes;
}

function measureCharacterRect(textNode: Text, textOffset: number): DOMRectReadOnly | null {
  const doc = textNode.ownerDocument;
  const range = doc.createRange();
  range.setStart(textNode, textOffset);
  range.setEnd(textNode, textOffset + 1);

  const visibleRects = Array.from(range.getClientRects()).filter(hasVisibleRect);
  if (visibleRects.length > 0) {
    return combineRects(visibleRects);
  }

  const startCaretRect = measureCollapsedCaretRect(doc, textNode, textOffset);
  const endCaretRect = measureCollapsedCaretRect(doc, textNode, textOffset + 1);
  if (!startCaretRect && !endCaretRect) {
    return null;
  }

  if (startCaretRect && endCaretRect) {
    const left = Math.min(startCaretRect.left, endCaretRect.left);
    const right = Math.max(startCaretRect.left, endCaretRect.left, left + 1);
    const top = Math.min(startCaretRect.top, endCaretRect.top);
    const bottom = Math.max(startCaretRect.bottom, endCaretRect.bottom);
    return new DOMRectReadOnly(left, top, right - left, bottom - top);
  }

  const singleCaretRect = startCaretRect ?? endCaretRect;
  if (!singleCaretRect) {
    return null;
  }

  return new DOMRectReadOnly(singleCaretRect.left, singleCaretRect.top, 1, singleCaretRect.height);
}

function measureCollapsedCaretRect(doc: Document, textNode: Text, offset: number): DOMRectReadOnly | null {
  const range = doc.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);

  const visibleRect = Array.from(range.getClientRects()).find(hasVisibleRect);
  if (visibleRect) {
    return visibleRect;
  }

  const boundingRect = range.getBoundingClientRect();
  return hasVisibleRect(boundingRect) ? boundingRect : null;
}

function combineRects(rects: readonly DOMRect[] | readonly DOMRectReadOnly[]): DOMRectReadOnly {
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRectReadOnly(left, top, right - left, bottom - top);
}

function resolveNearestSegmentBoundary(
  segmentElements: readonly HTMLElement[],
  paragraphLength: number,
  clientX: number,
  clientY: number,
): { offset: number; affinity: 'backward' | 'forward' } | null {
  const nearestElement = findNearestSegmentElement(segmentElements, clientX, clientY);
  if (!nearestElement) {
    return null;
  }

  const nearestRect = nearestElement.getBoundingClientRect();
  const isBeforeMidpoint = clientX <= nearestRect.left + nearestRect.width / 2;
  const offset = isBeforeMidpoint
    ? (parseDatasetNumber(nearestElement, DATASET_KEYS.SD_SEGMENT_START) ?? 0)
    : (parseDatasetNumber(nearestElement, DATASET_KEYS.SD_SEGMENT_END) ?? paragraphLength);

  return {
    offset,
    affinity: isBeforeMidpoint ? 'backward' : 'forward',
  };
}

function findNearestSegmentElement(
  segmentElements: readonly HTMLElement[],
  clientX: number,
  clientY: number,
): HTMLElement | null {
  let nearest: HTMLElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  segmentElements.forEach((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(centerY - clientY) * 1000 + Math.abs(centerX - clientX);

    if (distance < nearestDistance) {
      nearest = element;
      nearestDistance = distance;
    }
  });

  return nearest;
}

function resolveLocalOffsetForFragment(paragraphOffset: number, fragmentStart: number, fragmentEnd: number): number {
  if (paragraphOffset <= fragmentStart) {
    return 0;
  }

  if (paragraphOffset >= fragmentEnd) {
    return fragmentEnd - fragmentStart;
  }

  return paragraphOffset - fragmentStart;
}

function getDomPointFromClientPoint(doc: Document, clientX: number, clientY: number): DomPoint | null {
  const docWithCaretPosition = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const caretPosition = docWithCaretPosition.caretPositionFromPoint?.(clientX, clientY);
  if (caretPosition) {
    return {
      node: caretPosition.offsetNode,
      offset: caretPosition.offset,
    };
  }

  const caretRange = docWithCaretPosition.caretRangeFromPoint?.(clientX, clientY);
  if (!caretRange) {
    return null;
  }

  return {
    node: caretRange.startContainer,
    offset: caretRange.startOffset,
  };
}

function findSegmentElement(node: Node): HTMLElement | null {
  const owner = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : (node.parentElement ?? null);
  return owner?.closest<HTMLElement>(`[${DATA_ATTRS.SD_SEGMENT_ID}]`) ?? null;
}

function measureOffsetWithinElement(element: HTMLElement, node: Node, offset: number): number {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    if (textNode === node) {
      return currentOffset + offset;
    }

    currentOffset += textNode.textContent?.length ?? 0;
  }

  return currentOffset;
}

function findFirstTextNode(element: HTMLElement): Text | null {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

function collectTextNodes(element: HTMLElement): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let currentNode = walker.nextNode();
  while (currentNode) {
    if (currentNode instanceof Text) {
      textNodes.push(currentNode);
    }
    currentNode = walker.nextNode();
  }

  return textNodes;
}

function parseDatasetNumber(element: HTMLElement, key: string): number | null {
  const value = element.dataset[key];
  if (value == null || value === '') {
    return null;
  }

  const numericValue = Number.parseInt(value, 10);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(Math.trunc(value), max));
}

function hasVisibleRect(rect: DOMRect | DOMRectReadOnly): boolean {
  return Number.isFinite(rect.width) && Number.isFinite(rect.height) && (rect.width > 0 || rect.height > 0);
}

function toLocalRect(rect: DOMRect | DOMRectReadOnly, container: HTMLElement): DOMRect {
  const containerRect = container.getBoundingClientRect();
  return new DOMRect(rect.left - containerRect.left, rect.top - containerRect.top, rect.width, rect.height);
}

function toLocalCaretRect(left: number, top: number, height: number, container: HTMLElement): DOMRect {
  const containerRect = container.getBoundingClientRect();
  return new DOMRect(left - containerRect.left, top - containerRect.top, 1, height);
}
