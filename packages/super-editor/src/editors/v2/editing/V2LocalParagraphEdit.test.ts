import { describe, expect, it } from 'vitest';
import { V2EditableIndex } from './V2EditableIndex.js';
import type { V2EditableDocumentSnapshot, V2EditableParagraph } from './V2EditableDocumentSnapshot.js';
import type { V2ResolvedSelection } from './V2EditingTypes.js';
import {
  planLocalParagraphDeleteBackward,
  planLocalParagraphDeleteForward,
  planLocalParagraphTextInsertion,
} from './V2LocalParagraphEdit.js';

function createParagraph(blockId: string, text: string): V2EditableParagraph {
  return {
    blockId,
    storyId: 'story-1',
    paragraphRef: { id: `${blockId}-paragraph` },
    paragraphSourceRef: { partUri: '/word/document.xml', nodeId: `${blockId}-node` },
    text,
    supported: true,
    segments: [
      {
        segmentKind: 'text',
        isMutableText: true,
        runRef: { id: `${blockId}-run` },
        runSourceRef: { partUri: '/word/document.xml', nodeId: `${blockId}-run-node` },
        runIndex: 0,
        segmentIndex: 0,
        segmentId: `${blockId}-segment`,
        text,
        paragraphStart: 0,
        paragraphEnd: text.length,
        runTextStart: 0,
        runTextEnd: text.length,
      },
    ],
  };
}

function createIndex(paragraphs: readonly V2EditableParagraph[]): V2EditableIndex {
  const snapshot: V2EditableDocumentSnapshot = {
    blockToEntityRef: new Map(paragraphs.map((paragraph) => [paragraph.blockId, paragraph.paragraphRef])),
    paragraphsByBlockId: new Map(paragraphs.map((paragraph) => [paragraph.blockId, paragraph])),
    orderedParagraphs: [...paragraphs],
  };

  return new V2EditableIndex(snapshot);
}

function resolveCaret(index: V2EditableIndex, blockId: string, offset: number): V2ResolvedSelection {
  const paragraph = index.paragraphByBlockId(blockId)!;
  const position = index.resolveBySourceRef(paragraph.paragraphSourceRef, offset)!;
  return {
    kind: 'caret',
    anchor: position,
    focus: position,
  };
}

describe('V2LocalParagraphEdit', () => {
  it('plans same-paragraph insertion without touching neighboring paragraphs', () => {
    const index = createIndex([createParagraph('p1', 'Hello world'), createParagraph('p2', 'Second paragraph')]);

    const draft = planLocalParagraphTextInsertion(index, resolveCaret(index, 'p1', 5), ' brave');

    expect(draft).toMatchObject({
      blockId: 'p1',
      committedText: 'Hello world',
      nextText: 'Hello brave world',
      pendingSelection: {
        kind: 'caret',
        paragraphOffset: 11,
      },
    });
  });

  it('returns null for delete backward at the start of a paragraph', () => {
    const index = createIndex([createParagraph('p1', 'Hello world'), createParagraph('p2', 'Second paragraph')]);

    expect(planLocalParagraphDeleteBackward(index, resolveCaret(index, 'p2', 0))).toBeNull();
  });

  it('plans forward delete inside a paragraph using only local text state', () => {
    const index = createIndex([createParagraph('p1', 'Hello world')]);

    const draft = planLocalParagraphDeleteForward(index, resolveCaret(index, 'p1', 5));

    expect(draft).toMatchObject({
      blockId: 'p1',
      committedText: 'Hello world',
      nextText: 'Helloworld',
      pendingSelection: {
        kind: 'caret',
        paragraphOffset: 5,
      },
    });
  });
});
