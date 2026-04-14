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

type SegmentFragment = {
  readonly element: HTMLElement;
  readonly textNode: Text | null;
  readonly runRefId: string | null;
  readonly segmentId: string | null;
  readonly start: number;
  readonly end: number;
};

type ParagraphGeometry = {
  readonly blockElement: HTMLElement;
  readonly fragments: readonly SegmentFragment[];
  characterBoxes: CharacterBox[] | null;
};

export class V2EditingDomContext {
  readonly #container: HTMLElement;
  readonly #paragraphGeometryByBlockId = new Map<string, ParagraphGeometry>();

  constructor(container: HTMLElement) {
    this.#container = container;
  }

  invalidate(): void {
    this.#paragraphGeometryByBlockId.clear();
  }

  resolveTextPositionFromClientPoint(
    index: V2EditableIndex,
    clientX: number,
    clientY: number,
  ): V2ResolvedTextPosition | null {
    const doc = this.#container.ownerDocument;
    const domPoint = getDomPointFromClientPoint(doc, clientX, clientY);
    if (domPoint) {
      const segmentElement = findSegmentElement(domPoint.node);
      if (segmentElement) {
        const paragraph = resolveParagraphForElement(segmentElement, index);
        if (!paragraph?.supported) {
          return null;
        }

        const geometry = this.#geometryForParagraph(paragraph);
        const fragment = geometry ? findFragmentForElement(geometry.fragments, segmentElement) : null;
        const fragmentStart = fragment?.start ?? parseDatasetNumber(segmentElement, DATASET_KEYS.SD_SEGMENT_START);
        const fragmentEnd = fragment?.end ?? parseDatasetNumber(segmentElement, DATASET_KEYS.SD_SEGMENT_END);
        if (fragmentStart == null || fragmentEnd == null) {
          return null;
        }

        const offsetWithinElement = clampOffset(
          measureOffsetWithinElement(segmentElement, domPoint.node, domPoint.offset),
          fragmentEnd - fragmentStart,
        );

        return index.resolveParagraphOffset(paragraph, fragmentStart + offsetWithinElement, 'forward');
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

    return this.resolveTextPositionWithinParagraph(index, paragraph, clientX, clientY);
  }

  resolveParagraphOffsetFromClientPoint(
    paragraph: V2EditableParagraph,
    clientX: number,
    clientY: number,
  ): number | null {
    return this.resolveParagraphCaretTarget(paragraph, clientX, clientY)?.offset ?? null;
  }

  computeCaretRect(position: V2ResolvedTextPosition): DOMRect | null {
    const endpoint = this.resolveDomEndpoint(position);
    if (!endpoint) {
      return null;
    }

    const doc = this.#container.ownerDocument;
    const range = doc.createRange();
    range.setStart(endpoint.textNode, endpoint.offset);
    range.collapse(true);

    const collapsedRect = range.getBoundingClientRect();
    if (hasVisibleRect(collapsedRect)) {
      return toLocalRect(collapsedRect, this.#container);
    }

    const textLength = endpoint.textNode.textContent?.length ?? 0;
    if (endpoint.offset < textLength) {
      range.setEnd(endpoint.textNode, endpoint.offset + 1);
      const nextRect = range.getBoundingClientRect();
      if (hasVisibleRect(nextRect)) {
        return toLocalCaretRect(nextRect.left, nextRect.top, nextRect.height, this.#container);
      }
    }

    if (endpoint.offset > 0) {
      range.setStart(endpoint.textNode, endpoint.offset - 1);
      range.setEnd(endpoint.textNode, endpoint.offset);
      const previousRect = range.getBoundingClientRect();
      if (hasVisibleRect(previousRect)) {
        return toLocalCaretRect(previousRect.right, previousRect.top, previousRect.height, this.#container);
      }
    }

    const elementRect = endpoint.element.getBoundingClientRect();
    if (!hasVisibleRect(elementRect)) {
      return null;
    }

    return toLocalCaretRect(elementRect.left, elementRect.top, elementRect.height, this.#container);
  }

  computeRangeRects(start: V2ResolvedTextPosition, end: V2ResolvedTextPosition): DOMRect[] {
    const startEndpoint = this.resolveDomEndpoint(start);
    const endEndpoint = this.resolveDomEndpoint(end);
    if (!startEndpoint || !endEndpoint) {
      return [];
    }

    const doc = this.#container.ownerDocument;
    const range = doc.createRange();
    range.setStart(startEndpoint.textNode, startEndpoint.offset);
    range.setEnd(endEndpoint.textNode, endEndpoint.offset);

    return Array.from(range.getClientRects())
      .filter(hasVisibleRect)
      .map((rect) => toLocalRect(rect, this.#container));
  }

  private resolveTextPositionWithinParagraph(
    index: V2EditableIndex,
    paragraph: V2EditableParagraph,
    clientX: number,
    clientY: number,
  ): V2ResolvedTextPosition | null {
    const caretTarget = this.resolveParagraphCaretTarget(paragraph, clientX, clientY);
    if (!caretTarget) {
      return null;
    }

    return index.resolveParagraphOffset(paragraph, caretTarget.offset, caretTarget.affinity);
  }

  private resolveParagraphCaretTarget(
    paragraph: V2EditableParagraph,
    clientX: number,
    clientY: number,
  ): { offset: number; affinity: 'backward' | 'forward' } | null {
    const geometry = this.#geometryForParagraph(paragraph);
    if (!geometry || geometry.fragments.length === 0) {
      return null;
    }

    const characterBoxes = this.#characterBoxesForParagraph(geometry);
    const characterTarget = resolveOffsetFromCharacterBoxes(characterBoxes, clientX, clientY);
    if (characterTarget) {
      return characterTarget;
    }

    return resolveNearestSegmentBoundary(geometry.fragments, paragraph.text.length, clientX, clientY);
  }

  private resolveDomEndpoint(position: V2ResolvedTextPosition): DomEndpoint | null {
    const geometry = this.#geometryForBlockId(position.blockId);
    if (!geometry) {
      return null;
    }

    const fragment = chooseFragment(geometry.fragments, position);
    const textNode = fragment?.textNode;
    if (!fragment || !textNode) {
      return null;
    }

    const localOffset = resolveLocalOffsetForFragment(position.paragraphOffset, fragment.start, fragment.end);
    return {
      element: fragment.element,
      textNode,
      offset: clampOffset(localOffset, textNode.textContent?.length ?? 0),
    };
  }

  #geometryForParagraph(paragraph: V2EditableParagraph): ParagraphGeometry | null {
    return this.#geometryForBlockId(paragraph.blockId);
  }

  #geometryForBlockId(blockId: string): ParagraphGeometry | null {
    const cachedGeometry = this.#paragraphGeometryByBlockId.get(blockId);
    if (cachedGeometry && cachedGeometry.blockElement.isConnected) {
      return cachedGeometry;
    }

    const blockElement = this.#container.querySelector<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}="${blockId}"]`);
    if (!blockElement) {
      this.#paragraphGeometryByBlockId.delete(blockId);
      return null;
    }

    const geometry: ParagraphGeometry = {
      blockElement,
      fragments: collectSegmentFragments(blockElement),
      characterBoxes: null,
    };
    this.#paragraphGeometryByBlockId.set(blockId, geometry);
    return geometry;
  }

  #characterBoxesForParagraph(geometry: ParagraphGeometry): readonly CharacterBox[] {
    if (geometry.characterBoxes) {
      return geometry.characterBoxes;
    }

    geometry.characterBoxes = measureParagraphCharacterBoxes(geometry.fragments);
    return geometry.characterBoxes;
  }
}

export function resolveTextPositionFromClientPoint(
  container: HTMLElement,
  index: V2EditableIndex,
  clientX: number,
  clientY: number,
): V2ResolvedTextPosition | null {
  return new V2EditingDomContext(container).resolveTextPositionFromClientPoint(index, clientX, clientY);
}

export function resolveParagraphOffsetFromClientPoint(
  container: HTMLElement,
  paragraph: V2EditableParagraph,
  clientX: number,
  clientY: number,
): number | null {
  return new V2EditingDomContext(container).resolveParagraphOffsetFromClientPoint(paragraph, clientX, clientY);
}

export function computeCaretRect(container: HTMLElement, position: V2ResolvedTextPosition): DOMRect | null {
  return new V2EditingDomContext(container).computeCaretRect(position);
}

export function computeRangeRects(
  container: HTMLElement,
  start: V2ResolvedTextPosition,
  end: V2ResolvedTextPosition,
): DOMRect[] {
  return new V2EditingDomContext(container).computeRangeRects(start, end);
}

function resolveParagraphForElement(element: HTMLElement, index: V2EditableIndex): V2EditableParagraph | undefined {
  const blockElement = element.closest<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}]`);
  const blockId = blockElement?.dataset[DATASET_KEYS.BLOCK_ID];
  if (!blockId) {
    return undefined;
  }

  return index.paragraphByBlockId(blockId);
}

function chooseFragment(
  fragments: readonly SegmentFragment[],
  position: V2ResolvedTextPosition,
): SegmentFragment | null {
  const matchingFragments = fragments.filter((fragment) => {
    if (fragment.runRefId !== position.runRef.id) {
      return false;
    }

    if (fragment.segmentId !== position.segmentId) {
      return false;
    }

    if (position.paragraphOffset === position.paragraphLength) {
      return fragment.end === position.paragraphOffset;
    }

    return position.paragraphOffset >= fragment.start && position.paragraphOffset < fragment.end;
  });

  if (matchingFragments.length === 0) {
    return null;
  }

  return matchingFragments.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }

    const leftRect = left.element.getBoundingClientRect();
    const rightRect = right.element.getBoundingClientRect();
    if (leftRect.top !== rightRect.top) {
      return leftRect.top - rightRect.top;
    }

    return leftRect.left - rightRect.left;
  })[0];
}

function findFragmentForElement(fragments: readonly SegmentFragment[], element: HTMLElement): SegmentFragment | null {
  return fragments.find((fragment) => fragment.element === element) ?? null;
}

function collectSegmentFragments(blockElement: HTMLElement): SegmentFragment[] {
  return Array.from(blockElement.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.SD_SEGMENT_ID}]`))
    .map((element) => {
      const start = parseDatasetNumber(element, DATASET_KEYS.SD_SEGMENT_START);
      const end = parseDatasetNumber(element, DATASET_KEYS.SD_SEGMENT_END);
      if (start == null || end == null) {
        return null;
      }

      return {
        element,
        textNode: findFirstTextNode(element),
        runRefId: element.dataset[DATASET_KEYS.SD_RUN_REF] ?? null,
        segmentId: element.dataset[DATASET_KEYS.SD_SEGMENT_ID] ?? null,
        start,
        end,
      } satisfies SegmentFragment;
    })
    .filter((fragment): fragment is SegmentFragment => fragment != null)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      const leftRect = left.element.getBoundingClientRect();
      const rightRect = right.element.getBoundingClientRect();
      if (leftRect.top !== rightRect.top) {
        return leftRect.top - rightRect.top;
      }

      return leftRect.left - rightRect.left;
    });
}

function measureParagraphCharacterBoxes(fragments: readonly SegmentFragment[]): CharacterBox[] {
  const boxes: CharacterBox[] = [];

  for (const fragment of fragments) {
    if (fragment.textNode == null) {
      continue;
    }

    let localOffset = 0;
    for (const textNode of collectTextNodes(fragment.element)) {
      const text = textNode.textContent ?? '';
      for (let index = 0; index < text.length; index += 1) {
        const rect = measureCharacterRect(textNode, index);
        if (!rect) {
          continue;
        }

        boxes.push({
          fromOffset: fragment.start + localOffset + index,
          toOffset: fragment.start + localOffset + index + 1,
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
  fragments: readonly SegmentFragment[],
  paragraphLength: number,
  clientX: number,
  clientY: number,
): { offset: number; affinity: 'backward' | 'forward' } | null {
  const nearestFragment = findNearestFragment(fragments, clientX, clientY);
  if (!nearestFragment) {
    return null;
  }

  const nearestRect = nearestFragment.element.getBoundingClientRect();
  const isBeforeMidpoint = clientX <= nearestRect.left + nearestRect.width / 2;
  const offset = isBeforeMidpoint ? nearestFragment.start : (nearestFragment.end ?? paragraphLength);

  return {
    offset,
    affinity: isBeforeMidpoint ? 'backward' : 'forward',
  };
}

function findNearestFragment(
  fragments: readonly SegmentFragment[],
  clientX: number,
  clientY: number,
): SegmentFragment | null {
  let nearest: SegmentFragment | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  fragments.forEach((fragment) => {
    const rect = fragment.element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(centerY - clientY) * 1000 + Math.abs(centerX - clientX);

    if (distance < nearestDistance) {
      nearest = fragment;
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
