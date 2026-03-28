import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V2StreamingPaginatedRenderHost } from './V2StreamingPaginatedRenderHost.js';
import type { DocumentRuntime, RenderShellSnapshot, WindowedProjectionResult } from '@superdoc/v2-model';
import type { HostState, StateChangeEvent } from './streaming-host-types.js';

// ---- Hoisted mocks -----------------------------------------------------------

const { measureBlockMock, incrementalLayoutMock, createDomPainterMock } = vi.hoisted(() => ({
  measureBlockMock: vi.fn(),
  incrementalLayoutMock: vi.fn(),
  createDomPainterMock: vi.fn(),
}));

vi.mock('@superdoc/v2-model', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@superdoc/v2-model');
  return {
    ...actual,
  };
});

vi.mock('@superdoc/measuring-dom', () => ({
  measureBlock: measureBlockMock,
}));

vi.mock('@superdoc/layout-bridge', () => ({
  incrementalLayout: incrementalLayoutMock,
}));

vi.mock('@superdoc/painter-dom', () => ({
  createDomPainter: createDomPainterMock,
}));

// ---- Helpers -----------------------------------------------------------------

function makeBlock(id: string) {
  return { id, kind: 'paragraph' as const, runs: [], attrs: {} };
}

function makeShell(bodyChildCount: number): RenderShellSnapshot {
  return {
    bodyChildCount,
    sections: [
      {
        index: 0,
        pageGeometry: {
          width: 12240,
          height: 15840,
          margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
        headerRefs: [],
        footerRefs: [],
      },
    ],
    primaryPageGeometry: {
      width: 12240,
      height: 15840,
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
    availableShells: { styles: true, numbering: true, settings: true },
  };
}

function makeLayoutResult(pageCount: number, blocks: { id: string }[]) {
  return {
    layout: {
      pageSize: { w: 612, h: 792 },
      pages: Array.from({ length: pageCount }, (_, i) => ({
        number: i + 1,
        fragments: [],
        size: { w: 612, h: 792 },
      })),
    },
    measures: blocks.map((b) => ({ blockId: b.id, width: 100, height: 20 })),
    dirty: { dirtyFromIndex: 0 },
  };
}

function makeWindowResult(
  blocks: ReturnType<typeof makeBlock>[],
  nextBodyChildIndex: number,
  totalBodyChildCount: number,
): WindowedProjectionResult {
  return {
    blocks,
    continuation: {
      nextBodyChildIndex,
      hasMore: nextBodyChildIndex < totalBodyChildCount,
      totalBodyChildCount,
    },
    blockToSourceRef: new Map(),
    sectionMetadata: {
      sectionBreaks: [],
      primaryPageGeometry: {
        width: 816,
        height: 1056,
        margins: { top: 96, right: 96, bottom: 96, left: 96 },
      },
    },
  };
}

function configureDocumentWindow(
  runtime: DocumentRuntime,
  {
    totalBodyChildCount,
    firstWindowBlockIds,
    firstWindowNextBodyChildIndex,
  }: {
    totalBodyChildCount: number;
    firstWindowBlockIds?: string[];
    firstWindowNextBodyChildIndex?: number;
  },
): void {
  const blockIds =
    firstWindowBlockIds ??
    Array.from({ length: Math.min(3, totalBodyChildCount) }, (_unused, index) => `b${index + 1}`);
  const firstWindowBlocks = blockIds.map(makeBlock);
  const nextBodyChildIndex = firstWindowNextBodyChildIndex ?? Math.min(firstWindowBlocks.length, totalBodyChildCount);

  (runtime.getRenderShell as ReturnType<typeof vi.fn>).mockResolvedValue(makeShell(totalBodyChildCount));
  (runtime.projectWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
    makeWindowResult(firstWindowBlocks, nextBodyChildIndex, totalBodyChildCount),
  );
}

function createMockRuntime(overrides?: Partial<DocumentRuntime>): DocumentRuntime {
  return {
    openSource: vi.fn().mockResolvedValue({ sessionId: 'test-session' }),
    close: vi.fn().mockResolvedValue(undefined),
    ready: vi.fn().mockResolvedValue(undefined),
    getRenderShell: vi.fn().mockResolvedValue(makeShell(10)),
    projectWindow: vi
      .fn()
      .mockResolvedValue(makeWindowResult([makeBlock('b1'), makeBlock('b2'), makeBlock('b3')], 3, 10)),
    projectNextWindow: vi.fn().mockResolvedValue(makeWindowResult([makeBlock('b4'), makeBlock('b5')], 5, 10)),
    prefetchWindow: vi.fn().mockResolvedValue(undefined),
    advanceStructure: vi.fn().mockResolvedValue(undefined),
    enrich: vi.fn().mockResolvedValue({ target: 'comments', mergePolicy: 'overlay-only', items: [] }),
    cancelTask: vi.fn(),
    status: vi.fn().mockResolvedValue({ stage: 'render-shell' }),
    save: vi.fn().mockResolvedValue(new Uint8Array()),
    on: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

const painter = {
  setData: vi.fn(),
  paint: vi.fn(),
  setZoom: vi.fn(),
  setScrollContainer: vi.fn(),
  onScroll: vi.fn(),
};

// ---- Tests -------------------------------------------------------------------

describe('V2StreamingPaginatedRenderHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    incrementalLayoutMock.mockImplementation(
      async (_prev: unknown, _prevLayout: unknown, nextBlocks: { id: string }[]) => {
        return makeLayoutResult(Math.max(1, Math.ceil(nextBlocks.length / 2)), nextBlocks);
      },
    );
    createDomPainterMock.mockReturnValue(painter);
  });

  describe('first paint from partial block set', () => {
    it('projects only the first window, measures, paginates, and paints', async () => {
      const runtime = createMockRuntime();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      // Prevent append loop from running during test
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      await host.load(new Uint8Array([1, 2, 3]));

      expect(runtime.openSource).toHaveBeenCalledTimes(1);
      expect(runtime.ready).toHaveBeenCalledWith('render-shell');
      expect(runtime.getRenderShell).toHaveBeenCalledTimes(1);
      expect(runtime.projectWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          startBodyChildIndex: 0,
          maxBodyChildCount: 3,
          includeDependencyManifest: true,
        }),
      );
      expect(incrementalLayoutMock).toHaveBeenCalledTimes(1);
      expect(painter.paint).toHaveBeenCalledTimes(1);
      expect(host.state).toBe('complete'); // 3 body children, all consumed in first window
    });
  });

  describe('state machine transitions', () => {
    it('follows the expected state sequence for a multi-window document', async () => {
      const runtime = createMockRuntime();
      const states: HostState[] = [];

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      host.onStateChange((event: StateChangeEvent) => {
        states.push(event.current);
      });

      // Runtime returns 10 body children, but project window only returns 3
      // Then projectNextWindow returns 2, so after first append nextBodyChildIndex = 5
      // We need to make the append loop terminate by making next windows consume all
      let callCount = 0;
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return makeWindowResult([makeBlock('b4'), makeBlock('b5'), makeBlock('b6')], 6, 10);
        }
        if (callCount === 2) {
          return makeWindowResult([makeBlock('b7'), makeBlock('b8'), makeBlock('b9')], 9, 10);
        }
        return makeWindowResult([makeBlock('b10')], 10, 10);
      });

      await host.load(new Uint8Array([1, 2, 3]));

      // Wait for append loop to complete
      await vi.waitFor(
        () => {
          expect(host.state).toBe('complete');
        },
        { timeout: 2000 },
      );

      expect(states).toContain('opening');
      expect(states).toContain('renderShellReady');
      expect(states).toContain('firstWindowProjected');
      expect(states).toContain('firstPaintComplete');
      expect(states).toContain('streaming');
      expect(states).toContain('complete');
    });
  });

  describe('append without full rebuild', () => {
    it('calls incrementalLayout with previousBlocks and previousLayout on append', async () => {
      const runtime = createMockRuntime();

      // Make it a 6-child document, first window gets 3, next gets 3
      configureDocumentWindow(runtime, { totalBodyChildCount: 6 });
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeWindowResult([makeBlock('b4'), makeBlock('b5'), makeBlock('b6')], 6, 6),
      );

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      // Wait for append to complete
      await vi.waitFor(
        () => {
          expect(incrementalLayoutMock).toHaveBeenCalledTimes(2);
        },
        { timeout: 2000 },
      );

      // First call: fresh layout (previousBlocks = [], previousLayout = null)
      const firstCall = incrementalLayoutMock.mock.calls[0];
      expect(firstCall[0]).toEqual([]); // previousBlocks
      expect(firstCall[1]).toBeNull(); // previousLayout

      // Second call: incremental (previousBlocks = first 3, previousLayout != null)
      const secondCall = incrementalLayoutMock.mock.calls[1];
      expect(secondCall[0]).toHaveLength(3); // previousBlocks
      expect(secondCall[1]).not.toBeNull(); // previousLayout
      expect(secondCall[2]).toHaveLength(6); // nextBlocks (all accumulated)
    });

    it('uses continuation body-child progress instead of block count when appending', async () => {
      const runtime = createMockRuntime();
      (runtime.getRenderShell as ReturnType<typeof vi.fn>).mockResolvedValue(makeShell(2));
      (runtime.projectWindow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeWindowResult([makeBlock('b1'), makeBlock('b2')], 1, 2),
      );
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeWindowResult([makeBlock('b3')], 2, 2),
      );

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      await vi.waitFor(
        () => {
          expect(runtime.projectNextWindow).toHaveBeenCalledWith({
            nextBodyChildIndex: 1,
            maxBodyChildCount: 3,
          });
        },
        { timeout: 2000 },
      );
    });
  });

  describe('virtualization enabled by default', () => {
    it('creates DomPainter with virtualization enabled', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      expect(createDomPainterMock).toHaveBeenCalledWith(
        expect.objectContaining({
          flowMode: 'paginated',
          virtualization: expect.objectContaining({
            enabled: true,
          }),
        }),
      );
    });
  });

  describe('render-shell section metadata', () => {
    it('passes section metadata derived from the render shell into layout', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      const layoutOptions = incrementalLayoutMock.mock.calls[0][3];
      expect(layoutOptions.sectionMetadata).toEqual([
        expect.objectContaining({
          sectionIndex: 0,
          pageSize: { w: 816, h: 1056 },
          margins: { top: 96, right: 96, bottom: 96, left: 96 },
        }),
      ]);
    });
  });

  describe('zoom correctness', () => {
    it('forwards setZoom to the painter', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      host.setZoom(1.5);
      expect(painter.setZoom).toHaveBeenCalledWith(1.5);
    });

    it('validates zoom values', () => {
      const runtime = createMockRuntime();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
      });

      expect(() => host.setZoom(0)).toThrow();
      expect(() => host.setZoom(-1)).toThrow();
      expect(() => host.setZoom(NaN)).toThrow();
      expect(() => host.setZoom(Infinity)).toThrow();
    });
  });

  describe('stale load cancellation', () => {
    it('abandons the first load when a second load is called immediately', async () => {
      const runtime = createMockRuntime();

      // Make the first openSource slow
      let resolveFirstOpen: () => void;
      const firstOpenPromise = new Promise<{ sessionId: string }>((resolve) => {
        resolveFirstOpen = () => resolve({ sessionId: 'session-1' });
      });

      let openCallCount = 0;
      (runtime.openSource as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        openCallCount++;
        if (openCallCount === 1) return firstOpenPromise;
        return { sessionId: 'session-2' };
      });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      // Both set bodyChildCount = 3 so they'll complete in one window
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      // Start first load, don't await
      const load1 = host.load(new Uint8Array([1]));
      // Start second load immediately
      const load2 = host.load(new Uint8Array([2]));

      // Resolve the first open (should be ignored due to generation mismatch)
      resolveFirstOpen!();

      await load1;
      await load2;

      // The host should be in a completed state from the second load
      expect(host.state).not.toBe('failed');
      // openSource should have been called twice
      expect(runtime.openSource).toHaveBeenCalledTimes(2);
    });
  });

  describe('page completeness transitions', () => {
    it('marks pages as body-complete after append', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 6 });
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeWindowResult([makeBlock('b4'), makeBlock('b5'), makeBlock('b6')], 6, 6),
      );

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      // After first paint, pages are not body-complete yet (more windows pending)
      // We need to check after the streaming completes
      await vi.waitFor(
        () => {
          expect(host.state).toBe('complete');
        },
        { timeout: 2000 },
      );

      // After all windows consumed, all pages should be body-complete
      const pages = host.getPages();
      for (const page of pages) {
        const c = host.getPageCompleteness(page.number);
        expect(c.bodyComplete).toBe(true);
        expect(c.isFullyComplete).toBe(true);
        expect(c.hasDeferredDependencies).toBe(false);
      }
    });
  });

  describe('prefetch behavior', () => {
    it('prefetches the next window after first paint when more body children remain', async () => {
      const runtime = createMockRuntime();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      expect(runtime.prefetchWindow).toHaveBeenCalledWith({
        startBodyChildIndex: 3,
        maxBodyChildCount: 3,
      });
    });
  });

  describe('non-fatal append error', () => {
    it('transitions to degraded on append failure, first paint remains', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 6 });
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));

      const errorHandler = vi.fn();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });
      host.onLayoutError(errorHandler);

      await host.load(new Uint8Array([1, 2, 3]));

      // Wait for the append to fail
      await vi.waitFor(
        () => {
          expect(host.state).toBe('degraded');
        },
        { timeout: 2000 },
      );

      expect(errorHandler).toHaveBeenCalled();
      // Layout snapshot should still exist from first paint
      expect(host.getLayoutSnapshot().layout).not.toBeNull();
    });
  });

  describe('fatal open error', () => {
    it('transitions to failed when openSource throws', async () => {
      const runtime = createMockRuntime({
        openSource: vi.fn().mockRejectedValue(new Error('open failed')),
      });

      const errorHandler = vi.fn();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
      });
      host.onLayoutError(errorHandler);

      await expect(host.load(new Uint8Array([1, 2, 3]))).rejects.toThrow('open failed');

      expect(host.state).toBe('failed');
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('empty document', () => {
    it('transitions to failed when render shell has zero body children', async () => {
      const runtime = createMockRuntime({
        getRenderShell: vi.fn().mockResolvedValue(makeShell(0)),
      });

      const errorHandler = vi.fn();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
      });
      host.onLayoutError(errorHandler);

      await expect(host.load(new Uint8Array([1, 2, 3]))).rejects.toThrow('Empty or invalid document');

      expect(host.state).toBe('failed');
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('layout snapshot', () => {
    it('returns the accumulated state', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      const snapshot = host.getLayoutSnapshot();
      expect(snapshot.blocks).toHaveLength(3);
      expect(snapshot.measures).toHaveLength(3);
      expect(snapshot.layout).not.toBeNull();
      expect(snapshot.layout!.pages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('events', () => {
    it('emits firstPaintComplete with page count', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const handler = vi.fn();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });
      host.onFirstPaintComplete(handler);

      await host.load(new Uint8Array([1, 2, 3]));

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ pageCount: expect.any(Number) }));
    });

    it('emits layoutUpdated on each render cycle', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const handler = vi.fn();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });
      host.onLayoutUpdated(handler);

      await host.load(new Uint8Array([1, 2, 3]));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.any(Array),
          measures: expect.any(Array),
          layout: expect.any(Object),
        }),
      );
    });
  });

  describe('destroy', () => {
    it('closes the runtime and cleans up DOM', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const hostElement = document.createElement('div');
      const host = new V2StreamingPaginatedRenderHost({
        element: hostElement,
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));
      host.destroy();

      expect(runtime.close).toHaveBeenCalled();
      expect(hostElement.children).toHaveLength(0);
    });
  });
});
