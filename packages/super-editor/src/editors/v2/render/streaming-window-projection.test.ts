import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentHandle } from '@superdoc/v2-model';
import {
  cloneWindowRecord,
  mergeProjectedWindowDependencyManifests,
  normalizeProjectedWindow,
  projectCanonicalWindowFromHandle,
} from './streaming-window-projection.js';

const { projectWindowToFlowBlocksMock, styleResolverMock } = vi.hoisted(() => ({
  projectWindowToFlowBlocksMock: vi.fn(),
  styleResolverMock: vi.fn(),
}));

vi.mock('@superdoc/v2-model', () => ({
  StyleResolver: styleResolverMock,
  projectWindowToFlowBlocks: projectWindowToFlowBlocksMock,
}));

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

describe('streaming-window-projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes a runtime window result into a canonical window record', () => {
    const result = normalizeProjectedWindow({
      windowResult: {
        blocks: [{ id: 'p1', kind: 'paragraph', runs: [], attrs: {} }],
        continuation: {
          nextBodyChildIndex: 3,
          hasMore: true,
          totalBodyChildCount: 9,
        },
        blockToSourceRef: new Map([['p1', { partUri: '/word/document.xml', nodeId: 'p1-node' }]]),
        sectionMetadata: { sectionBreaks: [] },
      },
      startBodyChildIndex: 1,
      index: 2,
      projectionMode: 'exact',
    });

    expect(result.windowRecord).toMatchObject({
      index: 2,
      startBodyChildIndex: 1,
      bodyChildCount: 2,
      blockCount: 1,
      blockIds: ['p1'],
      projectionMode: 'exact',
      status: 'projected',
    });
    expect(result.blockToSourceRef.get('p1')).toEqual({
      partUri: '/word/document.xml',
      nodeId: 'p1-node',
    });
  });

  it('projects a canonical window directly from a document handle', () => {
    const documentHandle = makeDocumentHandle();
    projectWindowToFlowBlocksMock.mockReturnValue({
      blocks: [{ id: 'p2', kind: 'paragraph', runs: [], attrs: {} }],
      continuation: {
        nextBodyChildIndex: 6,
        hasMore: false,
        totalBodyChildCount: 6,
      },
      blockToSourceRef: new Map([['p2', { partUri: '/word/document.xml', nodeId: 'p2-node' }]]),
      sectionMetadata: { sectionBreaks: [] },
    });

    const result = projectCanonicalWindowFromHandle({
      documentHandle,
      startBodyChildIndex: 4,
      maxBodyChildCount: 2,
      includeDependencyManifest: true,
      index: 1,
    });

    expect(styleResolverMock).toHaveBeenCalledTimes(1);
    expect(projectWindowToFlowBlocksMock).toHaveBeenCalledWith(
      { shell: true },
      expect.objectContaining({
        startBodyChildIndex: 4,
        maxBodyChildCount: 2,
        includeDependencyManifest: true,
      }),
      expect.any(Object),
    );
    expect(result.windowRecord.blockIds).toEqual(['p2']);
    expect(result.nextBodyChildIndex).toBe(6);
  });

  it('merges dependency manifests across canonical windows', () => {
    const record = cloneWindowRecord({
      index: 0,
      startBodyChildIndex: 0,
      bodyChildCount: 1,
      blockCount: 1,
      blockIds: ['p1'],
      blocks: [{ id: 'p1', kind: 'paragraph', runs: [], attrs: {} }],
      sectionMetadataDelta: { sectionBreaks: [] },
      projectionMode: 'exact',
      status: 'projected',
      dependencyManifest: {
        headerFooterRefs: [{ relationshipId: 'rId1', type: 'header' }],
        footnoteRefs: [{ footnoteId: '1' }],
        endnoteRefs: [],
        commentRefs: [],
        imageRefs: [],
        hyperlinkRefs: [],
      },
    });

    const merged = mergeProjectedWindowDependencyManifests([
      record,
      {
        ...record,
        dependencyManifest: {
          headerFooterRefs: [{ relationshipId: 'rId1', type: 'header' }],
          footnoteRefs: [],
          endnoteRefs: [],
          commentRefs: [{ commentId: 'c1' }],
          imageRefs: [],
          hyperlinkRefs: [{ relationshipId: 'h1' }],
        },
      },
    ]);

    expect(merged.headerFooterRefs).toHaveLength(1);
    expect(merged.footnoteRefs).toHaveLength(1);
    expect(merged.commentRefs).toHaveLength(1);
    expect(merged.hyperlinkRefs).toHaveLength(1);
  });
});
