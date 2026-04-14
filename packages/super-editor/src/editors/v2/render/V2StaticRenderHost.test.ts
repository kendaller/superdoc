import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V2StaticRenderHost } from './V2StaticRenderHost.js';

const {
  openMock,
  projectToFlowBlocksMock,
  projectToSemanticJsonMock,
  measureBlockMock,
  incrementalLayoutMock,
  createDomPainterMock,
} = vi.hoisted(() => ({
  openMock: vi.fn(),
  projectToFlowBlocksMock: vi.fn(),
  projectToSemanticJsonMock: vi.fn(),
  measureBlockMock: vi.fn(),
  incrementalLayoutMock: vi.fn(),
  createDomPainterMock: vi.fn(),
}));

function twipsToLayoutPx(value: number): number {
  return (value / 1440) * 96;
}

vi.mock('@superdoc/v2-model', () => ({
  open: openMock,
  projectToFlowBlocks: projectToFlowBlocksMock,
  projectToSemanticJson: projectToSemanticJsonMock,
  DocumentApiAdapter: class DocumentApiAdapterMock {
    semanticModel;
    constructor(semanticModel: unknown) {
      this.semanticModel = semanticModel;
    }
  },
  StyleResolver: class StyleResolverMock {},
}));

vi.mock('@superdoc/measuring-dom', () => ({
  measureBlock: measureBlockMock,
}));

vi.mock('@superdoc/layout-bridge', () => ({
  incrementalLayout: incrementalLayoutMock,
}));

vi.mock('@superdoc/painter-dom', () => ({
  createDomPainter: createDomPainterMock,
}));

describe('V2StaticRenderHost', () => {
  const semanticModel = {
    sections: vi.fn(() => [
      {
        raw: () => ({
          pageWidth: 12240,
          pageHeight: 15840,
          marginTop: 1440,
          marginRight: 1440,
          marginBottom: 1440,
          marginLeft: 1440,
          cols: 1,
        }),
      },
    ]),
  };

  const documentHandle = {
    ready: vi.fn(),
    semanticModel: vi.fn(() => semanticModel),
    views: vi.fn(() => ({
      styles: { rootElement: vi.fn(() => null) },
      numbering: { rootElement: vi.fn(() => null) },
    })),
    close: vi.fn(),
  };

  const painter = {
    setData: vi.fn(),
    paint: vi.fn(),
    setZoom: vi.fn(),
    setScrollContainer: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    openMock.mockResolvedValue(documentHandle);
    projectToSemanticJsonMock.mockReturnValue({ kind: 'semanticDocument' });
    projectToFlowBlocksMock.mockReturnValue({
      blocks: [
        {
          id: 'v2-paragraph-1',
          kind: 'paragraph',
          runs: [],
          attrs: {},
        },
      ],
      blockToEntityRef: new Map(),
    });
    incrementalLayoutMock.mockResolvedValue({
      layout: {
        pageSize: {
          w: twipsToLayoutPx(12240),
          h: twipsToLayoutPx(15840),
        },
        pages: [
          {
            number: 1,
            fragments: [],
            size: {
              w: twipsToLayoutPx(12240),
              h: twipsToLayoutPx(15840),
            },
          },
        ],
      },
      measures: [{ blockId: 'v2-paragraph-1', width: 100, height: 20 }],
    });
    createDomPainterMock.mockReturnValue(painter);
  });

  it('loads, projects, lays out, and paints a DOCX source', async () => {
    const hostElement = document.createElement('div');
    Object.defineProperty(hostElement, 'clientWidth', { value: 960, configurable: true });

    const host = new V2StaticRenderHost({
      element: hostElement,
      documentId: 'doc-1',
      layoutEngineOptions: { zoom: 1.25 },
    });

    const paginationHandler = vi.fn();
    host.on('paginationUpdate', paginationHandler);

    await host.load(
      new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    );

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(documentHandle.ready).toHaveBeenCalledWith('structure');
    expect(projectToFlowBlocksMock).toHaveBeenCalledWith(
      semanticModel,
      expect.objectContaining({ resolver: expect.anything() }),
    );
    expect(incrementalLayoutMock).toHaveBeenCalledTimes(1);
    expect(incrementalLayoutMock).toHaveBeenCalledWith(
      expect.any(Array),
      null,
      expect.any(Array),
      expect.objectContaining({
        pageSize: {
          w: twipsToLayoutPx(12240),
          h: twipsToLayoutPx(15840),
        },
        margins: {
          top: twipsToLayoutPx(1440),
          right: twipsToLayoutPx(1440),
          bottom: twipsToLayoutPx(1440),
          left: twipsToLayoutPx(1440),
        },
      }),
      expect.any(Function),
      undefined,
      expect.any(Array),
    );
    expect(createDomPainterMock).toHaveBeenCalledTimes(1);
    expect(createDomPainterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        virtualization: { enabled: false },
      }),
    );
    expect(painter.paint).toHaveBeenCalledTimes(1);
    expect(paginationHandler).toHaveBeenCalledTimes(1);
    expect(host.getSemanticModel()).toBe(semanticModel);
    expect(host.getSemanticJson()).toEqual({ kind: 'semanticDocument' });
    expect(host.getLayoutSnapshot().layout?.pages).toHaveLength(1);
    expect(hostElement.style.minHeight).toBe('792px');
  });

  it('updates zoom through the painter surface', async () => {
    const host = new V2StaticRenderHost({
      element: document.createElement('div'),
      documentId: 'doc-2',
    });

    await host.load(
      new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    );

    host.setZoom(1.5);

    expect(painter.setZoom).toHaveBeenLastCalledWith(1.5);
  });

  it('renders from a bound editing controller runtime', async () => {
    const hostElement = document.createElement('div');
    const host = new V2StaticRenderHost({
      element: hostElement,
      documentId: 'doc-editable',
    });

    const controllerSemanticModel = {
      sections: semanticModel.sections,
      entity: vi.fn((ref: { id: string }) => {
        if (ref.id === 'para-1') {
          return { kind: 'paragraph', ref: { id: 'para-1' }, parentRef: { id: 'story-1' } };
        }
        if (ref.id === 'story-1') {
          return { kind: 'mainStory', ref: { id: 'story-1' }, parentRef: undefined };
        }
        return undefined;
      }),
    };

    const controllerRuntime = {
      initialize: vi.fn(),
      close: vi.fn(),
      isActive: vi.fn(() => true),
      semanticModel: controllerSemanticModel,
      styleResolver: { kind: 'controller-style-resolver' },
      semanticJson: { kind: 'controller-semantic-document' },
      documentApiAdapter: { kind: 'controller-adapter' },
    };

    const controller = {
      initialize: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn(() => true),
      on: vi.fn(() => vi.fn()),
      runtime: controllerRuntime,
    } as any;

    projectToFlowBlocksMock.mockReturnValueOnce({
      blocks: [
        {
          id: 'v2-paragraph-1',
          kind: 'paragraph',
          runs: [],
          attrs: {},
        },
      ],
      blockToEntityRef: new Map([['v2-paragraph-1', { id: 'para-1' }]]),
    });

    host.bindEditingController(controller);
    await host.load(
      new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    );

    expect(controller.initialize).toHaveBeenCalledTimes(1);
    expect(openMock).not.toHaveBeenCalled();
    expect(projectToFlowBlocksMock).toHaveBeenCalledWith(
      controllerSemanticModel,
      expect.objectContaining({ resolver: controllerRuntime.styleResolver }),
    );
    expect(host.getSemanticModel()).toBe(controllerSemanticModel);
    expect(host.getSemanticJson()).toEqual({ kind: 'controller-semantic-document' });
  });

  it('sizes the viewport from layout.pageSize when page.size is missing', async () => {
    incrementalLayoutMock.mockResolvedValueOnce({
      layout: {
        pageSize: {
          w: twipsToLayoutPx(12240),
          h: twipsToLayoutPx(15840),
        },
        pages: [
          {
            number: 1,
            fragments: [],
            size: null,
          },
        ],
      },
      measures: [{ blockId: 'v2-paragraph-1', width: 100, height: 20 }],
    });

    const hostElement = document.createElement('div');
    const host = new V2StaticRenderHost({
      element: hostElement,
      documentId: 'doc-3',
    });

    await host.load(
      new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    );

    const viewport = hostElement.querySelector('.v2-static-renderer__viewport');
    expect(viewport).not.toBeNull();
    expect((viewport as HTMLElement).style.width).toBe(`${twipsToLayoutPx(12240)}px`);
    expect((viewport as HTMLElement).style.minWidth).toBe(`${twipsToLayoutPx(12240)}px`);
    expect((viewport as HTMLElement).style.minHeight).toBe(`${twipsToLayoutPx(15840)}px`);
  });
});
