import { describe, expect, it } from 'vitest';
import { V2EditableIndex } from './V2EditableIndex.js';
import type { V2EditableDocumentSnapshot, V2EditableParagraph } from './V2EditableDocumentSnapshot.js';

describe('V2EditableIndex', () => {
  it('resolves paragraphs by exact source path and by node-id fallback', () => {
    const paragraph = createParagraph();
    const index = new V2EditableIndex(createSnapshot(paragraph));

    expect(index.paragraphBySourceRef(paragraph.paragraphSourceRef)?.blockId).toBe(paragraph.blockId);
    expect(
      index.paragraphBySourceRef({
        partUri: paragraph.paragraphSourceRef.partUri,
        nodeId: 'different-session-node-id',
        sourceNodePath: paragraph.paragraphSourceRef.sourceNodePath,
      })?.blockId,
    ).toBe(paragraph.blockId);
    expect(
      index.paragraphBySourceRef({
        partUri: paragraph.paragraphSourceRef.partUri,
        nodeId: paragraph.paragraphSourceRef.nodeId,
      })?.blockId,
    ).toBe(paragraph.blockId);
  });
});

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
    paragraphSourceRef: {
      partUri: '/word/document.xml',
      nodeId: 'paragraph-node-1',
      sourceNodePath: 'w:body/w:p[1]',
    },
    text: 'Hello world',
    supported: true,
    segments: [
      {
        runRef: { id: 'run-1' },
        runSourceRef: {
          partUri: '/word/document.xml',
          nodeId: 'run-node-1',
          sourceNodePath: 'w:body/w:p[1]/w:r[1]',
        },
        runIndex: 0,
        segmentIndex: 0,
        segmentId: 'segment-1',
        text: 'Hello world',
        paragraphStart: 0,
        paragraphEnd: 11,
        runTextStart: 0,
        runTextEnd: 11,
        segmentKind: 'text',
        isMutableText: true,
      },
    ],
  };
}
