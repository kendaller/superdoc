import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V2StreamingPaginatedRenderHost } from './V2StreamingPaginatedRenderHost.js';
import type { DocumentRuntime, RenderShellSnapshot, WindowedProjectionResult } from '@superdoc/v2-model';
import type { HostState, StateChangeEvent, DegradedInfo } from './streaming-host-types.js';

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

function makeShell(
  bodyChildCount: number,
  pageGeometry: { width: number; height: number } = { width: 12240, height: 15840 },
): RenderShellSnapshot {
  return {
    bodyChildCount,
    sections: [
      {
        index: 0,
        pageGeometry: {
          width: pageGeometry.width,
          height: pageGeometry.height,
          margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
        headerRefs: [],
        footerRefs: [],
      },
    ],
    primaryPageGeometry: {
      width: pageGeometry.width,
      height: pageGeometry.height,
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
  projectionStats?: WindowedProjectionResult['projectionStats'],
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
    ...(projectionStats ? { projectionStats } : {}),
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
    advanceRenderShell: vi.fn().mockResolvedValue(undefined),
    advanceStructure: vi.fn().mockResolvedValue(undefined),
    enrich: vi.fn().mockResolvedValue({ target: 'comments', mergePolicy: 'overlay-only', items: [] }),
    cancelTask: vi.fn(),
    status: vi.fn().mockResolvedValue({ stage: 'first-paint-shell' }),
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
      expect(runtime.ready).toHaveBeenCalledWith('first-paint-shell');
      expect(runtime.getRenderShell).toHaveBeenCalledTimes(2);
      expect(runtime.advanceRenderShell).toHaveBeenCalledTimes(1);
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
            stopAfterPageEstimate: 2,
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

    it('applies render-shell caps before building section metadata', async () => {
      const runtime = createMockRuntime();
      (runtime.getRenderShell as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeShell(3, { width: 60_000, height: 70_000 }),
      );
      (runtime.projectWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWindowResult([makeBlock('b1'), makeBlock('b2'), makeBlock('b3')], 3, 3),
      );

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
          pageSize: { w: 2880, h: 2880 },
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

  describe('cancellation & reopen hardening', () => {
    it('open-A-cancel-open-B: second load wins, no stale blocks from first', async () => {
      const runtime = createMockRuntime();

      // First openSource is slow — held by a deferred promise
      let resolveFirstOpen!: () => void;
      const firstOpenPromise = new Promise<{ sessionId: string }>((resolve) => {
        resolveFirstOpen = () => resolve({ sessionId: 'session-A' });
      });

      let openCall = 0;
      (runtime.openSource as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        openCall++;
        if (openCall === 1) return firstOpenPromise;
        return { sessionId: 'session-B' };
      });

      // Load 1 never gets past openSource, so getRenderShell and projectWindow
      // are only called by load 2. Use simple mocks that return source-B data.
      const blocksB = [makeBlock('B1'), makeBlock('B2')];
      (runtime.getRenderShell as ReturnType<typeof vi.fn>).mockResolvedValue(makeShell(2));
      (runtime.projectWindow as ReturnType<typeof vi.fn>).mockResolvedValue(makeWindowResult(blocksB, 2, 2));

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 50,
      });

      // Start first load without awaiting
      const load1 = host.load(new Uint8Array([1]));
      // Immediately start second load — bumps generation
      const load2 = host.load(new Uint8Array([2]));

      // Resolve first open after second load started — should be ignored
      resolveFirstOpen();

      await load1; // resolves silently (gen mismatch causes early return)
      await load2;

      expect(runtime.openSource).toHaveBeenCalledTimes(2);
      expect(host.state).toBe('complete');

      // Verify only source B blocks are present
      const snapshot = host.getLayoutSnapshot();
      expect(snapshot.blocks.map((b: { id: string }) => b.id)).toEqual(['B1', 'B2']);
    });

    it('reopen-same-doc resets accumulated state and triggers fresh first paint', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 50,
      });

      // First load — to firstPaintComplete and complete
      await host.load(new Uint8Array([1, 2, 3]));
      expect(host.state).toBe('complete');
      const firstSnapshot = host.getLayoutSnapshot();
      expect(firstSnapshot.blocks).toHaveLength(3);

      // Reset mocks for second load
      vi.clearAllMocks();
      incrementalLayoutMock.mockImplementation(
        async (_prev: unknown, _prevLayout: unknown, nextBlocks: { id: string }[]) => {
          return makeLayoutResult(Math.max(1, Math.ceil(nextBlocks.length / 2)), nextBlocks);
        },
      );
      createDomPainterMock.mockReturnValue(painter);

      // Configure new blocks for second load
      const newBlocks = [makeBlock('new1'), makeBlock('new2')];
      (runtime.getRenderShell as ReturnType<typeof vi.fn>).mockResolvedValue(makeShell(2));
      (runtime.projectWindow as ReturnType<typeof vi.fn>).mockResolvedValue(makeWindowResult(newBlocks, 2, 2));

      // Second load — same doc, different bytes
      await host.load(new Uint8Array([4, 5, 6]));

      expect(host.state).toBe('complete');
      // Verify accumulated blocks are from the second load only
      const secondSnapshot = host.getLayoutSnapshot();
      expect(secondSnapshot.blocks.map((b: { id: string }) => b.id)).toEqual(['new1', 'new2']);
      // First paint occurred twice (openSource called once per load)
      expect(runtime.openSource).toHaveBeenCalledTimes(1);
    });

    it('destroy-during-load does not throw and calls runtime.close', async () => {
      const runtime = createMockRuntime();

      // Make openSource slow
      let resolveOpen!: () => void;
      (runtime.openSource as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<{ sessionId: string }>((resolve) => {
            resolveOpen = () => resolve({ sessionId: 'test' });
          }),
      );

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      // Start load — it's waiting on openSource
      const loadPromise = host.load(new Uint8Array([1, 2, 3]));

      // Destroy while load is in flight
      host.destroy();

      // Resolve the pending open — should be silently ignored
      resolveOpen();
      await loadPromise; // Should resolve without throwing

      expect(runtime.close).toHaveBeenCalled();
    });

    it('rapid scroll during streaming does not pile up append requests', async () => {
      const runtime = createMockRuntime();

      // 20 body children, first window gets 3
      configureDocumentWindow(runtime, { totalBodyChildCount: 20 });

      // Make append windows slow enough to observe append scheduling.
      let appendCallCount = 0;
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        appendCallCount++;
        const start = 3 + (appendCallCount - 1) * 3;
        const end = Math.min(start + 3, 20);
        const blocks = Array.from({ length: end - start }, (_, i) => makeBlock(`b${start + i + 1}`));
        return makeWindowResult(blocks, end, 20);
      });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));
      expect(host.state).toBe('streaming');

      for (let attempt = 0; attempt < 10; attempt += 1) {
        host.element.dispatchEvent(new Event('scroll'));
      }

      // Wait for streaming to complete
      await vi.waitFor(
        () => {
          expect(host.state).toBe('complete');
        },
        { timeout: 5000 },
      );

      // All 20 body children should have been consumed
      const snapshot = host.getLayoutSnapshot();
      expect(snapshot.blocks.length).toBe(20);
      expect(runtime.prefetchWindow).not.toHaveBeenCalled();
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

  describe('buffered append behavior', () => {
    it('uses page-bounded append windows after first paint', async () => {
      const runtime = createMockRuntime();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      await vi.waitFor(
        () => {
          expect(runtime.projectNextWindow).toHaveBeenCalledWith({
            nextBodyChildIndex: 3,
            maxBodyChildCount: 3,
            stopAfterPageEstimate: 2,
          });
        },
        { timeout: 2000 },
      );

      expect(runtime.prefetchWindow).not.toHaveBeenCalled();
    });

    it('shrinks the next append batch after a slow field-heavy append', async () => {
      let nowMs = 0;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

      const runtime = createMockRuntime();
      (runtime.getRenderShell as ReturnType<typeof vi.fn>).mockResolvedValue(makeShell(40));
      (runtime.projectWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWindowResult([makeBlock('b1'), makeBlock('b2'), makeBlock('b3')], 3, 40),
      );

      let appendCallCount = 0;
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockImplementation(async (continuation) => {
        appendCallCount++;

        if (appendCallCount === 1) {
          nowMs = 300;
          return makeWindowResult([makeBlock('b4'), makeBlock('b5')], 16, 40, {
            fieldHeavyParagraphs: 8,
            plainParagraphs: 2,
            complexParagraphs: 0,
            runsSkipped: 24,
          });
        }

        return makeWindowResult([makeBlock('b6'), makeBlock('b7')], continuation.nextBodyChildIndex + 2, 40);
      });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 50,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      await vi.waitFor(
        () => {
          expect(runtime.projectNextWindow).toHaveBeenCalledWith({
            nextBodyChildIndex: 16,
            maxBodyChildCount: 6,
            stopAfterPageEstimate: 2,
          });
        },
        { timeout: 2000 },
      );

      nowSpy.mockRestore();
    });

    it('stops appending once the viewport has enough buffered pages', async () => {
      incrementalLayoutMock.mockImplementation(
        async (_previousBlocks: unknown, _previousLayout: unknown, nextBlocks: { id: string }[]) => {
          return {
            layout: {
              pageSize: { w: 612, h: 792 },
              pages: nextBlocks.map((_block, index) => ({
                number: index + 1,
                fragments: [],
                size: { w: 612, h: 792 },
              })),
            },
            measures: nextBlocks.map((block) => ({ blockId: block.id, width: 100, height: 20 })),
            dirty: { dirtyFromIndex: 0 },
          };
        },
      );

      const runtime = createMockRuntime();
      (runtime.getRenderShell as ReturnType<typeof vi.fn>).mockResolvedValue(makeShell(40));
      (runtime.projectWindow as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWindowResult([makeBlock('b1'), makeBlock('b2'), makeBlock('b3')], 3, 40),
      );

      let nextBodyChildIndex = 3;
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        const start = nextBodyChildIndex;
        const blockIds = [`b${start + 1}`, `b${start + 2}`];
        nextBodyChildIndex += blockIds.length;
        return makeWindowResult(blockIds.map(makeBlock), nextBodyChildIndex, 40);
      });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 50,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      await vi.waitFor(
        () => {
          expect(runtime.projectNextWindow).toHaveBeenCalledTimes(4);
        },
        { timeout: 2000 },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(host.state).toBe('streaming');
      expect(host.getPages()).toHaveLength(11);
      expect(runtime.projectNextWindow).toHaveBeenCalledTimes(4);
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

  describe('degraded mode policy', () => {
    it('append failure produces append-stalled degraded info', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 6 });
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      await vi.waitFor(
        () => {
          expect(host.state).toBe('degraded');
        },
        { timeout: 2000 },
      );

      const info = host.getDegradedInfo();
      expect(info).not.toBeNull();
      expect(info!.reason).toBe('append-stalled');
      expect(info!.message).toBe('network error');
      expect(info!.recoverable).toBe(true);
      expect(info!.timestamp).toBeGreaterThan(0);
    });

    it('degradedInfo is included in stateChange event', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 6 });
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const stateEvents: StateChangeEvent[] = [];
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });
      host.onStateChange((event: StateChangeEvent) => stateEvents.push(event));

      await host.load(new Uint8Array([1, 2, 3]));

      await vi.waitFor(
        () => {
          expect(host.state).toBe('degraded');
        },
        { timeout: 2000 },
      );

      const degradedEvent = stateEvents.find((e) => e.current === 'degraded');
      expect(degradedEvent).toBeDefined();
      expect(degradedEvent!.degradedInfo).toBeDefined();
      expect(degradedEvent!.degradedInfo!.reason).toBe('append-stalled');
    });

    it('retryAppend recovers from append-stalled state', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 6 });

      // First append fails
      let appendCallCount = 0;
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        appendCallCount++;
        if (appendCallCount === 1) {
          throw new Error('transient failure');
        }
        return makeWindowResult([makeBlock('b4'), makeBlock('b5'), makeBlock('b6')], 6, 6);
      });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      // Wait for first append to fail
      await vi.waitFor(
        () => {
          expect(host.state).toBe('degraded');
        },
        { timeout: 2000 },
      );

      expect(host.getDegradedInfo()!.reason).toBe('append-stalled');

      // Retry — second append succeeds
      host.retryAppend();

      await vi.waitFor(
        () => {
          expect(host.state).toBe('complete');
        },
        { timeout: 2000 },
      );

      expect(host.getDegradedInfo()).toBeNull();
      expect(host.getLayoutSnapshot().blocks).toHaveLength(6);
    });

    it('retryAppend is a no-op when not in append-stalled degraded state', () => {
      const runtime = createMockRuntime();
      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
      });

      // Not degraded — retryAppend should be a no-op
      host.retryAppend();
      expect(host.state).toBe('idle');
    });

    it('getDegradedInfo returns null when not degraded', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      expect(host.state).toBe('complete');
      expect(host.getDegradedInfo()).toBeNull();
    });

    it('degradedInfo is cleared on reload', async () => {
      const runtime = createMockRuntime();
      configureDocumentWindow(runtime, { totalBodyChildCount: 6 });
      (runtime.projectNextWindow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const host = new V2StreamingPaginatedRenderHost({
        element: document.createElement('div'),
        runtime,
        windowSize: 3,
      });

      await host.load(new Uint8Array([1, 2, 3]));

      await vi.waitFor(
        () => {
          expect(host.state).toBe('degraded');
        },
        { timeout: 2000 },
      );

      expect(host.getDegradedInfo()).not.toBeNull();

      // Reload with a fresh doc
      vi.clearAllMocks();
      incrementalLayoutMock.mockImplementation(
        async (_prev: unknown, _prevLayout: unknown, nextBlocks: { id: string }[]) => {
          return makeLayoutResult(Math.max(1, Math.ceil(nextBlocks.length / 2)), nextBlocks);
        },
      );
      createDomPainterMock.mockReturnValue(painter);
      configureDocumentWindow(runtime, { totalBodyChildCount: 3 });

      await host.load(new Uint8Array([4, 5, 6]));

      expect(host.state).toBe('complete');
      expect(host.getDegradedInfo()).toBeNull();
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
