import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { PresentationEditor } from '../PresentationEditor.js';
import type { Editor as EditorInstance } from '../../Editor.js';

type MockedEditor = Mock<(...args: unknown[]) => EditorInstance> & {
  mock: {
    calls: unknown[][];
    results: Array<{ value: EditorInstance }>;
  };
};

const {
  mockOpenV2Model,
  mockProjectToFlowBlocksV2,
  mockProjectToSemanticJson,
  mockDocumentApiAdapter,
  mockIncrementalLayout,
  mockToFlowBlocks,
  mockHydrateImageBlocks,
  mockCreateDomPainter,
  mockMeasureBlock,
  mockEditorConverterStore,
  mockCreateHeaderFooterEditor,
  mockOnHeaderFooterDataUpdate,
  mockEditorOverlayManager,
} = vi.hoisted(() => {
  const converterStore = {
    current: {
      headers: {},
      footers: {},
      headerIds: { default: null, first: null, even: null, odd: null, ids: [] },
      footerIds: { default: null, first: null, even: null, odd: null, ids: [] },
    } as Record<string, unknown>,
    mediaFiles: {} as Record<string, string>,
  };

  const createEmitter = () => {
    const listeners = new Map<string, Set<(payload?: unknown) => void>>();
    return {
      on(event: string, handler: (payload?: unknown) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
      },
      off(event: string, handler: (payload?: unknown) => void) {
        listeners.get(event)?.delete(handler);
      },
      once(event: string, handler: (payload?: unknown) => void) {
        const wrapper = (payload?: unknown) => {
          listeners.get(event)?.delete(wrapper);
          handler(payload);
        };
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(wrapper);
      },
      emit(event: string, payload?: unknown) {
        listeners.get(event)?.forEach((handler) => handler(payload));
      },
    };
  };

  return {
    mockOpenV2Model: vi.fn(),
    mockProjectToFlowBlocksV2: vi.fn(),
    mockProjectToSemanticJson: vi.fn(() => ({
      kind: 'document',
      stories: [],
      styles: [],
      metadata: { entityCount: 0, storyCount: 0, diagnosticCount: 0 },
    })),
    mockDocumentApiAdapter: vi.fn().mockImplementation((model: unknown) => ({
      model,
      supportedOperations: vi.fn(() => []),
    })),
    mockIncrementalLayout: vi.fn(async () => ({
      layout: {
        pageSize: { w: 612, h: 792 },
        pages: [
          {
            number: 1,
            numberText: '1',
            size: { w: 612, h: 792 },
            fragments: [{ kind: 'para', pmStart: 0, pmEnd: 100, blockId: 'v2-p1', x: 0, y: 0 }],
            margins: { top: 72, bottom: 72, left: 72, right: 72, header: 36, footer: 36 },
            sectionRefs: {},
          },
        ],
      },
      measures: [],
    })),
    mockToFlowBlocks: vi.fn(() => ({
      blocks: [
        {
          kind: 'paragraph',
          id: 'pm-p1',
          runs: [{ text: 'Hello', fontFamily: 'Calibri', fontSize: 11, pmStart: 0, pmEnd: 100 }],
        },
      ],
      bookmarks: new Map([['bookmark1', 50]]),
    })),
    mockHydrateImageBlocks: vi.fn((blocks) => blocks),
    mockCreateDomPainter: vi.fn(() => ({
      paint: vi.fn(),
      destroy: vi.fn(),
      setZoom: vi.fn(),
      setLayoutMode: vi.fn(),
      setVirtualizationPins: vi.fn(),
      setProviders: vi.fn(),
      setData: vi.fn(),
    })),
    mockMeasureBlock: vi.fn(() => ({ width: 100, height: 20 })),
    mockEditorConverterStore: converterStore,
    mockCreateHeaderFooterEditor: vi.fn(() => {
      const emitter = createEmitter();
      const editorStub = {
        on: emitter.on,
        off: emitter.off,
        once: emitter.once,
        emit: emitter.emit,
        destroy: vi.fn(),
        setEditable: vi.fn(),
        setOptions: vi.fn(),
        commands: { setTextSelection: vi.fn() },
        state: { doc: { content: { size: 10 } } },
        view: { dom: document.createElement('div'), focus: vi.fn() },
      };
      queueMicrotask(() => editorStub.emit('create'));
      return editorStub;
    }),
    mockOnHeaderFooterDataUpdate: vi.fn(),
    mockEditorOverlayManager: vi.fn().mockImplementation(() => ({
      showEditingOverlay: vi.fn(() => ({
        success: true,
        editorHost: document.createElement('div'),
        reason: null,
      })),
      hideEditingOverlay: vi.fn(),
      showSelectionOverlay: vi.fn(),
      hideSelectionOverlay: vi.fn(),
      setOnDimmingClick: vi.fn(),
      getActiveEditorHost: vi.fn(() => null),
      destroy: vi.fn(),
    })),
  };
});

vi.mock('../../Editor', () => ({
  Editor: vi.fn().mockImplementation(() => ({
    setDocumentMode: vi.fn(),
    setOptions: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
    isEditable: true,
    schema: undefined,
    state: {
      selection: { from: 0, to: 0 },
      doc: {
        descendants: vi.fn(),
        content: { size: 100 },
      },
    },
    view: {
      dom: {
        dispatchEvent: vi.fn(() => true),
        focus: vi.fn(),
      },
      focus: vi.fn(),
      dispatch: vi.fn(),
    },
    options: {
      documentId: 'test-doc',
      element: document.createElement('div'),
    },
    converter: mockEditorConverterStore.current,
    storage: {
      image: {
        media: mockEditorConverterStore.mediaFiles,
      },
    },
  })),
}));

vi.mock('@superdoc/pm-adapter', () => ({
  toFlowBlocks: mockToFlowBlocks,
  hydrateImageBlocks: mockHydrateImageBlocks,
  FlowBlockCache: class {
    clear = vi.fn();
    setHasExternalChanges = vi.fn();
  },
}));

vi.mock('@superdoc/layout-bridge', () => ({
  incrementalLayout: mockIncrementalLayout,
  selectionToRects: vi.fn(() => [{ pageIndex: 0, x: 0, y: 0, width: 0, height: 0 }]),
  clickToPosition: vi.fn(() => null),
  getFragmentAtPosition: vi.fn(() => null),
  extractIdentifierFromConverter: vi.fn(() => ({
    extractHeaderId: vi.fn(() => undefined),
    extractFooterId: vi.fn(() => undefined),
  })),
  buildMultiSectionIdentifier: vi.fn(() => ({ sections: [] })),
  layoutHeaderFooterWithCache: vi.fn(async () => ({})),
  PageGeometryHelper: vi.fn().mockImplementation(({ layout, pageGap }) => ({
    updateLayout: vi.fn(),
    getPageIndexAtY: vi.fn(() => 0),
    getNearestPageIndex: vi.fn(() => 0),
    getPageTop: vi.fn(() => 0),
    getPageGap: vi.fn(() => pageGap ?? 0),
    getLayout: vi.fn(() => layout),
  })),
}));

vi.mock('@superdoc/v2-model', () => ({
  open: mockOpenV2Model,
  projectToFlowBlocks: mockProjectToFlowBlocksV2,
  projectToSemanticJson: mockProjectToSemanticJson,
  DocumentApiAdapter: mockDocumentApiAdapter,
  SemanticModel: class {},
  StyleResolver: class {
    constructor() {}
  },
}));

vi.mock('@superdoc/painter-dom', () => ({
  createDomPainter: mockCreateDomPainter,
  DOM_CLASS_NAMES: {
    PAGE: 'superdoc-page',
    FRAGMENT: 'superdoc-fragment',
    LINE: 'superdoc-line',
    INLINE_SDT_WRAPPER: 'superdoc-structured-content-inline',
    BLOCK_SDT: 'superdoc-structured-content-block',
    DOCUMENT_SECTION: 'superdoc-document-section',
  },
  applyProofingDecorations: vi.fn(() => false),
  clearProofingDecorations: vi.fn(() => false),
}));

vi.mock('@superdoc/measuring-dom', () => ({
  measureBlock: mockMeasureBlock,
}));

vi.mock('@extensions/pagination/pagination-helpers.js', () => ({
  createHeaderFooterEditor: mockCreateHeaderFooterEditor,
  onHeaderFooterDataUpdate: mockOnHeaderFooterDataUpdate,
}));

vi.mock('../../header-footer/EditorOverlayManager', () => ({
  EditorOverlayManager: mockEditorOverlayManager,
}));

describe('PresentationEditor v2-model integration', () => {
  let container: HTMLElement;
  let editor: PresentationEditor;
  const originalFlag = process.env.SD_V2_MODEL_ADAPTER;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SD_V2_MODEL_ADAPTER = 'true';
    container = document.createElement('div');
    document.body.appendChild(container);

    const mockModel = { kind: 'semantic-model' };
    mockOpenV2Model.mockResolvedValue({
      ready: vi.fn(async () => {}),
      semanticModel: vi.fn(() => mockModel),
      views: vi.fn(() => ({
        styles: { rootElement: vi.fn(() => undefined) },
        numbering: { rootElement: vi.fn(() => undefined) },
      })),
      close: vi.fn(async () => {}),
    });

    mockProjectToFlowBlocksV2.mockReturnValue({
      blocks: [
        {
          kind: 'paragraph',
          id: 'v2-p1',
          runs: [{ text: 'Hello', fontFamily: 'Calibri', fontSize: 11 }],
        },
      ],
      blockToEntityRef: new Map(),
    });
  });

  afterEach(() => {
    process.env.SD_V2_MODEL_ADAPTER = originalFlag;
    editor?.destroy();
    container.remove();
  });

  it('keeps PM shadow bookmarks and PM-range metadata while rendering v2 blocks', async () => {
    editor = new PresentationEditor({
      element: container,
      documentId: 'test-doc',
      layoutEngineOptions: {
        v2ModelBytes: new Uint8Array([1, 2, 3]),
      },
    });

    const activeEditor = {
      commands: {
        setTextSelection: vi.fn(),
      },
    };
    editor.getActiveEditor = vi.fn(() => activeEditor as never);

    const pagesHost = container.querySelector('.presentation-editor__pages') as HTMLElement;
    if (pagesHost) {
      const page = document.createElement('div');
      page.setAttribute('data-page-index', '0');
      page.scrollIntoView = vi.fn();
      pagesHost.appendChild(page);
    }

    await vi.waitFor(() => expect(mockProjectToFlowBlocksV2).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockIncrementalLayout).toHaveBeenCalled());

    const latestBlocks = mockIncrementalLayout.mock.calls.at(-1)?.[2] as Array<{
      kind: string;
      runs?: Array<{ pmStart?: number; pmEnd?: number }>;
    }>;

    expect(mockToFlowBlocks).toHaveBeenCalled();
    expect(latestBlocks[0].kind).toBe('paragraph');
    expect(latestBlocks[0].runs?.[0]?.pmStart).toBe(0);
    expect(latestBlocks[0].runs?.[0]?.pmEnd).toBe(100);

    expect(editor.getSemanticModel()).toEqual({ kind: 'semantic-model' });
    expect(editor.getSemanticJson()).toEqual({
      kind: 'document',
      stories: [],
      styles: [],
      metadata: { entityCount: 0, storyCount: 0, diagnosticCount: 0 },
    });
    expect(editor.getSemanticDocumentApiAdapter()).toBeDefined();

    const navigated = await editor.goToAnchor('bookmark1');
    expect(navigated).toBe(true);
    expect(activeEditor.commands.setTextSelection).toHaveBeenCalledWith({ from: 50, to: 50 });
  });
});
