import { EventEmitter } from 'eventemitter3';
import { measureBlock } from '@superdoc/measuring-dom';
import { createDomPainter } from '@superdoc/painter-dom';
import type {
  DependencyManifest,
  DocumentRuntime,
  RenderShellSnapshot,
  WindowedProjectionResult,
} from '@superdoc/v2-model';
import type { FlowBlock, Layout, Measure, SectionMetadata } from '@superdoc/contracts';
import type { LayoutEngineOptions, TrackedChangesOverrides } from '../../v1/core/presentation-editor/types.js';
import { runInstrumentedIncrementalLayout } from '../../../core/perf/runInstrumentedIncrementalLayout.js';
import {
  v2PerfTimeline,
  SPAN_RENDER,
  SPAN_PAINT,
  PROJECTION_FIRST_WINDOW_START,
  PROJECTION_FIRST_WINDOW_COMPLETE,
  PROJECTION_APPEND_WINDOW_COUNT,
  LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT,
  PAINT_FIRST_PAGE_MOUNTED,
} from '@superdoc/v2-perf';
import { PageCompletenessTracker } from './page-completeness.js';
import type {
  HostState,
  StateTransitionEntry,
  StateChangeEvent,
  WindowRecord,
  AccumulatedState,
  V2StreamingLayoutSnapshot,
  V2StreamingLayoutPayload,
  PageCompleteness,
} from './streaming-host-types.js';

// ---- Constants ---------------------------------------------------------------

const DEFAULT_PAGE_SIZE = { w: 612, h: 792 };
const DEFAULT_MARGINS = { top: 72, right: 72, bottom: 72, left: 72 };
const DEFAULT_PAGE_GAP = 24;
const DEFAULT_HORIZONTAL_PAGE_GAP = 20;
const DEFAULT_LAYOUT_MODE = 'vertical';
const DEFAULT_WINDOW_SIZE = 50;
const DEFAULT_FIRST_WINDOW_PAGE_ESTIMATE = 3;
const PREFETCH_AHEAD_PAGES = 10;
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;

type DocumentMode = 'editing' | 'viewing' | 'suggesting';

export type V2StreamingPaginatedRenderHostOptions = {
  element: HTMLElement;
  documentId?: string;
  layoutEngineOptions?: LayoutEngineOptions;
  documentMode?: DocumentMode;
  disableContextMenu?: boolean;
  /** The DocumentRuntime to use (worker proxy or in-process). */
  runtime: DocumentRuntime;
  /** Body children per projection window. Default: 50. */
  windowSize?: number;
  /** stopAfterPageEstimate for the first window. Default: 3. */
  firstWindowPageEstimate?: number;
};

// ---- Host class --------------------------------------------------------------

/**
 * Streaming paginated host for the v2 rendering pipeline.
 *
 * Programs against the DocumentRuntime interface. Renders the first page
 * from a partial block window, then appends more blocks progressively
 * via incremental layout. Virtualization is enabled by default.
 *
 * State machine: idle → opening → renderShellReady → firstWindowProjected →
 * firstPaintComplete → streaming → enriching → complete
 */
export class V2StreamingPaginatedRenderHost extends EventEmitter {
  readonly element: HTMLElement;
  readonly options: { documentId?: string };

  #runtime: DocumentRuntime;
  #viewportHost: HTMLDivElement;
  #painterHost: HTMLDivElement;
  #domPainter: ReturnType<typeof createDomPainter> | null = null;
  #layoutEngineOptions: LayoutEngineOptions;
  #documentMode: DocumentMode;
  #disableContextMenu: boolean;
  #trackedChangesOverrides: TrackedChangesOverrides | undefined;

  #state: HostState = 'idle';
  #stateHistory: StateTransitionEntry[] = [{ state: 'idle', timestamp: perfNow() }];

  #renderShell: RenderShellSnapshot | null = null;
  #accumulated: AccumulatedState = createEmptyAccumulated();
  #completeness = new PageCompletenessTracker();

  #windowSize: number;
  #firstWindowPageEstimate: number;

  /** Incremented on each load() to invalidate stale async continuations. */
  #generation = 0;
  #appendInFlight = false;
  #prefetchInFlight = false;
  #prefetchedStartBodyChildIndex: number | null = null;
  #scrollRafPending = false;
  #scrollHandler: (() => void) | null = null;

  constructor(options: V2StreamingPaginatedRenderHostOptions) {
    super();

    this.element = options.element;
    this.options = { documentId: options.documentId };
    this.#runtime = options.runtime;
    this.#layoutEngineOptions = normalizeLayoutEngineOptions(options.layoutEngineOptions);
    this.#documentMode = options.documentMode ?? 'editing';
    this.#disableContextMenu = Boolean(options.disableContextMenu);
    this.#windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.#firstWindowPageEstimate = options.firstWindowPageEstimate ?? DEFAULT_FIRST_WINDOW_PAGE_ESTIMATE;

    this.#viewportHost = document.createElement('div');
    this.#viewportHost.className = 'presentation-editor__viewport v2-streaming-renderer__viewport';
    this.#viewportHost.setAttribute('aria-hidden', 'true');

    this.#painterHost = document.createElement('div');
    this.#painterHost.className = 'presentation-editor__pages v2-streaming-renderer__pages';

    this.#viewportHost.appendChild(this.#painterHost);
    this.element.replaceChildren(this.#viewportHost);

    applyHostStyles(
      this.element,
      this.#viewportHost,
      this.#painterHost,
      this.#layoutEngineOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h,
    );

    this.#installScrollListener();
  }

  // ---- Public: State inspection ------------------------------------------------

  get state(): HostState {
    return this.#state;
  }

  get stateHistory(): readonly StateTransitionEntry[] {
    return this.#stateHistory;
  }

  get isStreaming(): boolean {
    return this.#state === 'streaming' || this.#state === 'enriching';
  }

  // ---- Public: Lifecycle -------------------------------------------------------

  async load(source: Uint8Array | Blob): Promise<void> {
    const gen = ++this.#generation;
    this.#resetState();
    this.#transition('opening');

    try {
      // Phase 1: Open + render-shell
      await this.#runtime.openSource(source);
      if (gen !== this.#generation) return;

      await this.#runtime.ready('render-shell');
      if (gen !== this.#generation) return;

      const shell = await this.#runtime.getRenderShell();
      if (gen !== this.#generation) return;

      if (!shell || shell.bodyChildCount === 0) {
        throw new Error('Empty or invalid document: no body children');
      }

      this.#renderShell = shell;
      this.#accumulated.totalBodyChildCount = shell.bodyChildCount;
      this.#accumulated.sectionMetadata = buildSectionMetadataFromRenderShell(shell);
      this.#transition('renderShellReady');

      // Phase 2: First window projection
      v2PerfTimeline.mark(PROJECTION_FIRST_WINDOW_START);
      const windowResult = await this.#runtime.projectWindow({
        startBodyChildIndex: 0,
        maxBodyChildCount: this.#windowSize,
        stopAfterPageEstimate: this.#firstWindowPageEstimate,
        includeDependencyManifest: true,
      });
      if (gen !== this.#generation) return;
      v2PerfTimeline.mark(PROJECTION_FIRST_WINDOW_COMPLETE);

      this.#accumulateWindow(windowResult, 0);
      this.#transition('firstWindowProjected');

      // Phase 3: Measure + paginate + paint
      const endRender = v2PerfTimeline.startSpan(SPAN_RENDER);
      try {
        await this.#measurePaginatePaint();
      } finally {
        endRender();
      }
      if (gen !== this.#generation) return;

      this.#transition('firstPaintComplete');

      v2PerfTimeline.mark(PAINT_FIRST_PAGE_MOUNTED);
      v2PerfTimeline.gauge(LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT, countMountedPages(this.#painterHost));

      const firstPaintPayload = {
        pageCount: this.#accumulated.layout?.pages.length ?? 0,
      };
      this.emit('firstPaintComplete', firstPaintPayload);

      // Phase 4: Schedule background streaming or go straight to enriching
      if (this.#accumulated.nextBodyChildIndex < this.#accumulated.totalBodyChildCount) {
        this.#transition('streaming');
        this.#prefetchUpcomingWindow();
        this.#scheduleAppendLoop();
      } else {
        this.#completeness.markAllBodyComplete();
        this.#transition('enriching');
        this.#scheduleEnrichment();
      }
    } catch (error) {
      if (gen !== this.#generation) return;
      const normalized = normalizeError(error);
      this.#transition('failed');
      this.#emitLayoutError(normalized, 'load');
      throw normalized;
    }
  }

  destroy(): void {
    this.#generation++;
    this.#removeScrollListener();
    this.#domPainter = null;
    this.element.replaceChildren();
    void this.#runtime.close();
    this.emit('destroy');
    this.removeAllListeners();
  }

  // ---- Public: Layout inspection -----------------------------------------------

  getLayoutSnapshot(): V2StreamingLayoutSnapshot {
    return {
      blocks: [...this.#accumulated.blocks],
      measures: [...this.#accumulated.measures],
      layout: this.#accumulated.layout,
      isStreaming: this.isStreaming,
    };
  }

  getPages(): Layout['pages'] {
    return this.#accumulated.layout?.pages ?? [];
  }

  getPageCompleteness(pageNumber: number): PageCompleteness {
    return this.#completeness.getCompleteness(pageNumber);
  }

  // ---- Public: Configuration ---------------------------------------------------

  setZoom(zoom: number): void {
    validateZoom(zoom);
    this.#layoutEngineOptions.zoom = zoom;
    this.#applyZoom();
    this.#domPainter?.setZoom?.(zoom);
    this.emit('zoomChange', { zoom });
  }

  setDocumentMode(mode: DocumentMode): void {
    this.#documentMode = mode;
  }

  updateLayoutEngineOptions(nextOptions?: LayoutEngineOptions): void {
    if (!nextOptions) return;

    const previousZoom = this.#layoutEngineOptions.zoom ?? 1;
    this.#layoutEngineOptions = normalizeLayoutEngineOptions({
      ...this.#layoutEngineOptions,
      ...nextOptions,
    });

    const nextZoom = this.#layoutEngineOptions.zoom ?? 1;
    if (nextZoom !== previousZoom) {
      this.setZoom(nextZoom);
      return;
    }

    // If layout options changed and we have a layout, trigger a full re-render
    if (this.#accumulated.layout) {
      this.#accumulated.layout = null; // Force full re-layout
      void this.#measurePaginatePaint().catch((error) => this.#emitLayoutError(error, 'render'));
    }
  }

  setTrackedChangesOverrides(overrides?: TrackedChangesOverrides): void {
    this.#trackedChangesOverrides = overrides;
  }

  setViewingCommentOptions(_options?: {
    emitCommentPositionsInViewing?: boolean;
    enableCommentsInViewing?: boolean;
  }): void {}

  setContextMenuDisabled(disabled: boolean): void {
    this.#disableContextMenu = Boolean(disabled);
  }

  focus(): void {}

  // ---- Public: Event subscription ----------------------------------------------

  onLayoutUpdated(handler: (payload: V2StreamingLayoutPayload) => void): () => void {
    this.on('layoutUpdated', handler);
    return () => this.off('layoutUpdated', handler);
  }

  onLayoutError(handler: (error: { phase: string; error: Error; timestamp: number }) => void): () => void {
    this.on('layoutError', handler);
    return () => this.off('layoutError', handler);
  }

  onFirstPaintComplete(handler: (payload: { pageCount: number }) => void): () => void {
    this.on('firstPaintComplete', handler);
    return () => this.off('firstPaintComplete', handler);
  }

  onStateChange(handler: (event: StateChangeEvent) => void): () => void {
    this.on('stateChange', handler);
    return () => this.off('stateChange', handler);
  }

  // ---- Private: State machine --------------------------------------------------

  #transition(next: HostState): void {
    const previous = this.#state;
    this.#state = next;
    const entry: StateTransitionEntry = { state: next, timestamp: perfNow() };
    this.#stateHistory.push(entry);
    this.emit('stateChange', { previous, current: next, timestamp: entry.timestamp } satisfies StateChangeEvent);
  }

  #resetState(): void {
    this.#accumulated = createEmptyAccumulated();
    this.#completeness.reset();
    this.#renderShell = null;
    this.#appendInFlight = false;
    this.#prefetchInFlight = false;
    this.#prefetchedStartBodyChildIndex = null;
  }

  // ---- Private: Window accumulation --------------------------------------------

  #accumulateWindow(windowResult: WindowedProjectionResult, startIndex: number): void {
    const { blocks, continuation, sectionMetadata, dependencyManifest } = windowResult;
    const bodyChildCount = Math.max(0, continuation.nextBodyChildIndex - startIndex);

    const record: WindowRecord = {
      index: this.#accumulated.windowRecords.length,
      startBodyChildIndex: startIndex,
      bodyChildCount,
      blockCount: blocks.length,
      blocks,
      sectionMetadataDelta: sectionMetadata,
      ...(dependencyManifest ? { dependencyManifest } : {}),
      status: 'projected',
    };
    this.#accumulated.windowRecords.push(record);
    this.#accumulated.blocks = [...this.#accumulated.blocks, ...blocks];
    this.#accumulated.nextBodyChildIndex = continuation.nextBodyChildIndex;
    this.#accumulated.totalBodyChildCount = continuation.totalBodyChildCount;
    if (dependencyManifest) {
      this.#accumulated.dependencyManifest = mergeDependencyManifests(
        this.#accumulated.dependencyManifest,
        dependencyManifest,
      );
    }
  }

  // ---- Private: Measure + paginate + paint pipeline ----------------------------

  async #measurePaginatePaint(): Promise<void> {
    const layoutOptions = this.#resolveLayoutInput();
    const acc = this.#accumulated;

    // Compute previousBlocks for incremental layout.
    // On first paint: previousBlocks is empty, previousLayout is null.
    // On append: previousBlocks is the blocks from all prior windows.
    const lastWindowBlockCount =
      acc.windowRecords.length > 0 ? acc.windowRecords[acc.windowRecords.length - 1].blockCount : 0;
    const previousBlocks = acc.layout ? acc.blocks.slice(0, acc.blocks.length - lastWindowBlockCount) : [];

    const { result } = await runInstrumentedIncrementalLayout({
      previousBlocks,
      previousLayout: acc.layout,
      nextBlocks: acc.blocks,
      layoutOptions,
      measureBlock: (block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) =>
        measureBlock(block, constraints),
      previousMeasures: acc.measures.length > 0 ? acc.measures : undefined,
    });

    result.layout.pageGap = getEffectivePageGap(this.#layoutEngineOptions);

    acc.measures = result.measures;
    acc.layout = result.layout;

    // Mark the last window as laid-out
    const lastRecord = acc.windowRecords[acc.windowRecords.length - 1];
    if (lastRecord) {
      lastRecord.status = 'laid-out';
    }

    // Paint
    const endPaint = v2PerfTimeline.startSpan(SPAN_PAINT);
    try {
      const painter = this.#ensurePainter(acc.blocks, result.measures);
      painter.setData?.(acc.blocks, result.measures);
      painter.paint(result.layout, this.#painterHost);
    } finally {
      endPaint();
    }

    this.#applyZoom();
    this.#completeness.syncWithLayout(result.layout);

    const payload: V2StreamingLayoutPayload = {
      blocks: acc.blocks,
      measures: result.measures,
      layout: result.layout,
    };
    this.emit('layoutUpdated', payload);
    this.emit('paginationUpdate', payload);
  }

  // ---- Private: Append pipeline ------------------------------------------------

  #scheduleAppendLoop(): void {
    if (this.#appendInFlight) return;

    if (this.#accumulated.nextBodyChildIndex >= this.#accumulated.totalBodyChildCount) {
      this.#completeness.markAllBodyComplete();
      if (this.#state === 'streaming') {
        this.#transition('enriching');
        this.#scheduleEnrichment();
      }
      return;
    }

    this.#appendInFlight = true;

    const schedule =
      typeof requestIdleCallback !== 'undefined' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0);

    schedule(() => void this.#appendNextWindow());
  }

  async #appendNextWindow(): Promise<void> {
    const gen = this.#generation;
    const prevPageCount = this.#accumulated.layout?.pages.length ?? 0;

    try {
      const continuation = {
        nextBodyChildIndex: this.#accumulated.nextBodyChildIndex,
        maxBodyChildCount: this.#windowSize,
      };

      const windowResult = await this.#runtime.projectNextWindow(continuation);
      if (gen !== this.#generation) return;

      const windowIndex = this.#accumulated.windowRecords.length;
      this.#accumulateWindow(windowResult, this.#accumulated.nextBodyChildIndex);

      await this.#measurePaginatePaint();
      if (gen !== this.#generation) return;

      // Pages from before this append are now body-complete
      this.#completeness.markBodyCompleteUpTo(prevPageCount);

      this.emit('appendComplete', {
        windowIndex,
        newPageCount: this.#accumulated.layout!.pages.length,
      });
      v2PerfTimeline.gauge(PROJECTION_APPEND_WINDOW_COUNT, windowIndex + 1);
      this.#prefetchUpcomingWindow();
    } catch (error) {
      if (gen !== this.#generation) return;
      this.#handleNonFatalError(error, 'append');
    } finally {
      this.#appendInFlight = false;
      if (gen === this.#generation) {
        this.#scheduleAppendLoop();
      }
    }
  }

  // ---- Private: Enrichment (stub — workstream 06) ------------------------------

  #scheduleEnrichment(): void {
    // Enrichment is not yet implemented. For now, mark complete immediately.
    // When workstream 06 lands, this will call:
    //   this.#runtime.enrich('headers-footers') etc.
    // and update PageCompletenessTracker as each target resolves.
    this.#completeness.markAllBodyComplete();
    this.#completeness.markAllEnrichmentComplete();
    this.#transition('complete');
  }

  #prefetchUpcomingWindow(): void {
    const startBodyChildIndex = this.#accumulated.nextBodyChildIndex;

    if (this.#prefetchInFlight) return;
    if (startBodyChildIndex >= this.#accumulated.totalBodyChildCount) return;
    if (this.#prefetchedStartBodyChildIndex === startBodyChildIndex) return;

    this.#prefetchInFlight = true;
    this.#prefetchedStartBodyChildIndex = startBodyChildIndex;

    void this.#runtime
      .prefetchWindow({
        startBodyChildIndex,
        maxBodyChildCount: this.#windowSize,
      })
      .catch((error) => {
        this.#prefetchedStartBodyChildIndex = null;
        this.#emitLayoutError(normalizeError(error), 'prefetch');
      })
      .finally(() => {
        this.#prefetchInFlight = false;
      });
  }

  // ---- Private: Scroll / prefetch ----------------------------------------------

  #installScrollListener(): void {
    this.#scrollHandler = () => {
      if (this.#scrollRafPending) return;
      this.#scrollRafPending = true;
      requestAnimationFrame(() => {
        this.#scrollRafPending = false;
        this.#domPainter?.onScroll?.();
        if (this.#state === 'streaming' || this.#state === 'firstPaintComplete') {
          this.#evaluatePrefetch();
        }
      });
    };
    this.element.addEventListener('scroll', this.#scrollHandler, { passive: true });
  }

  #removeScrollListener(): void {
    if (this.#scrollHandler) {
      this.element.removeEventListener('scroll', this.#scrollHandler);
      this.#scrollHandler = null;
    }
  }

  #evaluatePrefetch(): void {
    const layout = this.#accumulated.layout;
    if (!layout) return;

    const totalPages = layout.pages.length;
    const { last } = this.#getVisiblePageRange();

    if (totalPages >= last + PREFETCH_AHEAD_PAGES) return;
    if (this.#accumulated.nextBodyChildIndex >= this.#accumulated.totalBodyChildCount) return;
    if (this.#appendInFlight) return;

    this.#prefetchUpcomingWindow();
    this.#scheduleAppendLoop();
  }

  #getVisiblePageRange(): { first: number; last: number } {
    const layout = this.#accumulated.layout;
    if (!layout || layout.pages.length === 0) return { first: 1, last: 1 };

    const scrollTop = this.element.scrollTop;
    const viewportHeight = this.element.clientHeight;
    const zoom = this.#layoutEngineOptions.zoom ?? 1;
    const pageGap = getEffectivePageGap(this.#layoutEngineOptions);

    let cumulativeY = 0;
    let first = 1;
    let last = 1;
    let foundFirst = false;

    for (const page of layout.pages) {
      const pageHeight = (page.size?.h ?? layout.pageSize.h) * zoom;
      const pageTop = cumulativeY * zoom;
      const pageBottom = pageTop + pageHeight;

      if (!foundFirst && pageBottom >= scrollTop) {
        first = page.number;
        foundFirst = true;
      }

      if (pageTop <= scrollTop + viewportHeight) {
        last = page.number;
      }

      cumulativeY += (page.size?.h ?? layout.pageSize.h) + pageGap;
    }

    return { first, last };
  }

  // ---- Private: DomPainter integration -----------------------------------------

  #ensurePainter(blocks: FlowBlock[], measures: Measure[]): ReturnType<typeof createDomPainter> {
    const effectivePageGap = getEffectivePageGap(this.#layoutEngineOptions);

    if (!this.#domPainter) {
      const virtConfig =
        this.#layoutEngineOptions.virtualization?.enabled !== false
          ? {
              enabled: true as const,
              window: this.#layoutEngineOptions.virtualization?.window ?? 5,
              overscan: this.#layoutEngineOptions.virtualization?.overscan ?? 1,
              gap: this.#layoutEngineOptions.virtualization?.gap ?? effectivePageGap,
            }
          : { enabled: false as const };

      this.#domPainter = createDomPainter({
        blocks,
        measures,
        layoutMode: this.#layoutEngineOptions.layoutMode ?? DEFAULT_LAYOUT_MODE,
        flowMode: 'paginated',
        pageGap: effectivePageGap,
        virtualization: virtConfig,
      });
      this.#domPainter.setScrollContainer?.(this.element);
      this.#domPainter.setZoom?.(this.#layoutEngineOptions.zoom ?? 1);
      return this.#domPainter;
    }

    return this.#domPainter;
  }

  #resolveLayoutInput(): {
    pageSize: { w: number; h: number };
    margins: { top: number; right: number; bottom: number; left: number; header?: number; footer?: number };
    columns?: { count: number; gap: number };
    flowMode: 'paginated';
    sectionMetadata: SectionMetadata[];
  } {
    // Use render shell geometry if available, fall back to layout engine options
    const shell = this.#renderShell;
    const geo = shell?.primaryPageGeometry;

    const pageSize = {
      w: geo ? normalizeTwips(geo.width) : (this.#layoutEngineOptions.pageSize?.w ?? DEFAULT_PAGE_SIZE.w),
      h: geo ? normalizeTwips(geo.height) : (this.#layoutEngineOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h),
    };

    const margins = {
      top: geo ? normalizeTwips(geo.margins.top) : (this.#layoutEngineOptions.margins?.top ?? DEFAULT_MARGINS.top),
      right: geo
        ? normalizeTwips(geo.margins.right)
        : (this.#layoutEngineOptions.margins?.right ?? DEFAULT_MARGINS.right),
      bottom: geo
        ? normalizeTwips(geo.margins.bottom)
        : (this.#layoutEngineOptions.margins?.bottom ?? DEFAULT_MARGINS.bottom),
      left: geo ? normalizeTwips(geo.margins.left) : (this.#layoutEngineOptions.margins?.left ?? DEFAULT_MARGINS.left),
      ...(this.#layoutEngineOptions.margins?.header != null
        ? { header: this.#layoutEngineOptions.margins.header }
        : {}),
      ...(this.#layoutEngineOptions.margins?.footer != null
        ? { footer: this.#layoutEngineOptions.margins.footer }
        : {}),
    };

    return {
      flowMode: 'paginated',
      pageSize,
      margins,
      sectionMetadata: this.#accumulated.sectionMetadata,
    };
  }

  #applyZoom(): void {
    const layout = this.#accumulated.layout;
    const zoom = this.#layoutEngineOptions.zoom ?? 1;
    const pages = layout?.pages ?? [];
    const fallbackPageSize = {
      w: layout?.pageSize?.w ?? this.#layoutEngineOptions.pageSize?.w ?? DEFAULT_PAGE_SIZE.w,
      h: layout?.pageSize?.h ?? this.#layoutEngineOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h,
    };
    const layoutMode = this.#layoutEngineOptions.layoutMode ?? DEFAULT_LAYOUT_MODE;
    const pageGap = getEffectivePageGap(this.#layoutEngineOptions);

    let maxWidth = fallbackPageSize.w;
    let totalHeight = 0;
    let totalWidth = 0;
    let maxHeight = fallbackPageSize.h;

    if (pages.length > 0) {
      pages.forEach((page, index) => {
        const pw = page.size?.w ?? fallbackPageSize.w;
        const ph = page.size?.h ?? fallbackPageSize.h;
        maxWidth = Math.max(maxWidth, pw);
        maxHeight = Math.max(maxHeight, ph);
        if (layoutMode === 'horizontal') {
          totalWidth += pw;
          if (index > 0) totalWidth += pageGap;
        } else {
          totalHeight += ph;
          if (index > 0) totalHeight += pageGap;
        }
      });
    } else {
      totalWidth = fallbackPageSize.w;
      totalHeight = fallbackPageSize.h;
    }

    if (layoutMode === 'horizontal') {
      this.#viewportHost.style.width = `${totalWidth * zoom}px`;
      this.#viewportHost.style.minWidth = `${maxWidth * zoom}px`;
      this.#viewportHost.style.height = `${maxHeight * zoom}px`;
      this.#viewportHost.style.minHeight = `${maxHeight * zoom}px`;
    } else {
      this.#viewportHost.style.width = `${maxWidth * zoom}px`;
      this.#viewportHost.style.minWidth = `${maxWidth * zoom}px`;
      this.#viewportHost.style.height = `${totalHeight * zoom}px`;
      this.#viewportHost.style.minHeight = `${totalHeight * zoom}px`;
    }

    this.#painterHost.style.transformOrigin = 'top left';
    this.#painterHost.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
  }

  // ---- Private: Error handling -------------------------------------------------

  #handleNonFatalError(error: unknown, phase: string): void {
    const hasFirstPaint =
      this.#state === 'firstPaintComplete' ||
      this.#state === 'streaming' ||
      this.#state === 'enriching' ||
      this.#state === 'degraded';

    if (hasFirstPaint) {
      this.#transition('degraded');
    }
    this.#emitLayoutError(error, phase);
  }

  #emitLayoutError(error: unknown, phase: string): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.emit('layoutError', {
      phase,
      error: normalized,
      timestamp: Date.now(),
    });
  }
}

// ---- Module-level helpers ----------------------------------------------------

function createEmptyAccumulated(): AccumulatedState {
  return {
    blocks: [],
    measures: [],
    layout: null,
    windowRecords: [],
    nextBodyChildIndex: 0,
    totalBodyChildCount: 0,
    sectionMetadata: [],
    dependencyManifest: createEmptyDependencyManifest(),
  };
}

function normalizeLayoutEngineOptions(options?: LayoutEngineOptions): LayoutEngineOptions {
  return {
    pageSize: options?.pageSize ?? DEFAULT_PAGE_SIZE,
    margins: options?.margins ?? DEFAULT_MARGINS,
    zoom: options?.zoom ?? 1,
    layoutMode: options?.layoutMode ?? DEFAULT_LAYOUT_MODE,
    flowMode: 'paginated', // Streaming host is always paginated
    virtualization: {
      enabled: true,
      ...(options?.virtualization ?? {}),
    },
    trackedChanges: options?.trackedChanges,
    debugLabel: options?.debugLabel,
    pageStyles: options?.pageStyles,
    presence: options?.presence,
    ruler: options?.ruler,
    semanticOptions: options?.semanticOptions,
    proofing: options?.proofing,
    emitCommentPositionsInViewing: options?.emitCommentPositionsInViewing,
    enableCommentsInViewing: options?.enableCommentsInViewing,
  };
}

function applyHostStyles(root: HTMLElement, viewport: HTMLElement, painterHost: HTMLElement, pageHeight: number): void {
  root.style.position = root.style.position || 'relative';
  root.style.width = root.style.width || '100%';
  root.style.height = root.style.height || '100%';
  root.style.minHeight = root.style.minHeight || `${pageHeight}px`;
  root.style.overflow = root.style.overflow || 'auto';
  root.style.isolation = root.style.isolation || 'isolate';

  viewport.style.position = 'relative';
  viewport.style.width = '100%';
  viewport.style.minHeight = `${pageHeight}px`;
  viewport.style.isolation = 'isolate';

  painterHost.style.position = 'relative';
  painterHost.style.width = '100%';
  painterHost.style.transformOrigin = 'top left';
}

function getEffectivePageGap(options: LayoutEngineOptions): number {
  if (options.virtualization?.enabled) {
    return Math.max(0, options.virtualization.gap ?? DEFAULT_PAGE_GAP);
  }
  if (options.layoutMode === 'horizontal') {
    return DEFAULT_HORIZONTAL_PAGE_GAP;
  }
  return DEFAULT_PAGE_GAP;
}

function validateZoom(zoom: number): void {
  if (typeof zoom !== 'number') {
    throw new TypeError(`[V2StreamingPaginatedRenderHost] setZoom expects a number, received ${typeof zoom}`);
  }
  if (Number.isNaN(zoom)) {
    throw new RangeError('[V2StreamingPaginatedRenderHost] setZoom expects a valid number (not NaN)');
  }
  if (!Number.isFinite(zoom)) {
    throw new RangeError('[V2StreamingPaginatedRenderHost] setZoom expects a finite number');
  }
  if (zoom <= 0) {
    throw new RangeError('[V2StreamingPaginatedRenderHost] setZoom expects a positive number greater than 0');
  }
}

function normalizeTwips(twips: number): number {
  return (twips / TWIPS_PER_INCH) * PX_PER_INCH;
}

function countMountedPages(container: ParentNode): number {
  return container.querySelectorAll('.superdoc-page').length;
}

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createEmptyDependencyManifest(): DependencyManifest {
  return {
    headerFooterRefs: [],
    footnoteRefs: [],
    endnoteRefs: [],
    commentRefs: [],
    imageRefs: [],
    hyperlinkRefs: [],
  };
}

function mergeDependencyManifests(
  existingManifest: DependencyManifest,
  nextManifest: DependencyManifest,
): DependencyManifest {
  const headerFooterRefs = new Map<string, { relationshipId: string; type: 'header' | 'footer' }>();
  const footnoteRefs = new Map<string, { footnoteId: string }>();
  const endnoteRefs = new Map<string, { endnoteId: string }>();
  const commentRefs = new Map<string, { commentId: string }>();
  const imageRefs = new Map<string, { relationshipId: string; partUri: string }>();
  const hyperlinkRefs = new Map<string, { relationshipId: string }>();

  for (const entry of existingManifest.headerFooterRefs) {
    headerFooterRefs.set(`${entry.type}:${entry.relationshipId}`, entry);
  }
  for (const entry of nextManifest.headerFooterRefs) {
    headerFooterRefs.set(`${entry.type}:${entry.relationshipId}`, entry);
  }

  for (const entry of existingManifest.footnoteRefs) {
    footnoteRefs.set(entry.footnoteId, entry);
  }
  for (const entry of nextManifest.footnoteRefs) {
    footnoteRefs.set(entry.footnoteId, entry);
  }

  for (const entry of existingManifest.endnoteRefs) {
    endnoteRefs.set(entry.endnoteId, entry);
  }
  for (const entry of nextManifest.endnoteRefs) {
    endnoteRefs.set(entry.endnoteId, entry);
  }

  for (const entry of existingManifest.commentRefs) {
    commentRefs.set(entry.commentId, entry);
  }
  for (const entry of nextManifest.commentRefs) {
    commentRefs.set(entry.commentId, entry);
  }

  for (const entry of existingManifest.imageRefs) {
    imageRefs.set(`${entry.partUri}:${entry.relationshipId}`, entry);
  }
  for (const entry of nextManifest.imageRefs) {
    imageRefs.set(`${entry.partUri}:${entry.relationshipId}`, entry);
  }

  for (const entry of existingManifest.hyperlinkRefs) {
    hyperlinkRefs.set(entry.relationshipId, entry);
  }
  for (const entry of nextManifest.hyperlinkRefs) {
    hyperlinkRefs.set(entry.relationshipId, entry);
  }

  return {
    headerFooterRefs: [...headerFooterRefs.values()],
    footnoteRefs: [...footnoteRefs.values()],
    endnoteRefs: [...endnoteRefs.values()],
    commentRefs: [...commentRefs.values()],
    imageRefs: [...imageRefs.values()],
    hyperlinkRefs: [...hyperlinkRefs.values()],
  };
}

function buildSectionMetadataFromRenderShell(renderShell: RenderShellSnapshot): SectionMetadata[] {
  if (renderShell.sections.length === 0) {
    return renderShell.primaryPageGeometry
      ? [
          {
            sectionIndex: 0,
            pageSize: {
              w: normalizeTwips(renderShell.primaryPageGeometry.width),
              h: normalizeTwips(renderShell.primaryPageGeometry.height),
            },
            margins: {
              top: normalizeTwips(renderShell.primaryPageGeometry.margins.top),
              right: normalizeTwips(renderShell.primaryPageGeometry.margins.right),
              bottom: normalizeTwips(renderShell.primaryPageGeometry.margins.bottom),
              left: normalizeTwips(renderShell.primaryPageGeometry.margins.left),
            },
          },
        ]
      : [];
  }

  return renderShell.sections.map((section) => ({
    sectionIndex: section.index,
    ...(section.headerRefs.length > 0 ? { headerRefs: toSectionRefs(section.headerRefs) } : {}),
    ...(section.footerRefs.length > 0 ? { footerRefs: toSectionRefs(section.footerRefs) } : {}),
    pageSize: {
      w: normalizeTwips(section.pageGeometry.width),
      h: normalizeTwips(section.pageGeometry.height),
    },
    margins: {
      top: normalizeTwips(section.pageGeometry.margins.top),
      right: normalizeTwips(section.pageGeometry.margins.right),
      bottom: normalizeTwips(section.pageGeometry.margins.bottom),
      left: normalizeTwips(section.pageGeometry.margins.left),
    },
  }));
}

function toSectionRefs(refs: string[]): Partial<Record<'default' | 'first' | 'even' | 'odd', string>> {
  const result: Partial<Record<'default' | 'first' | 'even' | 'odd', string>> = {};

  if (refs[0]) result.default = refs[0];
  if (refs[1]) result.first = refs[1];
  if (refs[2]) result.even = refs[2];
  if (refs[3]) result.odd = refs[3];

  return result;
}
