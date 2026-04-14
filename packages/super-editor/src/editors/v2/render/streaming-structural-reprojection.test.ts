import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DocumentHandle } from '@superdoc/v2-model';
import type { FlowBlock } from '@superdoc/contracts';
import { reprojectStructuralStreamingWindows } from './streaming-structural-reprojection.js';
import type { WindowRecord } from './streaming-host-types.js';

const { projectWindowToFlowBlocksMock } = vi.hoisted(() => ({
  projectWindowToFlowBlocksMock: vi.fn(),
}));

vi.mock('@superdoc/v2-model', () => ({
  StyleResolver: class StyleResolver {},
  makeStableBlockId: (anchor: { partUri: string; nodeId: string }) => `${anchor.partUri}:${anchor.nodeId}`,
  sourceRefToSourceAnchor: (sourceRef: { partUri: string; nodeId: string; sourceNodePath?: string }) => sourceRef,
  projectWindowToFlowBlocks: projectWindowToFlowBlocksMock,
}));

function makeParagraphBlock(id: string, text = id): FlowBlock {
  return {
    id,
    kind: 'paragraph',
    runs: [{ text, fontFamily: 'Arial', fontSize: 12 }],
    attrs: {},
  };
}

function makeWindowRecord(
  index: number,
  startBodyChildIndex: number,
  bodyChildCount: number,
  blockIds: readonly string[],
): WindowRecord {
  return {
    index,
    startBodyChildIndex,
    bodyChildCount,
    blockCount: blockIds.length,
    blockIds: [...blockIds],
    blocks: blockIds.map((blockId) => makeParagraphBlock(blockId)),
    sectionMetadataDelta: { sectionBreaks: [] },
    projectionMode: 'exact',
    status: 'laid-out',
  };
}

function makeSourceRef(blockId: string) {
  return {
    partUri: '/word/document.xml',
    nodeId: `${blockId}-node`,
  };
}

function makeDocumentHandle(): DocumentHandle {
  return {
    sessionId: 'session-1',
    ready: vi.fn(),
    status: vi.fn(),
    close: vi.fn(),
    save: vi.fn(),
    documentView: vi.fn(),
    views: vi.fn(() => ({
      document: undefined,
      styles: { rootElement: () => undefined },
      numbering: { rootElement: () => undefined },
      settings: undefined,
      headersFooters: undefined,
      comments: undefined,
      footnotes: undefined,
      endnotes: undefined,
      theme: undefined,
      fontTable: undefined,
      contentTypes: {},
      relationships: {},
    })),
    renderShell: vi.fn(() => ({ shell: true })),
    semanticModel: vi.fn(),
    materializeParts: vi.fn(),
    resolveBinaryPart: vi.fn(),
  } as unknown as DocumentHandle;
}

describe('reprojectStructuralStreamingWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reprojects only the affected loaded suffix and preserves earlier windows', () => {
    const documentHandle = makeDocumentHandle();
    const windowRecords = [
      makeWindowRecord(0, 0, 2, ['p1', 'p2']),
      makeWindowRecord(1, 2, 2, ['p3', 'p4']),
      makeWindowRecord(2, 4, 2, ['p5', 'p6']),
    ];
    const blockToSourceRef = new Map(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((blockId) => [blockId, makeSourceRef(blockId)]),
    );

    projectWindowToFlowBlocksMock
      .mockReturnValueOnce({
        blocks: [makeParagraphBlock('p3'), makeParagraphBlock('p4')],
        continuation: { nextBodyChildIndex: 4, totalBodyChildCount: 7, hasMore: true },
        blockToSourceRef: new Map([
          ['p3', makeSourceRef('p3')],
          ['p4', makeSourceRef('p4')],
        ]),
        sectionMetadata: { sectionBreaks: [] },
      })
      .mockReturnValueOnce({
        blocks: [makeParagraphBlock('p5'), makeParagraphBlock('p5b')],
        continuation: { nextBodyChildIndex: 6, totalBodyChildCount: 7, hasMore: true },
        blockToSourceRef: new Map([
          ['p5', makeSourceRef('p5')],
          ['p5b', makeSourceRef('p5b')],
        ]),
        sectionMetadata: { sectionBreaks: [] },
      });

    const result = reprojectStructuralStreamingWindows({
      documentHandle,
      windowRecords,
      blockToSourceRef,
      totalBodyChildCount: 6,
      anchorParagraphSourceRef: makeSourceRef('p5'),
      pendingSelection: {
        kind: 'caret',
        paragraphSourceRef: makeSourceRef('p5b'),
        paragraphOffset: 0,
      },
      mutationKind: 'splitSelection',
    });

    expect(result).not.toBeNull();
    expect(result?.affectedWindowIndex).toBe(1);
    expect(result?.reprojectedWindowCount).toBe(2);
    expect(
      result?.windowRecords.map((record) => ({
        index: record.index,
        startBodyChildIndex: record.startBodyChildIndex,
        bodyChildCount: record.bodyChildCount,
        blockIds: record.blockIds,
      })),
    ).toEqual([
      { index: 0, startBodyChildIndex: 0, bodyChildCount: 2, blockIds: ['p1', 'p2'] },
      { index: 1, startBodyChildIndex: 2, bodyChildCount: 2, blockIds: ['p3', 'p4'] },
      { index: 2, startBodyChildIndex: 4, bodyChildCount: 2, blockIds: ['p5', 'p5b'] },
    ]);
    expect(result?.blocks.map((block) => block.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p5b']);
    expect(result?.nextBodyChildIndex).toBe(6);
    expect(result?.totalBodyChildCount).toBe(7);
    expect(projectWindowToFlowBlocksMock).toHaveBeenCalledTimes(2);
  });

  it('drops trailing loaded windows when a structural delete shrinks the loaded range', () => {
    const documentHandle = makeDocumentHandle();
    const windowRecords = [
      makeWindowRecord(0, 0, 2, ['p1', 'p2']),
      makeWindowRecord(1, 2, 2, ['p3', 'p4']),
      makeWindowRecord(2, 4, 2, ['p5', 'p6']),
    ];
    const blockToSourceRef = new Map(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((blockId) => [blockId, makeSourceRef(blockId)]),
    );

    projectWindowToFlowBlocksMock
      .mockReturnValueOnce({
        blocks: [makeParagraphBlock('p1'), makeParagraphBlock('p2')],
        continuation: { nextBodyChildIndex: 2, totalBodyChildCount: 4, hasMore: true },
        blockToSourceRef: new Map([
          ['p1', makeSourceRef('p1')],
          ['p2', makeSourceRef('p2')],
        ]),
        sectionMetadata: { sectionBreaks: [] },
      })
      .mockReturnValueOnce({
        blocks: [makeParagraphBlock('p3'), makeParagraphBlock('p4')],
        continuation: { nextBodyChildIndex: 4, totalBodyChildCount: 4, hasMore: false },
        blockToSourceRef: new Map([
          ['p3', makeSourceRef('p3')],
          ['p4', makeSourceRef('p4')],
        ]),
        sectionMetadata: { sectionBreaks: [] },
      });

    const result = reprojectStructuralStreamingWindows({
      documentHandle,
      windowRecords,
      blockToSourceRef,
      totalBodyChildCount: 6,
      anchorParagraphSourceRef: makeSourceRef('p2'),
      pendingSelection: {
        kind: 'caret',
        paragraphSourceRef: makeSourceRef('p2'),
        paragraphOffset: 0,
      },
      mutationKind: 'deleteBackward',
    });

    expect(result).not.toBeNull();
    expect(result?.windowRecords).toHaveLength(2);
    expect(result?.blocks.map((block) => block.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(result?.nextBodyChildIndex).toBe(4);
    expect(result?.totalBodyChildCount).toBe(4);
  });
});
