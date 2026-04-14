import { describe, expect, it } from 'vitest';
import type { ParagraphBlock } from '@superdoc/contracts';
import { DATA_ATTRS } from '@superdoc/dom-contract';
import type { V2EditableDocumentSnapshot, V2EditableParagraph } from './V2EditableDocumentSnapshot.js';
import {
  EMPTY_EDITABLE_TEXT_PLACEHOLDER,
  applyEditableInteractionData,
  buildEditableDocumentSnapshotFromSourceRefs,
  isEmptyEditableParagraph,
  mergeEditableDocumentSnapshots,
} from './V2EditableDocumentSnapshot.js';

describe('applyEditableInteractionData', () => {
  it('splits coalesced text runs back to semantic segment boundaries', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'block-1',
      runs: [
        {
          text: 'Hello world',
          fontFamily: 'Arial',
          fontSize: 12,
          bold: true,
        },
      ],
    };

    const paragraph = createParagraph({
      blockId: 'block-1',
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

    applyEditableInteractionData([block], createSnapshot(paragraph));

    expect(block.runs).toHaveLength(2);
    expect(block.runs[0]).toMatchObject({
      text: 'Hello ',
      bold: true,
      dataAttrs: {
        [DATA_ATTRS.SD_RUN_REF]: 'run-1',
        [DATA_ATTRS.SD_SEGMENT_ID]: 'seg-1',
        [DATA_ATTRS.SD_SEGMENT_START]: '0',
        [DATA_ATTRS.SD_SEGMENT_END]: '6',
      },
    });
    expect(block.runs[1]).toMatchObject({
      text: 'world',
      bold: true,
      dataAttrs: {
        [DATA_ATTRS.SD_RUN_REF]: 'run-2',
        [DATA_ATTRS.SD_SEGMENT_ID]: 'seg-2',
        [DATA_ATTRS.SD_SEGMENT_START]: '6',
        [DATA_ATTRS.SD_SEGMENT_END]: '11',
      },
    });
  });

  it('leaves unsupported paragraphs without editing metadata', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'block-2',
      runs: [
        {
          text: 'Unsupported',
          fontFamily: 'Arial',
          fontSize: 12,
        },
      ],
    };

    const paragraph = createParagraph({
      blockId: 'block-2',
      text: 'Unsupported',
      supported: false,
      segments: [],
    });

    applyEditableInteractionData([block], createSnapshot(paragraph));

    expect(block.runs[0]).not.toHaveProperty('dataAttrs');
  });

  it('stamps interaction metadata onto tab runs when the paragraph is editable', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'block-tab',
      runs: [
        {
          text: 'Topic',
          fontFamily: 'Arial',
          fontSize: 12,
        },
        {
          kind: 'tab',
          text: '\t',
        },
        {
          text: '12',
          fontFamily: 'Arial',
          fontSize: 12,
        },
      ],
    };

    const paragraph = createParagraph({
      blockId: 'block-tab',
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

    applyEditableInteractionData([block], createSnapshot(paragraph));

    expect(block.runs[1]).toMatchObject({
      kind: 'tab',
      text: '\t',
      dataAttrs: {
        [DATA_ATTRS.SD_SEGMENT_ID]: 'seg-tab',
        [DATA_ATTRS.SD_INTERACTION_KIND]: 'protected-text',
      },
    });
  });

  it('rewrites empty placeholder paragraphs into synthetic editable anchors', () => {
    const block: ParagraphBlock = {
      kind: 'paragraph',
      id: 'block-empty',
      runs: [
        {
          text: '\u00A0',
          fontFamily: 'Arial',
          fontSize: 12,
          pmStart: 10,
          pmEnd: 11,
        },
      ],
    };

    const paragraph = createParagraph({
      blockId: 'block-empty',
      text: '',
      segments: [
        createSegment({
          runId: 'run-empty',
          segmentId: 'seg-empty',
          text: '',
          paragraphStart: 0,
          paragraphEnd: 0,
          runTextStart: 0,
          runTextEnd: 0,
        }),
      ],
    });

    expect(isEmptyEditableParagraph(paragraph)).toBe(true);

    applyEditableInteractionData([block], createSnapshot(paragraph));

    expect(block.runs).toHaveLength(1);
    expect(block.runs[0]).toMatchObject({
      text: EMPTY_EDITABLE_TEXT_PLACEHOLDER,
      pmStart: 10,
      pmEnd: 10,
      dataAttrs: {
        [DATA_ATTRS.SD_RUN_REF]: 'run-empty',
        [DATA_ATTRS.SD_SEGMENT_ID]: 'seg-empty',
        [DATA_ATTRS.SD_SEGMENT_START]: '0',
        [DATA_ATTRS.SD_SEGMENT_END]: '0',
        [DATA_ATTRS.SD_INTERACTION_KIND]: 'empty-text',
      },
    });
  });
});

describe('buildEditableDocumentSnapshotFromSourceRefs', () => {
  it('builds supported text paragraphs from semantic model segments', () => {
    const paragraphRef = { id: 'paragraph-1' };
    const runRef = { id: 'run-1' };
    const paragraphSourceRef = { partUri: '/word/document.xml', nodeId: 'p-1' };
    const runSourceRef = { partUri: '/word/document.xml', nodeId: 'r-1' };

    const model = {
      entityBySourceRef(sourceRef: { partUri: string; nodeId: string }) {
        if (sourceRef.partUri === paragraphSourceRef.partUri && sourceRef.nodeId === paragraphSourceRef.nodeId) {
          return {
            kind: 'paragraph',
            ref: paragraphRef,
            storyId: 'story-1',
            sourceRefs: [paragraphSourceRef],
          };
        }
        return null;
      },
      entity(ref: { id: string }) {
        if (ref.id === paragraphRef.id) {
          return {
            kind: 'paragraph',
            ref: paragraphRef,
            storyId: 'story-1',
            sourceRefs: [paragraphSourceRef],
          };
        }
        return null;
      },
      runs(ref: { id: string }) {
        if (ref.id !== paragraphRef.id) {
          return [];
        }
        return [
          {
            ref: runRef,
            sourceRefs: [runSourceRef],
          },
        ];
      },
      segments(ref: { id: string }) {
        if (ref.id !== runRef.id) {
          return [];
        }
        return [
          {
            segmentKind: 'text',
            localId: 'segment-1',
            text: 'Hello world',
          },
        ];
      },
    } as any;

    const snapshot = buildEditableDocumentSnapshotFromSourceRefs(model, new Map([['block-1', paragraphSourceRef]]));

    expect(snapshot.orderedParagraphs).toHaveLength(1);
    expect(snapshot.orderedParagraphs[0]).toMatchObject({
      blockId: 'block-1',
      supported: true,
      text: 'Hello world',
    });
    expect(snapshot.orderedParagraphs[0].segments).toHaveLength(1);
    expect(snapshot.orderedParagraphs[0].segments[0]).toMatchObject({
      segmentId: 'segment-1',
      text: 'Hello world',
      isMutableText: true,
    });
  });

  it('ignores hidden field-control segments when the visible paragraph text is editable', () => {
    const paragraphRef = { id: 'paragraph-field-1' };
    const paragraphSourceRef = { partUri: '/word/document.xml', nodeId: 'p-field-1' };
    const runs = [
      {
        ref: { id: 'run-field-begin' },
        sourceRefs: [{ partUri: '/word/document.xml', nodeId: 'r-field-begin' }],
        segments: [{ segmentKind: 'fieldChar', localId: 'field-begin', fieldCharType: 'begin' }],
      },
      {
        ref: { id: 'run-field-instr' },
        sourceRefs: [{ partUri: '/word/document.xml', nodeId: 'r-field-instr' }],
        segments: [{ segmentKind: 'instrText', localId: 'field-instr', text: ' TOC \\\\o "1-3" ' }],
      },
      {
        ref: { id: 'run-1' },
        sourceRefs: [{ partUri: '/word/document.xml', nodeId: 'r-1' }],
        segments: [{ segmentKind: 'text', localId: 'segment-1', text: '1.', preserveSpace: false }],
      },
      {
        ref: { id: 'run-tab-1' },
        sourceRefs: [{ partUri: '/word/document.xml', nodeId: 'r-tab-1' }],
        segments: [{ segmentKind: 'tab', localId: 'segment-tab-1' }],
      },
      {
        ref: { id: 'run-2' },
        sourceRefs: [{ partUri: '/word/document.xml', nodeId: 'r-2' }],
        segments: [{ segmentKind: 'text', localId: 'segment-2', text: 'Scope', preserveSpace: false }],
      },
      {
        ref: { id: 'run-tab-2' },
        sourceRefs: [{ partUri: '/word/document.xml', nodeId: 'r-tab-2' }],
        segments: [{ segmentKind: 'tab', localId: 'segment-tab-2' }],
      },
      {
        ref: { id: 'run-3' },
        sourceRefs: [{ partUri: '/word/document.xml', nodeId: 'r-3' }],
        segments: [{ segmentKind: 'text', localId: 'segment-3', text: '423', preserveSpace: false }],
      },
      {
        ref: { id: 'run-field-end' },
        sourceRefs: [{ partUri: '/word/document.xml', nodeId: 'r-field-end' }],
        segments: [{ segmentKind: 'fieldChar', localId: 'field-end', fieldCharType: 'end' }],
      },
    ];

    const model = {
      entityBySourceRef(sourceRef: { partUri: string; nodeId: string }) {
        if (sourceRef.partUri === paragraphSourceRef.partUri && sourceRef.nodeId === paragraphSourceRef.nodeId) {
          return {
            kind: 'paragraph',
            ref: paragraphRef,
            storyId: 'story-1',
            sourceRefs: [paragraphSourceRef],
          };
        }
        return null;
      },
      entity(ref: { id: string }) {
        if (ref.id === paragraphRef.id) {
          return {
            kind: 'paragraph',
            ref: paragraphRef,
            storyId: 'story-1',
            sourceRefs: [paragraphSourceRef],
          };
        }
        return null;
      },
      runs(ref: { id: string }) {
        return ref.id === paragraphRef.id ? runs : [];
      },
      segments(ref: { id: string }) {
        return runs.find((run) => run.ref.id === ref.id)?.segments ?? [];
      },
    } as any;

    const snapshot = buildEditableDocumentSnapshotFromSourceRefs(
      model,
      new Map([['block-field-1', paragraphSourceRef]]),
    );

    expect(snapshot.orderedParagraphs).toHaveLength(1);
    expect(snapshot.orderedParagraphs[0]).toMatchObject({
      blockId: 'block-field-1',
      supported: true,
      text: '1.\tScope\t423',
    });
    expect(snapshot.orderedParagraphs[0].segments.map((segment) => segment.text)).toEqual([
      '1.',
      '\t',
      'Scope',
      '\t',
      '423',
    ]);
  });

  it('keeps a zero-length mutable segment so empty paragraphs stay editable', () => {
    const paragraphRef = { id: 'paragraph-empty' };
    const runRef = { id: 'run-empty' };
    const paragraphSourceRef = { partUri: '/word/document.xml', nodeId: 'p-empty' };
    const runSourceRef = { partUri: '/word/document.xml', nodeId: 'r-empty' };

    const model = {
      entityBySourceRef(sourceRef: { partUri: string; nodeId: string }) {
        if (sourceRef.partUri === paragraphSourceRef.partUri && sourceRef.nodeId === paragraphSourceRef.nodeId) {
          return {
            kind: 'paragraph',
            ref: paragraphRef,
            storyId: 'story-1',
            sourceRefs: [paragraphSourceRef],
          };
        }
        return null;
      },
      entity(ref: { id: string }) {
        if (ref.id === paragraphRef.id) {
          return {
            kind: 'paragraph',
            ref: paragraphRef,
            storyId: 'story-1',
            sourceRefs: [paragraphSourceRef],
          };
        }
        return null;
      },
      runs(ref: { id: string }) {
        return ref.id === paragraphRef.id ? [{ ref: runRef, sourceRefs: [runSourceRef] }] : [];
      },
      segments(ref: { id: string }) {
        return ref.id === runRef.id
          ? [
              {
                segmentKind: 'text',
                localId: 'seg-empty',
                text: '',
              },
            ]
          : [];
      },
    } as any;

    const snapshot = buildEditableDocumentSnapshotFromSourceRefs(model, new Map([['block-empty', paragraphSourceRef]]));

    expect(snapshot.orderedParagraphs).toHaveLength(1);
    expect(snapshot.orderedParagraphs[0]).toMatchObject({
      blockId: 'block-empty',
      supported: true,
      text: '',
    });
    expect(snapshot.orderedParagraphs[0].segments).toHaveLength(1);
    expect(snapshot.orderedParagraphs[0].segments[0]).toMatchObject({
      segmentId: 'seg-empty',
      text: '',
      isMutableText: true,
      paragraphStart: 0,
      paragraphEnd: 0,
    });
  });

  it('creates a synthetic insertion segment when a paragraph has no runs yet', () => {
    const paragraphRef = { id: 'paragraph-runless' };
    const paragraphSourceRef = { partUri: '/word/document.xml', nodeId: 'p-runless' };

    const model = {
      entityBySourceRef(sourceRef: { partUri: string; nodeId: string }) {
        if (sourceRef.partUri === paragraphSourceRef.partUri && sourceRef.nodeId === paragraphSourceRef.nodeId) {
          return {
            kind: 'paragraph',
            ref: paragraphRef,
            storyId: 'story-1',
            sourceRefs: [paragraphSourceRef],
          };
        }
        return null;
      },
      entity(ref: { id: string }) {
        if (ref.id === paragraphRef.id) {
          return {
            kind: 'paragraph',
            ref: paragraphRef,
            storyId: 'story-1',
            sourceRefs: [paragraphSourceRef],
          };
        }
        return null;
      },
      runs() {
        return [];
      },
      segments() {
        return [];
      },
    } as any;

    const snapshot = buildEditableDocumentSnapshotFromSourceRefs(
      model,
      new Map([['block-runless', paragraphSourceRef]]),
    );

    expect(snapshot.orderedParagraphs).toHaveLength(1);
    expect(snapshot.orderedParagraphs[0]).toMatchObject({
      blockId: 'block-runless',
      supported: true,
      text: '',
    });
    expect(snapshot.orderedParagraphs[0].segments).toHaveLength(1);
    expect(snapshot.orderedParagraphs[0].segments[0]).toMatchObject({
      runRef: paragraphRef,
      runSourceRef: paragraphSourceRef,
      text: '',
      paragraphStart: 0,
      paragraphEnd: 0,
    });
  });
});

describe('mergeEditableDocumentSnapshots', () => {
  it('merges complementary block-id and source-ref snapshots paragraph by paragraph', () => {
    const blockIdSnapshot = createSnapshot(
      createParagraph({
        blockId: 'block-1',
        text: 'Hello world',
        supported: false,
        segments: [],
      }),
    );

    const sourceRefSnapshot = createSnapshot(
      createParagraph({
        blockId: 'block-1',
        text: 'Hello world',
        supported: true,
        segments: [
          createSegment({
            runId: 'run-1',
            segmentId: 'seg-1',
            text: 'Hello world',
            paragraphStart: 0,
            paragraphEnd: 11,
          }),
        ],
      }),
    );

    const merged = mergeEditableDocumentSnapshots(blockIdSnapshot, sourceRefSnapshot, ['block-1']);

    expect(merged.orderedParagraphs).toHaveLength(1);
    expect(merged.orderedParagraphs[0]).toMatchObject({
      blockId: 'block-1',
      supported: true,
      text: 'Hello world',
    });
    expect(merged.orderedParagraphs[0].segments).toHaveLength(1);
  });

  it('preserves block order from the rendered document', () => {
    const left = {
      blockToEntityRef: new Map([
        ['block-2', { id: 'paragraph-2' }],
        ['block-1', { id: 'paragraph-1' }],
      ]),
      paragraphsByBlockId: new Map([
        ['block-2', createParagraph({ blockId: 'block-2', text: 'Two', paragraphRef: { id: 'paragraph-2' } })],
        ['block-1', createParagraph({ blockId: 'block-1', text: 'One', paragraphRef: { id: 'paragraph-1' } })],
      ]),
      orderedParagraphs: [
        createParagraph({ blockId: 'block-2', text: 'Two', paragraphRef: { id: 'paragraph-2' } }),
        createParagraph({ blockId: 'block-1', text: 'One', paragraphRef: { id: 'paragraph-1' } }),
      ],
    } satisfies V2EditableDocumentSnapshot;

    const right = {
      blockToEntityRef: new Map([
        ['block-1', { id: 'paragraph-1' }],
        ['block-2', { id: 'paragraph-2' }],
      ]),
      paragraphsByBlockId: new Map([
        ['block-1', createParagraph({ blockId: 'block-1', text: 'One', paragraphRef: { id: 'paragraph-1' } })],
        ['block-2', createParagraph({ blockId: 'block-2', text: 'Two', paragraphRef: { id: 'paragraph-2' } })],
      ]),
      orderedParagraphs: [
        createParagraph({ blockId: 'block-1', text: 'One', paragraphRef: { id: 'paragraph-1' } }),
        createParagraph({ blockId: 'block-2', text: 'Two', paragraphRef: { id: 'paragraph-2' } }),
      ],
    } satisfies V2EditableDocumentSnapshot;

    const merged = mergeEditableDocumentSnapshots(left, right, ['block-1', 'block-2']);

    expect(merged.orderedParagraphs.map((paragraph) => paragraph.blockId)).toEqual(['block-1', 'block-2']);
  });
});

function createSnapshot(paragraph: V2EditableParagraph): V2EditableDocumentSnapshot {
  return {
    blockToEntityRef: new Map([[paragraph.blockId, paragraph.paragraphRef]]),
    paragraphsByBlockId: new Map([[paragraph.blockId, paragraph]]),
    orderedParagraphs: [paragraph],
  };
}

function createParagraph(
  overrides: Partial<V2EditableParagraph> & Pick<V2EditableParagraph, 'blockId' | 'text'>,
): V2EditableParagraph {
  return {
    blockId: overrides.blockId,
    storyId: overrides.storyId ?? 'story-1',
    paragraphRef: overrides.paragraphRef ?? { id: 'paragraph-1' },
    paragraphSourceRef: overrides.paragraphSourceRef ?? { partUri: '/word/document.xml', nodeId: 'p-1' },
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
