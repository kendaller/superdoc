/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_ATTRS } from '@superdoc/dom-contract';
import type { V2EditableDocumentSnapshot, V2EditableParagraph } from './V2EditableDocumentSnapshot.js';
import { V2EditableIndex } from './V2EditableIndex.js';
import {
  computeCaretRect,
  resolveParagraphOffsetFromClientPoint,
  resolveTextPositionFromClientPoint,
} from './V2EditingDom.js';

type MutableCaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  elementFromPoint?: (x: number, y: number) => Element | null;
};

describe('V2EditingDom', () => {
  const originalGetClientRects = Range.prototype.getClientRects;
  const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;
  const originalElementFromPoint = (document as MutableCaretDocument).elementFromPoint;
  const originalCaretPositionFromPoint = (document as MutableCaretDocument).caretPositionFromPoint;
  const originalCaretRangeFromPoint = (document as MutableCaretDocument).caretRangeFromPoint;

  afterEach(() => {
    Range.prototype.getClientRects = originalGetClientRects;
    Range.prototype.getBoundingClientRect = originalGetBoundingClientRect;

    if (originalElementFromPoint) {
      (document as MutableCaretDocument).elementFromPoint = originalElementFromPoint;
    } else {
      delete (document as MutableCaretDocument).elementFromPoint;
    }

    if (originalCaretPositionFromPoint) {
      (document as MutableCaretDocument).caretPositionFromPoint = originalCaretPositionFromPoint;
    } else {
      delete (document as MutableCaretDocument).caretPositionFromPoint;
    }

    if (originalCaretRangeFromPoint) {
      (document as MutableCaretDocument).caretRangeFromPoint = originalCaretRangeFromPoint;
    } else {
      delete (document as MutableCaretDocument).caretRangeFromPoint;
    }

    document.body.innerHTML = '';
  });

  it('uses character geometry when browser caret APIs cannot resolve the paragraph click', () => {
    const paragraph = createParagraph();
    const index = new V2EditableIndex(createSnapshot(paragraph));
    const container = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute(DATA_ATTRS.BLOCK_ID, paragraph.blockId);

    const segment = document.createElement('span');
    segment.setAttribute(DATA_ATTRS.SD_SEGMENT_ID, 'segment-1');
    segment.setAttribute(DATA_ATTRS.SD_SEGMENT_START, '0');
    segment.setAttribute(DATA_ATTRS.SD_SEGMENT_END, '6');
    segment.textContent = 'abcdef';
    block.appendChild(segment);
    container.appendChild(block);
    document.body.appendChild(container);

    const textNode = segment.firstChild as Text;
    const characterRects = new Map<number, DOMRect>([
      [0, new DOMRect(10, 10, 10, 10)],
      [1, new DOMRect(20, 10, 10, 10)],
      [2, new DOMRect(30, 10, 10, 10)],
      [3, new DOMRect(10, 30, 10, 10)],
      [4, new DOMRect(20, 30, 10, 10)],
      [5, new DOMRect(30, 30, 10, 10)],
    ]);

    installCharacterRectMock(textNode, characterRects);
    block.getBoundingClientRect = () => new DOMRect(10, 10, 30, 30);
    segment.getBoundingClientRect = () => new DOMRect(10, 10, 30, 30);

    (document as MutableCaretDocument).caretPositionFromPoint = () => null;
    (document as MutableCaretDocument).caretRangeFromPoint = () => null;
    (document as MutableCaretDocument).elementFromPoint = () => segment;

    expect(resolveParagraphOffsetFromClientPoint(container, paragraph, 12, 12)).toBe(0);
    expect(resolveParagraphOffsetFromClientPoint(container, paragraph, 38, 12)).toBe(3);
    expect(resolveParagraphOffsetFromClientPoint(container, paragraph, 12, 34)).toBe(3);
    expect(resolveParagraphOffsetFromClientPoint(container, paragraph, 38, 34)).toBe(6);

    expect(resolveTextPositionFromClientPoint(container, index, 12, 12)?.paragraphOffset).toBe(0);
    expect(resolveTextPositionFromClientPoint(container, index, 38, 12)?.paragraphOffset).toBe(3);
    expect(resolveTextPositionFromClientPoint(container, index, 12, 34)?.paragraphOffset).toBe(3);
    expect(resolveTextPositionFromClientPoint(container, index, 38, 34)?.paragraphOffset).toBe(6);
  });

  it('uses the later fragment when a caret lands on a wrapped fragment boundary', () => {
    const paragraph = createParagraph();
    const index = new V2EditableIndex(createSnapshot(paragraph));
    const position = index.resolveParagraphOffset(paragraph, 3, 'forward');
    expect(position).not.toBeNull();

    const container = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute(DATA_ATTRS.BLOCK_ID, paragraph.blockId);

    const firstFragment = document.createElement('span');
    firstFragment.setAttribute(DATA_ATTRS.SD_RUN_REF, 'run-1');
    firstFragment.setAttribute(DATA_ATTRS.SD_SEGMENT_ID, 'segment-1');
    firstFragment.setAttribute(DATA_ATTRS.SD_SEGMENT_START, '0');
    firstFragment.setAttribute(DATA_ATTRS.SD_SEGMENT_END, '3');
    firstFragment.textContent = 'abc';

    const secondFragment = document.createElement('span');
    secondFragment.setAttribute(DATA_ATTRS.SD_RUN_REF, 'run-1');
    secondFragment.setAttribute(DATA_ATTRS.SD_SEGMENT_ID, 'segment-1');
    secondFragment.setAttribute(DATA_ATTRS.SD_SEGMENT_START, '3');
    secondFragment.setAttribute(DATA_ATTRS.SD_SEGMENT_END, '6');
    secondFragment.textContent = 'def';

    block.append(firstFragment, secondFragment);
    container.appendChild(block);
    document.body.appendChild(container);

    const firstTextNode = firstFragment.firstChild as Text;
    const secondTextNode = secondFragment.firstChild as Text;
    firstFragment.getBoundingClientRect = () => new DOMRect(10, 10, 30, 10);
    secondFragment.getBoundingClientRect = () => new DOMRect(10, 30, 30, 10);

    Range.prototype.getClientRects = function getClientRects(): DOMRectList {
      if (
        this.startContainer === secondTextNode &&
        this.endContainer === secondTextNode &&
        this.startOffset === 0 &&
        this.endOffset === 1
      ) {
        return [new DOMRect(10, 30, 10, 10)] as unknown as DOMRectList;
      }

      if (
        this.startContainer === firstTextNode &&
        this.endContainer === firstTextNode &&
        this.startOffset === 2 &&
        this.endOffset === 3
      ) {
        return [new DOMRect(30, 10, 10, 10)] as unknown as DOMRectList;
      }

      return [] as unknown as DOMRectList;
    };

    Range.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      const rects = Array.from(this.getClientRects());
      return rects[0] ?? new DOMRect(0, 0, 0, 0);
    };

    const caretRect = computeCaretRect(container, position!);

    expect(caretRect?.top).toBe(30);
    expect(caretRect?.left).toBe(10);
  });
});

function installCharacterRectMock(textNode: Text, rectsByCharacterOffset: ReadonlyMap<number, DOMRect>): void {
  Range.prototype.getClientRects = function getClientRects(): DOMRectList {
    if (this.startContainer !== textNode || this.endContainer !== textNode) {
      return [] as unknown as DOMRectList;
    }

    if (this.endOffset !== this.startOffset + 1) {
      return [] as unknown as DOMRectList;
    }

    const rect = rectsByCharacterOffset.get(this.startOffset);
    return rect ? ([rect] as unknown as DOMRectList) : ([] as unknown as DOMRectList);
  };

  Range.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    const rects = Array.from(this.getClientRects());
    return rects[0] ?? new DOMRect(0, 0, 0, 0);
  };
}

function createSnapshot(paragraph: V2EditableParagraph): V2EditableDocumentSnapshot {
  return {
    blockToEntityRef: new Map([[paragraph.blockId, paragraph.paragraphRef]]),
    paragraphsByBlockId: new Map([[paragraph.blockId, paragraph]]),
    orderedParagraphs: [paragraph],
  };
}

function createParagraph(): V2EditableParagraph {
  return {
    blockId: 'block-1',
    storyId: 'story-1',
    paragraphRef: { id: 'paragraph-1' },
    paragraphSourceRef: { partUri: '/word/document.xml', nodeId: 'paragraph-node-1' },
    text: 'abcdef',
    supported: true,
    segments: [
      {
        runRef: { id: 'run-1' },
        runSourceRef: { partUri: '/word/document.xml', nodeId: 'run-node-1' },
        runIndex: 0,
        segmentIndex: 0,
        segmentId: 'segment-1',
        text: 'abcdef',
        paragraphStart: 0,
        paragraphEnd: 6,
        runTextStart: 0,
        runTextEnd: 6,
      },
    ],
  };
}
