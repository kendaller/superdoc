import { describe, expect, it } from 'vitest';
import type { V2EditableParagraph } from './V2EditableDocumentSnapshot.js';
import { planParagraphTextEditForParagraph } from './V2MutationPlanner.js';

describe('V2MutationPlanner', () => {
  it('plans edits for multi-run paragraphs when the changed range only touches mutable text', () => {
    const paragraph = createParagraph({
      text: 'Hello world',
      segments: [
        createSegment({
          runId: 'run-1',
          segmentId: 'seg-1',
          text: 'Hello ',
          paragraphStart: 0,
          paragraphEnd: 6,
        }),
        createSegment({
          runId: 'run-2',
          segmentId: 'seg-2',
          text: 'world',
          paragraphStart: 6,
          paragraphEnd: 11,
        }),
      ],
    });

    const plannedEdit = planParagraphTextEditForParagraph(paragraph, 'Hello world', 'Hello brave world');

    expect(plannedEdit).not.toBeNull();
    expect(plannedEdit?.operations).toHaveLength(1);
    expect(plannedEdit?.operations[0]).toMatchObject({
      kind: 'insertText',
      target: { id: 'run-1' },
      text: 'brave ',
      position: {
        segmentIndex: 0,
        charOffset: 6,
      },
    });
  });

  it('plans edits adjacent to protected tab segments without allowing the tab itself to be rewritten', () => {
    const paragraph = createParagraph({
      text: 'Topic\t12',
      segments: [
        createSegment({
          runId: 'run-1',
          segmentId: 'seg-1',
          text: 'Topic',
          paragraphStart: 0,
          paragraphEnd: 5,
        }),
        createSegment({
          runId: 'run-1',
          segmentId: 'seg-tab',
          segmentKind: 'tab',
          isMutableText: false,
          text: '\t',
          paragraphStart: 5,
          paragraphEnd: 6,
          runTextStart: 5,
          runTextEnd: 5,
        }),
        createSegment({
          runId: 'run-2',
          segmentId: 'seg-2',
          text: '12',
          paragraphStart: 6,
          paragraphEnd: 8,
        }),
      ],
    });

    const plannedEdit = planParagraphTextEditForParagraph(paragraph, 'Topic\t12', 'Topic\t123');

    expect(plannedEdit).not.toBeNull();
    expect(plannedEdit?.operations).toHaveLength(1);
    expect(plannedEdit?.operations[0]).toMatchObject({
      kind: 'insertText',
      target: { id: 'run-2' },
      text: '3',
    });

    expect(() => {
      planParagraphTextEditForParagraph(paragraph, 'Topic\t12', 'Topic 12');
    }).toThrow(/protected inline content/);
  });
});

function createParagraph(
  overrides: Partial<V2EditableParagraph> & Pick<V2EditableParagraph, 'text'>,
): V2EditableParagraph {
  return {
    blockId: overrides.blockId ?? 'block-1',
    storyId: overrides.storyId ?? 'story-1',
    paragraphRef: overrides.paragraphRef ?? { id: 'paragraph-1' },
    paragraphSourceRef: overrides.paragraphSourceRef ?? { partUri: '/word/document.xml', nodeId: 'paragraph-1' },
    text: overrides.text,
    segments: overrides.segments ?? [],
    supported: overrides.supported ?? true,
    unsupportedReason: overrides.unsupportedReason,
  };
}

type SegmentOverrides = Partial<V2EditableParagraph['segments'][number]> & {
  runId: string;
  segmentId: string;
  text: string;
  paragraphStart: number;
  paragraphEnd: number;
};

function createSegment(overrides: SegmentOverrides): V2EditableParagraph['segments'][number] {
  return {
    segmentKind: overrides.segmentKind ?? 'text',
    isMutableText: overrides.isMutableText ?? (overrides.segmentKind ? overrides.segmentKind === 'text' : true),
    runRef: overrides.runRef ?? { id: overrides.runId },
    runSourceRef: overrides.runSourceRef ?? { partUri: '/word/document.xml', nodeId: overrides.runId },
    runIndex: overrides.runIndex ?? 0,
    segmentIndex: overrides.segmentIndex ?? 0,
    segmentId: overrides.segmentId,
    text: overrides.text,
    paragraphStart: overrides.paragraphStart,
    paragraphEnd: overrides.paragraphEnd,
    runTextStart: overrides.runTextStart ?? 0,
    runTextEnd: overrides.runTextEnd ?? overrides.text.length,
  };
}
