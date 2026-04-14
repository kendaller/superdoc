import { EventEmitter } from 'eventemitter3';
import { measureBlock } from '@superdoc/measuring-dom';
import { createDomPainter } from '@superdoc/painter-dom';
import { DATA_ATTRS } from '@superdoc/dom-contract';
import type {
  DependencyManifest,
  DocumentRuntime,
  RenderShellSnapshot,
  SourceRef,
  WindowedProjectionResult,
  ResourceViolation,
} from '@superdoc/v2-model';
import { validateRenderShell, validateDependencyManifest, applyRenderShellCaps } from '@superdoc/v2-model';
import type { FlowBlock, Layout, Measure, SectionMetadata } from '@superdoc/contracts';
import type { LayoutEngineOptions, TrackedChangesOverrides } from '../../v1/core/presentation-editor/types.js';
import { runInstrumentedIncrementalLayout } from '../../../core/perf/runInstrumentedIncrementalLayout.js';
import type { V2EditingController } from '../runtime/V2EditingController.js';
import {
  applyEditableInteractionData,
  applyEditableInteractionDataToParagraphBlock,
  buildEditableDocumentSnapshotForBlockIds,
  buildEditableDocumentSnapshotFromSourceRefs,
  createOptimisticEditableParagraph,
  describeEditableParagraphBySourceRef,
  isEmptyEditableParagraph,
  mergeEditableDocumentSnapshots,
  replaceSnapshotParagraph,
  type V2EditableParagraph,
  type V2EditableDocumentSnapshot,
} from '../editing/V2EditableDocumentSnapshot.js';
import type { V2EditingMutationKind } from '../editing/V2EditingSession.js';
import type { V2PendingSelection } from '../editing/V2EditingTypes.js';
import {
  v2PerfTimeline,
  SPAN_RENDER,
  SPAN_PAINT,
  PROJECTION_FIRST_WINDOW_START,
  PROJECTION_FIRST_WINDOW_COMPLETE,
  PROJECTION_APPEND_WINDOW_COUNT,
  PROJECTION_FIELD_HEAVY_PARAGRAPHS,
  PROJECTION_PLAIN_PARAGRAPHS,
  PROJECTION_COMPLEX_PARAGRAPHS,
  PROJECTION_RUNS_SKIPPED_BY_FAST_PATH,
  LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT,
  PAINT_FIRST_PAGE_MOUNTED,
} from '@superdoc/v2-perf';
import { PageCompletenessTracker } from './page-completeness.js';
import {
  advanceStreamingBatchPolicy,
  createInitialStreamingBatchPolicy,
  type StreamingBatchPolicy,
} from './streaming-batch-policy.js';
import { reprojectStructuralStreamingWindows } from './streaming-structural-reprojection.js';
import {
  mergeProjectedWindowDependencyManifests,
  normalizeProjectedWindow,
  projectCanonicalWindowFromHandle,
  type CanonicalProjectedWindow,
} from './streaming-window-projection.js';
import type {
  HostState,
  StateTransitionEntry,
  StateChangeEvent,
  LoadingOverlayState,
  LoadingOverlayTexts,
  WindowRecord,
  AccumulatedState,
  V2StreamingLayoutSnapshot,
  V2StreamingLayoutPayload,
  PageCompleteness,
  DegradedInfo,
  DegradedReason,
  V2EditingBootstrapPhase,
  V2EditingHistogramEntry,
  V2EditingSurfaceStatus,
  V2EditingSnapshotSource,
} from './streaming-host-types.js';

// ---- Constants ---------------------------------------------------------------

const DEFAULT_PAGE_SIZE = { w: 612, h: 792 };
const DEFAULT_MARGINS = { top: 72, right: 72, bottom: 72, left: 72 };
const DEFAULT_PAGE_GAP = 24;
const DEFAULT_HORIZONTAL_PAGE_GAP = 20;
const DEFAULT_LAYOUT_MODE = 'vertical';
const DEFAULT_WINDOW_SIZE = 50;
const DEFAULT_FIRST_WINDOW_PAGE_ESTIMATE = 2;
const DEFAULT_APPEND_WINDOW_PAGE_ESTIMATE = 2;
const INITIAL_EDITING_BOOTSTRAP_WAIT_MS = 250;
const BUFFER_AHEAD_PAGES = 10;
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;
const MAIN_THREAD_YIELD_BUDGET_MS = 12;
const LOADING_PROGRESS_INITIAL = 4;
const LOADING_PROGRESS_SOURCE_OPENED = 14;
const LOADING_PROGRESS_FIRST_PAINT_SHELL_READY = 44;
const LOADING_PROGRESS_PREVIEW_STARTED = 56;
const LOADING_PROGRESS_PREVIEW_RANGE_READY = 68;
const LOADING_PROGRESS_EXACT_FIRST_WINDOW_STARTED = 82;
const LOADING_PROGRESS_EXACT_FIRST_WINDOW_READY = 92;
const LOADING_PROGRESS_LAYOUT_STARTED = 97;
const LOADING_PROGRESS_COMPLETE = 100;
const EDITING_SURFACE_READY_ATTR = 'data-v2-editing-surface-ready';
const EDITING_SURFACE_SOURCE_ATTR = 'data-v2-editing-snapshot-source';
const EDITING_SURFACE_RENDERED_PARAGRAPH_COUNT_ATTR = 'data-v2-editing-rendered-paragraph-count';
const EDITING_SURFACE_RENDERED_EDITABLE_COUNT_ATTR = 'data-v2-editing-rendered-editable-count';
const EDITING_SURFACE_DOM_SEGMENT_COUNT_ATTR = 'data-v2-editing-dom-segment-count';
const EDITING_SURFACE_SNAPSHOT_PARAGRAPH_COUNT_ATTR = 'data-v2-editing-snapshot-paragraph-count';
const EDITING_SURFACE_SUPPORTED_PARAGRAPH_COUNT_ATTR = 'data-v2-editing-supported-paragraph-count';
const EDITING_SURFACE_BLOCK_ID_SUPPORTED_COUNT_ATTR = 'data-v2-editing-blockid-supported-count';
const EDITING_SURFACE_SOURCE_REF_SUPPORTED_COUNT_ATTR = 'data-v2-editing-sourceref-supported-count';
const EDITING_SURFACE_BOOTSTRAP_PHASE_ATTR = 'data-v2-editing-bootstrap-phase';
const EDITING_SURFACE_BOOTSTRAP_ISSUE_ATTR = 'data-v2-editing-bootstrap-issue';
const EDITING_SURFACE_BLOCK_ID_ONLY_SUPPORTED_COUNT_ATTR = 'data-v2-editing-blockid-only-supported-count';
const EDITING_SURFACE_SOURCE_REF_ONLY_SUPPORTED_COUNT_ATTR = 'data-v2-editing-sourceref-only-supported-count';
const EDITING_SURFACE_MISSING_RENDERED_COUNT_ATTR = 'data-v2-editing-missing-rendered-count';
const EDITING_SURFACE_MISSING_RENDERED_SAMPLE_ATTR = 'data-v2-editing-missing-rendered-sample';
const EDITING_SURFACE_PARAGRAPHS_WITHOUT_SEGMENTS_COUNT_ATTR = 'data-v2-editing-without-dom-segments-count';
const EDITING_SURFACE_PARAGRAPHS_WITHOUT_SEGMENTS_SAMPLE_ATTR = 'data-v2-editing-without-dom-segments-sample';
const EDITING_SURFACE_UNSUPPORTED_HISTOGRAM_ATTR = 'data-v2-editing-unsupported-histogram';
const DEFAULT_LOADING_TEXTS: LoadingOverlayTexts = {
  title: 'Loading document',
  openingMessage: 'Opening document…',
  preparingMessage: 'Preparing first pages…',
  almostReadyMessage: 'Almost ready. Your document will appear shortly…',
};

type DocumentMode = 'editing' | 'viewing' | 'suggesting';

export type V2StreamingPaginatedRenderHostOptions = {
  element: HTMLElement;
  documentId?: string;
  layoutEngineOptions?: LayoutEngineOptions;
  documentMode?: DocumentMode;
  disableContextMenu?: boolean;
  showDefaultLoadingOverlay?: boolean;
  loadingTexts?: Partial<LoadingOverlayTexts>;
  /** The DocumentRuntime to use (worker proxy or in-process). */
  runtime: DocumentRuntime;
  /** Upper bound for how many body children one window may scan. Default: 50. */
  windowSize?: number;
  /** stopAfterPageEstimate for the first window. Default: 2. */
  firstWindowPageEstimate?: number;
};

type EditingSnapshotSelection = {
  snapshot: V2EditableDocumentSnapshot | null;
  snapshotSource: V2EditingSnapshotSource;
  blockIdSnapshot: V2EditableDocumentSnapshot | null;
  sourceRefSnapshot: V2EditableDocumentSnapshot | null;
};

// ---- Host class --------------------------------------------------------------

/**
 * Streaming paginated host for the v2 rendering pipeline.
 *
 * Programs against the DocumentRuntime interface. Uses a preview window only
 * to choose the opening range, keeps a loading overlay visible, then paints
 * the first exact paginated window once it is ready. After first paint, it
 * appends more exact windows progressively via incremental layout.
 * Virtualization is enabled by default.
 *
 * State machine: idle → opening → renderShellReady → firstWindowProjected →
 * firstPaintComplete → streaming → enriching → complete
 */
export class V2StreamingPaginatedRenderHost extends EventEmitter {
  readonly element: HTMLElement;
  readonly options: { documentId?: string };

  #runtime: DocumentRuntime;
  #editingController: V2EditingController | null = null;
  #unbindEditingController: (() => void) | null = null;
  #viewportHost: HTMLDivElement;
  #painterHost: HTMLDivElement;
  #loadingOverlay: HTMLDivElement;
  #loadingMessage: HTMLParagraphElement;
  #loadingProgress: HTMLDivElement;
  #loadingProgressValue: HTMLSpanElement;
  #loadingProgressBar: HTMLDivElement;
  #loadingProgressPercent = 0;
  #showDefaultLoadingOverlay: boolean;
  #loadingTexts: LoadingOverlayTexts;
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
  #appendBatchPolicy: StreamingBatchPolicy;

  /** Incremented on each load() to invalidate stale async continuations. */
  #generation = 0;
  #appendInFlight = false;
  #scrollRafPending = false;
  #scrollHandler: (() => void) | null = null;
  #degradedInfo: DegradedInfo | null = null;
  #editingSnapshotSelection: EditingSnapshotSelection = createEmptyEditingSnapshotSelection();
  #editingSurfaceStatus: V2EditingSurfaceStatus = createEmptyEditingSurfaceStatus();
  #editingBootstrapPhase: V2EditingBootstrapPhase = 'idle';
  #editingBootstrapIssue: string | null = null;
  #streamingEditingSuspended = false;
  #editingProjectionAligned = false;
  #initialEditingControllerBootstrap: Promise<V2EditingController | null> | null = null;

  constructor(options: V2StreamingPaginatedRenderHostOptions) {
    super();

    this.element = options.element;
    this.options = { documentId: options.documentId };
    this.#runtime = options.runtime;
    this.#layoutEngineOptions = normalizeLayoutEngineOptions(options.layoutEngineOptions);
    this.#documentMode = options.documentMode ?? 'editing';
    this.#disableContextMenu = Boolean(options.disableContextMenu);
    this.#showDefaultLoadingOverlay = options.showDefaultLoadingOverlay !== false;
    this.#loadingTexts = {
      ...DEFAULT_LOADING_TEXTS,
      ...(options.loadingTexts ?? {}),
    };
    this.#windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.#firstWindowPageEstimate = options.firstWindowPageEstimate ?? DEFAULT_FIRST_WINDOW_PAGE_ESTIMATE;
    this.#appendBatchPolicy = createInitialStreamingBatchPolicy(this.#windowSize, DEFAULT_APPEND_WINDOW_PAGE_ESTIMATE);

    this.#viewportHost = document.createElement('div');
    this.#viewportHost.className = 'presentation-editor__viewport v2-streaming-renderer__viewport';
    this.#viewportHost.setAttribute('aria-hidden', 'true');

    this.#painterHost = document.createElement('div');
    this.#painterHost.className = 'presentation-editor__pages v2-streaming-renderer__pages';

    const { overlay, message, progress, progressValue, progressBar } = createLoadingOverlay(this.#loadingTexts);
    this.#loadingOverlay = overlay;
    this.#loadingMessage = message;
    this.#loadingProgress = progress;
    this.#loadingProgressValue = progressValue;
    this.#loadingProgressBar = progressBar;

    this.#viewportHost.appendChild(this.#painterHost);
    this.element.replaceChildren(this.#viewportHost, this.#loadingOverlay);

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

  /** Returns degraded sub-classification, or null if not in degraded state. */
  getDegradedInfo(): DegradedInfo | null {
    return this.#degradedInfo;
  }

  /**
   * Attempt to recover from 'append-stalled' degraded state by re-entering
   * the streaming state and rescheduling the append loop.
   *
   * No-op if not in degraded state with reason 'append-stalled'.
   */
  retryAppend(): void {
    if (this.#state !== 'degraded') return;
    if (!this.#degradedInfo || this.#degradedInfo.reason !== 'append-stalled') return;

    this.#degradedInfo = null;
    this.#transition('streaming');
    this.#scheduleStreamingWork();
  }

  // ---- Public: Lifecycle -------------------------------------------------------

  async load(source: Uint8Array | Blob): Promise<void> {
    const gen = ++this.#generation;
    this.#resetState();
    this.#transition('opening');
    this.#showLoadingOverlayWithProgress(this.#loadingTexts.openingMessage, LOADING_PROGRESS_INITIAL);

    try {
      // Phase 1: Open + first-paint shell
      await this.#runtime.openSource(source);
      if (gen !== this.#generation) return;
      this.#setLoadingProgress(LOADING_PROGRESS_SOURCE_OPENED);

      await this.#runtime.ready('first-paint-shell');
      if (gen !== this.#generation) return;
      this.#setLoadingProgress(LOADING_PROGRESS_FIRST_PAINT_SHELL_READY);

      this.#showLoadingOverlayWithProgress(this.#loadingTexts.preparingMessage, LOADING_PROGRESS_PREVIEW_STARTED);

      const shell = await this.#runtime.getRenderShell();
      if (gen !== this.#generation) return;

      if (!shell || shell.bodyChildCount === 0) {
        throw new Error('Empty or invalid document: no body children');
      }

      // Validate and cap hostile dimensions
      const shellViolations = validateRenderShell(shell);
      this.#reportResourceViolations(shellViolations);
      const safeShell = shellViolations.some((v) => v.action === 'capped')
        ? applyRenderShellCaps(shell, shellViolations)
        : shell;

      this.#renderShell = safeShell;
      this.#accumulated.totalBodyChildCount = safeShell.bodyChildCount;
      this.#accumulated.sectionMetadata = buildSectionMetadataFromRenderShell(safeShell);
      this.#transition('renderShellReady');

      // Phase 2: First window projection
      v2PerfTimeline.mark(PROJECTION_FIRST_WINDOW_START);
      const initialWindow = await this.#projectInitialWindow();
      if (gen !== this.#generation) return;
      v2PerfTimeline.mark(PROJECTION_FIRST_WINDOW_COMPLETE);
      this.#setLoadingProgress(LOADING_PROGRESS_PREVIEW_RANGE_READY);

      let firstWindowResult = initialWindow.windowResult;
      let firstWindowMode = initialWindow.projectionMode;

      if (firstWindowMode === 'preview') {
        this.#showLoadingOverlayWithProgress(
          this.#loadingTexts.almostReadyMessage,
          LOADING_PROGRESS_EXACT_FIRST_WINDOW_STARTED,
        );
        firstWindowResult = await this.#projectExactInitialWindow(
          gen,
          firstWindowResult.continuation.nextBodyChildIndex,
        );
        if (gen !== this.#generation) return;
        firstWindowMode = 'exact';
      }

      this.#setLoadingProgress(LOADING_PROGRESS_EXACT_FIRST_WINDOW_READY);

      await this.#awaitInitialEditingControllerBootstrap(gen);
      if (gen !== this.#generation) return;

      this.#accumulateWindow(firstWindowResult, 0, firstWindowMode);
      this.#recordProjectionStats(firstWindowResult);
      this.#transition('firstWindowProjected');

      // Phase 3: Measure + paginate + paint
      this.#setLoadingProgress(LOADING_PROGRESS_LAYOUT_STARTED);
      await yieldToBrowser();
      const endRender = v2PerfTimeline.startSpan(SPAN_RENDER);
      try {
        await this.#measurePaginatePaint();
      } finally {
        endRender();
      }
      if (gen !== this.#generation) return;

      this.#setLoadingProgress(LOADING_PROGRESS_COMPLETE);
      this.#hideLoadingOverlay();
      this.#transition('firstPaintComplete');

      v2PerfTimeline.mark(PAINT_FIRST_PAGE_MOUNTED);
      v2PerfTimeline.gauge(LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT, countMountedPages(this.#painterHost));

      const firstPaintPayload = {
        pageCount: this.#accumulated.layout?.pages.length ?? 0,
      };
      this.emit('firstPaintComplete', firstPaintPayload);

      if (firstWindowMode === 'exact') {
        void this.#advanceRenderShellInBackground(gen);
      }

      // Phase 4: Schedule background streaming or go straight to enriching
      if (this.#accumulated.nextBodyChildIndex < this.#accumulated.totalBodyChildCount) {
        this.#transition('streaming');
        this.#scheduleStreamingWork();
      } else {
        this.#completeness.markAllBodyComplete();
        this.#transition('enriching');
        this.#scheduleEnrichment();
      }
    } catch (error) {
      if (gen !== this.#generation) return;
      const normalized = normalizeError(error);
      this.#hideLoadingOverlay();
      this.#transition('failed');
      this.#emitLayoutError(normalized, 'load');
      throw normalized;
    }
  }

  destroy(): void {
    this.#generation++;
    this.#removeScrollListener();
    this.#domPainter = null;
    this.#unbindEditingController?.();
    this.#unbindEditingController = null;
    this.#editingController = null;
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

  getEditingSnapshot(): V2EditableDocumentSnapshot {
    return this.#accumulated.editingSnapshot;
  }

  getEditingSurfaceStatus(): V2EditingSurfaceStatus {
    return this.#editingSurfaceStatus;
  }

  setInitialEditingControllerBootstrap(controllerPromise: Promise<V2EditingController>): void {
    this.#initialEditingControllerBootstrap = controllerPromise
      .then((controller) => controller)
      .catch((error) => {
        console.debug('[V2StreamingPaginatedRenderHost] Initial editing bootstrap unavailable', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
  }

  refreshEditingSnapshot(): void {
    void this.refreshEditingSnapshotView();
  }

  async refreshEditingSnapshotView(options?: {
    repaint?: boolean;
    pendingSelection?: V2PendingSelection | null;
    anchorParagraphSourceRef?: { partUri: string; nodeId: string; sourceNodePath?: string } | null;
    mutationKind?: V2EditingMutationKind;
  }): Promise<void> {
    if (!this.#editingController) {
      this.#setEditingBootstrapState('awaiting-controller', 'Editing controller is not bound');
      return;
    }

    const previousRenderState = options?.repaint
      ? {
          previousBlocks: structuredClone(this.#accumulated.blocks),
          previousLayout: this.#accumulated.layout,
          previousMeasures: [...this.#accumulated.measures],
        }
      : null;

    if (this.#editingController.semanticModel && (await this.#tryApplyStructuralReprojection(options))) {
      this.#refreshEditableInteractionData();
      if (previousRenderState) {
        await this.#refreshRenderedInteractionData(previousRenderState);
        this.#scheduleStreamingWork();
      } else {
        this.#publishEditingSurfaceDiagnostics();
      }
      return;
    }

    this.#refreshEditableInteractionData();
    if (options?.repaint) {
      await this.#refreshRenderedInteractionData();
    } else {
      this.#publishEditingSurfaceDiagnostics();
    }
  }

  async prepareEditingSurface(): Promise<V2EditingSurfaceStatus> {
    if (!this.#editingController) {
      this.#setEditingBootstrapState('awaiting-controller', 'Editing controller is not bound');
      return this.#editingSurfaceStatus;
    }

    try {
      await this.#alignLoadedWindowsToEditingProjection();

      this.#setEditingBootstrapState('preparing-snapshot');
      this.#refreshEditableInteractionData();

      this.#setEditingBootstrapState('repainting');
      await this.#refreshRenderedInteractionData();

      this.#publishEditingSurfaceDiagnostics();
      this.#setEditingBootstrapState(
        this.#editingSurfaceStatus.ready ? 'ready' : 'blocked',
        deriveEditingBootstrapIssue(this.#editingSurfaceStatus, true),
      );
      return this.#editingSurfaceStatus;
    } catch (error) {
      const issue = error instanceof Error ? error.message : String(error);
      this.#setEditingBootstrapState('failed', issue);
      throw error;
    }
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

  onLoadingStateChange(handler: (state: LoadingOverlayState) => void): () => void {
    this.on('loadingStateChange', handler);
    return () => this.off('loadingStateChange', handler);
  }

  bindEditingController(controller: V2EditingController): () => void {
    this.#unbindEditingController?.();
    this.#editingController = controller;
    this.#editingProjectionAligned = false;
    this.#editingBootstrapPhase = 'idle';
    this.#editingBootstrapIssue = null;
    this.#unbindEditingController = () => {
      if (this.#editingController === controller) {
        this.#editingController = null;
      }
      this.#editingBootstrapPhase = 'awaiting-controller';
      this.#editingBootstrapIssue = 'Editing controller is not bound';
      this.#unbindEditingController = null;
      this.#publishEditingSurfaceDiagnostics();
    };

    this.#refreshEditableInteractionData();
    void this.#refreshRenderedInteractionData();
    return this.#unbindEditingController;
  }

  patchEditableParagraphText(blockId: string, text: string): boolean {
    const paragraph = this.#accumulated.editingSnapshot.paragraphsByBlockId.get(blockId);
    if (!paragraph || !paragraph.supported) {
      return false;
    }

    const optimisticParagraph = createOptimisticEditableParagraph(paragraph, text);
    this.#accumulated.editingSnapshot = replaceSnapshotParagraph(
      this.#accumulated.editingSnapshot,
      optimisticParagraph,
    );

    for (const block of this.#accumulated.blocks) {
      if (block.id !== blockId || block.kind !== 'paragraph') {
        continue;
      }

      reconcileEditableParagraphBlockText(block, optimisticParagraph);
      applyEditableInteractionDataToParagraphBlock(block, optimisticParagraph);
    }

    return true;
  }

  commitEditableParagraphText(blockId: string, paragraphSourceRef: SourceRef): boolean {
    const model = this.#editingController?.semanticModel;
    if (!model) {
      return false;
    }

    const committedParagraph = describeEditableParagraphBySourceRef(model, paragraphSourceRef, blockId);
    if (!committedParagraph?.supported) {
      return false;
    }

    this.#accumulated.editingSnapshot = replaceSnapshotParagraph(this.#accumulated.editingSnapshot, committedParagraph);

    for (const block of this.#accumulated.blocks) {
      if (block.id !== blockId || block.kind !== 'paragraph') {
        continue;
      }

      reconcileEditableParagraphBlockText(block, committedParagraph);
      applyEditableInteractionDataToParagraphBlock(block, committedParagraph);
    }

    this.#publishEditingSurfaceDiagnostics();
    return true;
  }

  // ---- Private: State machine --------------------------------------------------

  #transition(next: HostState): void {
    const previous = this.#state;
    this.#state = next;
    const entry: StateTransitionEntry = { state: next, timestamp: perfNow() };
    this.#stateHistory.push(entry);
    const event: StateChangeEvent = { previous, current: next, timestamp: entry.timestamp };
    if (next === 'degraded' && this.#degradedInfo) {
      event.degradedInfo = this.#degradedInfo;
    }
    this.emit('stateChange', event);
  }

  #resetState(): void {
    this.#accumulated = createEmptyAccumulated();
    this.#editingSnapshotSelection = createEmptyEditingSnapshotSelection();
    this.#editingSurfaceStatus = createEmptyEditingSurfaceStatus();
    this.#editingBootstrapPhase = 'idle';
    this.#editingBootstrapIssue = null;
    this.#streamingEditingSuspended = false;
    this.#editingProjectionAligned = false;
    this.#completeness.reset();
    this.#renderShell = null;
    this.#appendInFlight = false;
    this.#appendBatchPolicy = createInitialStreamingBatchPolicy(this.#windowSize, DEFAULT_APPEND_WINDOW_PAGE_ESTIMATE);
    this.#degradedInfo = null;
    this.#resetLoadingProgress();
    applyEditingSurfaceDiagnostics(this.element, this.#editingSurfaceStatus);
  }

  async #projectInitialWindow(): Promise<{
    projectionMode: 'preview' | 'exact';
    windowResult: WindowedProjectionResult;
  }> {
    try {
      const previewResult = await this.#runtime.projectPreviewWindow({
        startBodyChildIndex: 0,
        maxBodyChildCount: this.#windowSize,
        stopAfterPageEstimate: this.#firstWindowPageEstimate,
      });

      return { projectionMode: 'preview', windowResult: previewResult };
    } catch (error) {
      if (!isPreviewUnsupportedError(error)) {
        throw error;
      }

      await this.#runtime.advanceRenderShell();

      const exactResult = await this.#runtime.projectWindow({
        startBodyChildIndex: 0,
        maxBodyChildCount: this.#windowSize,
        stopAfterPageEstimate: this.#firstWindowPageEstimate,
        includeDependencyManifest: true,
      });
      return { projectionMode: 'exact', windowResult: exactResult };
    }
  }

  // ---- Private: Window accumulation --------------------------------------------

  #accumulateWindow(
    windowResult: WindowedProjectionResult,
    startIndex: number,
    projectionMode: 'preview' | 'exact',
  ): void {
    const projectedWindow = normalizeProjectedWindow({
      windowResult,
      startBodyChildIndex: startIndex,
      index: this.#accumulated.windowRecords.length,
      projectionMode,
    });
    this.#appendProjectedWindow(projectedWindow);
  }

  #appendProjectedWindow(projectedWindow: CanonicalProjectedWindow): void {
    const blockToSourceRef = new Map(this.#accumulated.blockToSourceRef);
    for (const [blockId, sourceRef] of projectedWindow.blockToSourceRef) {
      blockToSourceRef.set(blockId, sourceRef);
    }

    const editingSnapshotSelection = this.#extendEditingSnapshotSelectionForProjectedWindow(
      projectedWindow,
      blockToSourceRef,
    );
    this.#accumulated.windowRecords.push(projectedWindow.windowRecord);
    this.#accumulated.blocks = [...this.#accumulated.blocks, ...projectedWindow.windowRecord.blocks];
    this.#accumulated.blockToSourceRef = blockToSourceRef;
    if (editingSnapshotSelection.snapshot) {
      this.#accumulated.editingSnapshot = editingSnapshotSelection.snapshot;
      this.#editingSnapshotSelection = editingSnapshotSelection;
      reconcileSimpleEditableParagraphText(projectedWindow.windowRecord.blocks, editingSnapshotSelection.snapshot);
      applyEditableInteractionData(projectedWindow.windowRecord.blocks, editingSnapshotSelection.snapshot);
    }

    this.#accumulated.nextBodyChildIndex = projectedWindow.nextBodyChildIndex;
    this.#accumulated.totalBodyChildCount = projectedWindow.totalBodyChildCount;
    if (projectedWindow.dependencyManifest) {
      this.#accumulated.dependencyManifest = mergeDependencyManifests(
        this.#accumulated.dependencyManifest,
        projectedWindow.dependencyManifest,
      );
      this.#reportResourceViolations(validateDependencyManifest(this.#accumulated.dependencyManifest));
    }
  }

  #extendEditingSnapshotSelectionForProjectedWindow(
    projectedWindow: CanonicalProjectedWindow,
    nextBlockToSourceRef: ReadonlyMap<string, { partUri: string; nodeId: string; sourceNodePath?: string }>,
  ): EditingSnapshotSelection {
    const model = this.#editingController?.semanticModel;
    if (!model) {
      return this.#editingSnapshotSelection;
    }

    if (!this.#editingSnapshotSelection.snapshot) {
      return this.#buildEditingSnapshotSelection(nextBlockToSourceRef);
    }

    const windowBlockIds = projectedWindow.windowRecord.blockIds;
    const windowSourceRefs = new Map<string, { partUri: string; nodeId: string; sourceNodePath?: string }>();
    for (const blockId of windowBlockIds) {
      const sourceRef = projectedWindow.blockToSourceRef.get(blockId);
      if (sourceRef) {
        windowSourceRefs.set(blockId, sourceRef);
      }
    }

    const appendedBlockIdSnapshot = buildEditableDocumentSnapshotForBlockIds(model, windowBlockIds);
    const appendedSourceRefSnapshot = buildEditableDocumentSnapshotFromSourceRefs(model, windowSourceRefs);
    const mergedBlockIdSnapshot = mergeEditableDocumentSnapshots(
      this.#editingSnapshotSelection.blockIdSnapshot ?? createEmptyEditingSnapshot(),
      appendedBlockIdSnapshot,
      nextBlockToSourceRef.keys(),
    );
    const mergedSourceRefSnapshot = mergeEditableDocumentSnapshots(
      this.#editingSnapshotSelection.sourceRefSnapshot ?? createEmptyEditingSnapshot(),
      appendedSourceRefSnapshot,
      nextBlockToSourceRef.keys(),
    );
    const mergedSnapshot = mergeEditableDocumentSnapshots(
      mergedBlockIdSnapshot,
      mergedSourceRefSnapshot,
      nextBlockToSourceRef.keys(),
    );

    return {
      snapshot: mergedSnapshot,
      snapshotSource: resolveEditingSnapshotSource(mergedBlockIdSnapshot, mergedSourceRefSnapshot, mergedSnapshot),
      blockIdSnapshot: mergedBlockIdSnapshot,
      sourceRefSnapshot: mergedSourceRefSnapshot,
    };
  }

  async #alignLoadedWindowsToEditingProjection(): Promise<void> {
    if (this.#editingProjectionAligned) {
      return;
    }

    const documentHandle = this.#editingController?.documentHandle;
    if (!documentHandle || this.#accumulated.windowRecords.length === 0) {
      return;
    }

    await documentHandle.ready('first-paint-shell');

    const alignedWindows: WindowRecord[] = [];
    const alignedBlockToSourceRef = new Map<string, { partUri: string; nodeId: string; sourceNodePath?: string }>();
    let nextBodyChildIndex = 0;
    let totalBodyChildCount = this.#accumulated.totalBodyChildCount;

    for (const existingRecord of this.#accumulated.windowRecords) {
      const projectedWindow = projectCanonicalWindowFromHandle({
        documentHandle,
        startBodyChildIndex: nextBodyChildIndex,
        maxBodyChildCount: Math.max(1, existingRecord.bodyChildCount),
        includeDependencyManifest: Boolean(existingRecord.dependencyManifest),
        index: alignedWindows.length,
        projectionMode: existingRecord.projectionMode,
      });
      alignedWindows.push(projectedWindow.windowRecord);
      for (const [blockId, sourceRef] of projectedWindow.blockToSourceRef) {
        alignedBlockToSourceRef.set(blockId, sourceRef);
      }
      nextBodyChildIndex = projectedWindow.nextBodyChildIndex;
      totalBodyChildCount = projectedWindow.totalBodyChildCount;
    }

    this.#accumulated.windowRecords = alignedWindows;
    this.#accumulated.blocks = alignedWindows.flatMap((record) => record.blocks);
    this.#accumulated.blockToSourceRef = alignedBlockToSourceRef;
    this.#accumulated.nextBodyChildIndex = nextBodyChildIndex;
    this.#accumulated.totalBodyChildCount = totalBodyChildCount;
    this.#accumulated.dependencyManifest = mergeProjectedWindowDependencyManifests(alignedWindows);
    this.#reportResourceViolations(validateDependencyManifest(this.#accumulated.dependencyManifest));
    this.#editingProjectionAligned = true;

    console.debug('[V2StreamingPaginatedRenderHost] Aligned loaded windows to editing projection', {
      windowCount: alignedWindows.length,
      blockCount: this.#accumulated.blocks.length,
      nextBodyChildIndex,
      totalBodyChildCount,
    });
  }

  // ---- Private: Measure + paginate + paint pipeline ----------------------------

  async #measurePaginatePaint(previousState?: {
    previousBlocks: FlowBlock[];
    previousLayout: Layout | null;
    previousMeasures: Measure[];
  }): Promise<void> {
    const layoutOptions = this.#resolveLayoutInput();
    const acc = this.#accumulated;
    const cooperativeMeasureBlock = createCooperativeMeasureBlock(
      (block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) => measureBlock(block, constraints),
    );

    const previousBlocks = previousState?.previousBlocks ?? resolveAppendPreviousBlocks(acc);
    const previousLayout = previousState?.previousLayout ?? acc.layout;
    const previousMeasures = previousState?.previousMeasures ?? acc.measures;

    const { result } = await runInstrumentedIncrementalLayout({
      previousBlocks,
      previousLayout,
      nextBlocks: acc.blocks,
      layoutOptions,
      measureBlock: cooperativeMeasureBlock,
      previousMeasures: previousMeasures.length > 0 ? previousMeasures : undefined,
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
    await yieldToBrowser();
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
    this.#publishEditingSurfaceDiagnostics();

    const payload: V2StreamingLayoutPayload = {
      blocks: acc.blocks,
      measures: result.measures,
      layout: result.layout,
    };
    this.emit('layoutUpdated', payload);
    this.emit('paginationUpdate', payload);
  }

  // ---- Private: Append pipeline ------------------------------------------------

  #scheduleStreamingWork(): void {
    if (this.#streamingEditingSuspended) {
      return;
    }

    if (this.#state !== 'streaming' && this.#state !== 'firstPaintComplete') {
      return;
    }

    if (this.#appendInFlight) return;

    if (this.#accumulated.nextBodyChildIndex >= this.#accumulated.totalBodyChildCount) {
      this.#completeStreamingIfFinished();
      return;
    }

    if (!this.#needsMoreBufferedPages()) {
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
    const startBodyChildIndex = this.#accumulated.nextBodyChildIndex;
    const batchStartMs = perfNow();

    try {
      const projectedWindow = await this.#projectAppendWindow(startBodyChildIndex);
      if (gen !== this.#generation) return;

      const windowIndex = this.#accumulated.windowRecords.length;
      this.#appendProjectedWindow(projectedWindow);
      this.#recordProjectionStats({
        blocks: projectedWindow.windowRecord.blocks as WindowedProjectionResult['blocks'],
        continuation: {
          nextBodyChildIndex: projectedWindow.nextBodyChildIndex,
          hasMore: projectedWindow.nextBodyChildIndex < projectedWindow.totalBodyChildCount,
          totalBodyChildCount: projectedWindow.totalBodyChildCount,
        },
        blockToSourceRef: new Map(projectedWindow.blockToSourceRef),
        sectionMetadata: projectedWindow.windowRecord.sectionMetadataDelta,
        ...(projectedWindow.dependencyManifest ? { dependencyManifest: projectedWindow.dependencyManifest } : {}),
        ...(projectedWindow.projectionStats ? { projectionStats: projectedWindow.projectionStats } : {}),
      });

      await yieldToBrowser();
      await this.#measurePaginatePaint();
      if (gen !== this.#generation) return;

      const nextPageCount = this.#accumulated.layout?.pages.length ?? prevPageCount;
      const pagesAdded = Math.max(0, nextPageCount - prevPageCount);
      const bodyChildrenConsumed = Math.max(0, this.#accumulated.nextBodyChildIndex - startBodyChildIndex);
      const fieldHeavyRatio = getFieldHeavyRatio(projectedWindow.projectionStats);
      this.#appendBatchPolicy = advanceStreamingBatchPolicy(this.#appendBatchPolicy, {
        durationMs: perfNow() - batchStartMs,
        bodyChildrenConsumed,
        pagesAdded,
        ...(fieldHeavyRatio != null ? { fieldHeavyRatio } : {}),
      });

      // Pages from before this append are now body-complete
      this.#completeness.markBodyCompleteUpTo(prevPageCount);

      this.emit('appendComplete', {
        windowIndex,
        newPageCount: nextPageCount,
      });
      v2PerfTimeline.gauge(PROJECTION_APPEND_WINDOW_COUNT, windowIndex + 1);
    } catch (error) {
      if (gen !== this.#generation) return;
      this.#handleNonFatalError(error, 'append');
    } finally {
      this.#appendInFlight = false;
      if (gen === this.#generation) {
        this.#scheduleStreamingWork();
      }
    }
  }

  async #projectAppendWindow(startBodyChildIndex: number): Promise<CanonicalProjectedWindow> {
    const documentHandle = this.#editingController?.documentHandle;
    if (documentHandle && this.#editingProjectionAligned) {
      await documentHandle.ready('first-paint-shell');
      return projectCanonicalWindowFromHandle({
        documentHandle,
        startBodyChildIndex,
        maxBodyChildCount: this.#appendBatchPolicy.bodyChildLimit,
        stopAfterPageEstimate: this.#appendBatchPolicy.pageEstimate,
        includeDependencyManifest: true,
        index: this.#accumulated.windowRecords.length,
        projectionMode: 'exact',
      });
    }

    const continuation = {
      nextBodyChildIndex: startBodyChildIndex,
      maxBodyChildCount: this.#appendBatchPolicy.bodyChildLimit,
      stopAfterPageEstimate: this.#appendBatchPolicy.pageEstimate,
    };
    const windowResult = await this.#runtime.projectNextWindow(continuation);
    return normalizeProjectedWindow({
      windowResult,
      startBodyChildIndex,
      index: this.#accumulated.windowRecords.length,
      projectionMode: 'exact',
    });
  }

  async #advanceRenderShellInBackground(generation: number): Promise<void> {
    try {
      await this.#runtime.advanceRenderShell();
      if (generation !== this.#generation) {
        return;
      }

      // Keep the shell snapshot in sync with newly available support shells.
      const nextShell = await this.#runtime.getRenderShell();
      if (generation !== this.#generation || !nextShell) {
        return;
      }

      this.#renderShell = nextShell;
    } catch (error) {
      if (generation !== this.#generation) {
        return;
      }
      this.#handleNonFatalError(error, 'advance-render-shell');
    }
  }

  async #projectExactInitialWindow(generation: number, previewRangeEnd: number): Promise<WindowedProjectionResult> {
    if (previewRangeEnd <= 0) {
      throw new Error('Preview projection did not produce a valid opening range');
    }

    await this.#runtime.advanceRenderShell();
    if (generation !== this.#generation) {
      return makeCancelledWindowResult();
    }

    const nextShell = await this.#runtime.getRenderShell();
    if (generation !== this.#generation) {
      return makeCancelledWindowResult();
    }
    if (nextShell) {
      this.#renderShell = nextShell;
    }

    const exactResult = await this.#runtime.projectWindow({
      startBodyChildIndex: 0,
      maxBodyChildCount: previewRangeEnd,
      includeDependencyManifest: true,
    });
    if (generation !== this.#generation) {
      return makeCancelledWindowResult();
    }

    if (exactResult.continuation.nextBodyChildIndex !== previewRangeEnd) {
      throw new Error(
        `Preview upgrade projected an unexpected body-child range: expected ${previewRangeEnd}, received ${exactResult.continuation.nextBodyChildIndex}`,
      );
    }

    return exactResult;
  }

  #completeStreamingIfFinished(): void {
    if (this.#accumulated.nextBodyChildIndex < this.#accumulated.totalBodyChildCount) {
      return;
    }

    this.#completeness.markAllBodyComplete();
    if (this.#state === 'streaming') {
      this.#transition('enriching');
      this.#scheduleEnrichment();
    }
  }

  #needsMoreBufferedPages(): boolean {
    const layout = this.#accumulated.layout;
    if (!layout) {
      return true;
    }

    const totalPages = layout.pages.length;
    const { last } = this.#getVisiblePageRange();
    return totalPages < last + BUFFER_AHEAD_PAGES;
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

  #recordProjectionStats(windowResult: WindowedProjectionResult): void {
    const stats = windowResult.projectionStats;
    if (!stats) {
      return;
    }

    v2PerfTimeline.gauge(PROJECTION_FIELD_HEAVY_PARAGRAPHS, stats.fieldHeavyParagraphs);
    v2PerfTimeline.gauge(PROJECTION_PLAIN_PARAGRAPHS, stats.plainParagraphs);
    v2PerfTimeline.gauge(PROJECTION_COMPLEX_PARAGRAPHS, stats.complexParagraphs);
    v2PerfTimeline.gauge(PROJECTION_RUNS_SKIPPED_BY_FAST_PATH, stats.runsSkipped);
  }

  // ---- Private: Scroll ---------------------------------------------------------

  #installScrollListener(): void {
    this.#scrollHandler = () => {
      if (this.#scrollRafPending) return;
      this.#scrollRafPending = true;
      requestAnimationFrame(() => {
        this.#scrollRafPending = false;
        this.#domPainter?.onScroll?.();
        if (this.#state === 'streaming' || this.#state === 'firstPaintComplete') {
          this.#scheduleStreamingWork();
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

  #handleNonFatalError(error: unknown, phase: string, reason?: DegradedReason): void {
    const hasFirstPaint =
      this.#state === 'firstPaintComplete' ||
      this.#state === 'streaming' ||
      this.#state === 'enriching' ||
      this.#state === 'degraded';

    if (hasFirstPaint) {
      const degradedReason: DegradedReason =
        reason ??
        (phase === 'append' ? 'append-stalled' : phase === 'enrichment' ? 'enrichment-unavailable' : 'worker-error');

      this.#degradedInfo = {
        reason: degradedReason,
        message: error instanceof Error ? error.message : String(error),
        timestamp: perfNow(),
        recoverable: degradedReason !== 'worker-error',
      };

      this.#transition('degraded');
    }
    this.#emitLayoutError(error, phase);
  }

  #reportResourceViolations(violations: readonly ResourceViolation[]): void {
    for (const violation of violations) {
      this.#emitLayoutError(
        new Error(
          `Resource guard: ${violation.field} = ${violation.actual} exceeds limit ${violation.limit} (${violation.action})`,
        ),
        'resource-guard',
      );
    }
  }

  #emitLayoutError(error: unknown, phase: string): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.emit('layoutError', {
      phase,
      error: normalized,
      timestamp: Date.now(),
    });
  }

  #showLoadingOverlayWithProgress(message: string, progressPercent: number): void {
    this.#loadingMessage.textContent = message;
    this.#setLoadingProgress(progressPercent);
    if (this.#showDefaultLoadingOverlay) {
      this.#loadingOverlay.hidden = false;
      this.#loadingOverlay.style.display = 'flex';
      this.#loadingOverlay.setAttribute('aria-hidden', 'false');
    }
    this.#emitLoadingStateChange(true, message);
  }

  #hideLoadingOverlay(): void {
    if (this.#showDefaultLoadingOverlay) {
      this.#loadingOverlay.hidden = true;
      this.#loadingOverlay.style.display = 'none';
      this.#loadingOverlay.setAttribute('aria-hidden', 'true');
    }
    this.#emitLoadingStateChange(false, this.#loadingMessage.textContent ?? '');
  }

  #setLoadingProgress(progressPercent: number): void {
    const clampedPercent = clampProgressPercent(progressPercent);
    const nextPercent = Math.max(this.#loadingProgressPercent, clampedPercent);
    this.#loadingProgressPercent = nextPercent;
    this.#loadingProgressValue.textContent = `${nextPercent}%`;
    this.#loadingProgress.setAttribute('aria-valuenow', String(nextPercent));
    this.#loadingProgressBar.style.width = `${nextPercent}%`;
  }

  #resetLoadingProgress(): void {
    this.#loadingProgressPercent = 0;
    this.#loadingProgressValue.textContent = '0%';
    this.#loadingProgress.setAttribute('aria-valuenow', '0');
    this.#loadingProgressBar.style.width = '0%';
    this.#loadingMessage.textContent = this.#loadingTexts.openingMessage;
    this.#emitLoadingStateChange(false, this.#loadingTexts.openingMessage);
  }

  #emitLoadingStateChange(visible: boolean, message: string): void {
    this.emit('loadingStateChange', {
      visible,
      title: this.#loadingTexts.title,
      message,
      progressPercent: this.#loadingProgressPercent,
    } satisfies LoadingOverlayState);
  }

  #buildEditingSnapshotSelection(
    blockToSourceRef: ReadonlyMap<string, { partUri: string; nodeId: string; sourceNodePath?: string }>,
  ): EditingSnapshotSelection {
    const model = this.#editingController?.semanticModel;
    if (!model) {
      return createEmptyEditingSnapshotSelection();
    }

    const blockIdSnapshot = buildEditableDocumentSnapshotForBlockIds(model, blockToSourceRef.keys());
    const sourceRefSnapshot = buildEditableDocumentSnapshotFromSourceRefs(model, blockToSourceRef);
    const orderedBlockIds = blockToSourceRef.keys();
    const mergedSnapshot = mergeEditableDocumentSnapshots(blockIdSnapshot, sourceRefSnapshot, orderedBlockIds);

    return {
      snapshot: mergedSnapshot,
      snapshotSource: resolveEditingSnapshotSource(blockIdSnapshot, sourceRefSnapshot, mergedSnapshot),
      blockIdSnapshot,
      sourceRefSnapshot,
    };
  }

  #refreshEditableInteractionData(): void {
    const selection = this.#buildEditingSnapshotSelection(this.#accumulated.blockToSourceRef);
    this.#editingSnapshotSelection = selection;

    if (!selection.snapshot) {
      this.#accumulated.editingSnapshot = createEmptyEditingSnapshot();
      this.#publishEditingSurfaceDiagnostics();
      return;
    }

    reconcileSimpleEditableParagraphText(this.#accumulated.blocks, selection.snapshot);
    applyEditableInteractionData(this.#accumulated.blocks, selection.snapshot);
    console.debug('[V2StreamingPaginatedRenderHost] Applied editable interaction data', {
      paragraphBlockCount: this.#accumulated.blocks.filter((block) => block.kind === 'paragraph').length,
      blocksWithSegmentAttrs: this.#accumulated.blocks.filter(
        (block) =>
          block.kind === 'paragraph' &&
          block.runs.some(
            (run) =>
              run != null &&
              typeof run === 'object' &&
              'dataAttrs' in run &&
              run.dataAttrs != null &&
              DATA_ATTRS.SD_SEGMENT_ID in run.dataAttrs,
          ),
      ).length,
    });
    this.#accumulated.editingSnapshot = selection.snapshot;
    this.#publishEditingSurfaceDiagnostics();
  }

  async #refreshRenderedInteractionData(previousState?: {
    previousBlocks: FlowBlock[];
    previousLayout: Layout | null;
    previousMeasures: Measure[];
  }): Promise<void> {
    if (!this.#accumulated.layout && !previousState?.previousLayout) {
      this.#publishEditingSurfaceDiagnostics();
      return;
    }

    try {
      if (previousState) {
        await this.#measurePaginatePaint(previousState);
      } else {
        this.#accumulated.layout = null;
        await this.#measurePaginatePaint();
      }
    } catch (error) {
      this.#emitLayoutError(error, 'render');
    } finally {
      this.#publishEditingSurfaceDiagnostics();
    }
  }

  async #tryApplyStructuralReprojection(options?: {
    pendingSelection?: V2PendingSelection | null;
    anchorParagraphSourceRef?: { partUri: string; nodeId: string; sourceNodePath?: string } | null;
    mutationKind?: V2EditingMutationKind;
  }): Promise<boolean> {
    const documentHandle = this.#editingController?.documentHandle;
    if (!documentHandle) {
      console.debug('[V2StreamingPaginatedRenderHost] Structural reprojection skipped: no document handle');
      return false;
    }

    await documentHandle.ready('first-paint-shell');

    const reprojection = reprojectStructuralStreamingWindows({
      documentHandle,
      windowRecords: this.#accumulated.windowRecords,
      blockToSourceRef: this.#accumulated.blockToSourceRef,
      totalBodyChildCount: this.#accumulated.totalBodyChildCount,
      pendingSelection: options?.pendingSelection,
      anchorParagraphSourceRef: options?.anchorParagraphSourceRef ?? null,
      mutationKind: options?.mutationKind,
    });

    if (!reprojection?.changed) {
      console.debug('[V2StreamingPaginatedRenderHost] Structural reprojection skipped', {
        mutationKind: options?.mutationKind ?? null,
        hasRenderShell: Boolean(documentHandle.renderShell()),
        windowRecordCount: this.#accumulated.windowRecords.length,
      });
      return false;
    }

    this.#accumulated.windowRecords = reprojection.windowRecords;
    this.#accumulated.blocks = reprojection.blocks;
    this.#accumulated.blockToSourceRef = reprojection.blockToSourceRef;
    this.#accumulated.nextBodyChildIndex = reprojection.nextBodyChildIndex;
    this.#accumulated.totalBodyChildCount = reprojection.totalBodyChildCount;
    this.#accumulated.dependencyManifest = reprojection.dependencyManifest;
    this.#streamingEditingSuspended = false;
    this.#editingProjectionAligned = true;

    console.debug('[V2StreamingPaginatedRenderHost] Reprojected structural edit windows', {
      mutationKind: options?.mutationKind ?? null,
      affectedWindowIndex: reprojection.affectedWindowIndex,
      reprojectedWindowCount: reprojection.reprojectedWindowCount,
      nextBodyChildIndex: reprojection.nextBodyChildIndex,
      totalBodyChildCount: reprojection.totalBodyChildCount,
      blockCount: reprojection.blocks.length,
    });

    return true;
  }

  async #awaitInitialEditingControllerBootstrap(generation: number): Promise<void> {
    if (this.#editingController || !this.#initialEditingControllerBootstrap) {
      return;
    }

    const controller = await waitForBootstrapController(
      this.#initialEditingControllerBootstrap,
      INITIAL_EDITING_BOOTSTRAP_WAIT_MS,
    );

    if (!controller || generation !== this.#generation || this.#editingController === controller) {
      return;
    }

    this.bindEditingController(controller);
    console.debug('[V2StreamingPaginatedRenderHost] Bound editing controller before first window paint');
  }

  #publishEditingSurfaceDiagnostics(): void {
    let nextStatus = buildEditingSurfaceStatus(
      this.#accumulated,
      this.#editingSnapshotSelection,
      this.#painterHost,
      this.#editingBootstrapPhase,
      this.#editingBootstrapIssue,
    );

    if (nextStatus.ready && this.#editingBootstrapPhase !== 'failed' && this.#editingBootstrapPhase !== 'ready') {
      this.#editingBootstrapPhase = 'ready';
      this.#editingBootstrapIssue = null;
      nextStatus = buildEditingSurfaceStatus(
        this.#accumulated,
        this.#editingSnapshotSelection,
        this.#painterHost,
        this.#editingBootstrapPhase,
        this.#editingBootstrapIssue,
      );
    } else if (!nextStatus.ready && this.#editingBootstrapPhase === 'ready') {
      this.#editingBootstrapPhase = 'blocked';
      this.#editingBootstrapIssue = deriveEditingBootstrapIssue(nextStatus, Boolean(this.#editingController));
      nextStatus = buildEditingSurfaceStatus(
        this.#accumulated,
        this.#editingSnapshotSelection,
        this.#painterHost,
        this.#editingBootstrapPhase,
        this.#editingBootstrapIssue,
      );
    }

    this.#editingSurfaceStatus = nextStatus;
    applyEditingSurfaceDiagnostics(this.element, this.#editingSurfaceStatus);
  }

  #setEditingBootstrapState(phase: V2EditingBootstrapPhase, issue: string | null = null): void {
    this.#editingBootstrapPhase = phase;
    this.#editingBootstrapIssue = issue;
    this.#publishEditingSurfaceDiagnostics();
  }
}

// ---- Module-level helpers ----------------------------------------------------

function createEmptyAccumulated(): AccumulatedState {
  return {
    blocks: [],
    measures: [],
    layout: null,
    windowRecords: [],
    blockToSourceRef: new Map(),
    editingSnapshot: createEmptyEditingSnapshot(),
    nextBodyChildIndex: 0,
    totalBodyChildCount: 0,
    sectionMetadata: [],
    dependencyManifest: createEmptyDependencyManifest(),
  };
}

function resolveAppendPreviousBlocks(accumulated: AccumulatedState): FlowBlock[] {
  if (!accumulated.layout) {
    return [];
  }

  const lastWindowBlockCount =
    accumulated.windowRecords.length > 0
      ? accumulated.windowRecords[accumulated.windowRecords.length - 1].blockCount
      : 0;
  return accumulated.blocks.slice(0, accumulated.blocks.length - lastWindowBlockCount);
}

async function waitForBootstrapController(
  controllerPromise: Promise<V2EditingController | null>,
  timeoutMs: number,
): Promise<V2EditingController | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      controllerPromise,
      new Promise<V2EditingController | null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  }
}

function createEmptyEditingSnapshot(): V2EditableDocumentSnapshot {
  return {
    blockToEntityRef: new Map(),
    paragraphsByBlockId: new Map(),
    orderedParagraphs: [],
  };
}

function createEmptyEditingSnapshotSelection(): EditingSnapshotSelection {
  return {
    snapshot: null,
    snapshotSource: 'none',
    blockIdSnapshot: null,
    sourceRefSnapshot: null,
  };
}

function createEmptyEditingSurfaceStatus(): V2EditingSurfaceStatus {
  return {
    ready: false,
    bootstrapPhase: 'idle',
    bootstrapIssue: null,
    snapshotSource: 'none',
    renderedParagraphCount: 0,
    renderedEditableParagraphCount: 0,
    renderedEmptyEditableParagraphCount: 0,
    domSegmentCount: 0,
    snapshotParagraphCount: 0,
    supportedParagraphCount: 0,
    emptyEditableParagraphCount: 0,
    blockIdParagraphCount: 0,
    blockIdSupportedParagraphCount: 0,
    sourceRefParagraphCount: 0,
    sourceRefSupportedParagraphCount: 0,
    blockIdOnlySupportedParagraphCount: 0,
    sourceRefOnlySupportedParagraphCount: 0,
    missingRenderedBlockIdCount: 0,
    paragraphsWithoutDomSegmentsCount: 0,
    unsupportedParagraphHistogram: [],
    missingRenderedBlockIds: [],
    paragraphsWithoutDomSegments: [],
  };
}

function resolveEditingSnapshotSource(
  blockIdSnapshot: V2EditableDocumentSnapshot,
  sourceRefSnapshot: V2EditableDocumentSnapshot,
  mergedSnapshot: V2EditableDocumentSnapshot,
): V2EditingSnapshotSource {
  if (mergedSnapshot.orderedParagraphs.length === 0) {
    return 'none';
  }

  const blockIdSignature = snapshotSignature(blockIdSnapshot);
  const sourceRefSignature = snapshotSignature(sourceRefSnapshot);
  const mergedSignature = snapshotSignature(mergedSnapshot);

  if (mergedSignature === blockIdSignature && mergedSignature === sourceRefSignature) {
    if (countSupportedParagraphs(blockIdSnapshot) > 0 || countSupportedParagraphs(sourceRefSnapshot) > 0) {
      return 'merged';
    }

    return 'none';
  }

  if (mergedSignature === blockIdSignature) {
    return 'blockIds';
  }

  if (mergedSignature === sourceRefSignature) {
    return 'sourceRefs';
  }

  return 'merged';
}

function snapshotSignature(snapshot: V2EditableDocumentSnapshot): string {
  return snapshot.orderedParagraphs
    .map(
      (paragraph) =>
        `${paragraph.blockId}:${paragraph.supported ? '1' : '0'}:${paragraph.segments.length}:${paragraph.text.length}`,
    )
    .join('|');
}

function countSupportedParagraphs(snapshot: V2EditableDocumentSnapshot): number {
  return snapshot.orderedParagraphs.filter((paragraph) => paragraph.supported).length;
}

function countSupportedOnlyInLeftSnapshot(left: V2EditableDocumentSnapshot, right: V2EditableDocumentSnapshot): number {
  let count = 0;

  for (const paragraph of left.orderedParagraphs) {
    if (!paragraph.supported) {
      continue;
    }

    const rightParagraph = right.paragraphsByBlockId.get(paragraph.blockId);
    if (!rightParagraph?.supported) {
      count += 1;
    }
  }

  return count;
}

function buildUnsupportedParagraphHistogram(snapshot: V2EditableDocumentSnapshot): V2EditingHistogramEntry[] {
  const counts = new Map<string, number>();

  snapshot.orderedParagraphs.forEach((paragraph) => {
    if (paragraph.supported) {
      return;
    }

    const reason = paragraph.unsupportedReason ?? 'Paragraph has no visible editable segments';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  });

  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.reason.localeCompare(right.reason);
    });
}

function deriveEditingBootstrapIssue(status: V2EditingSurfaceStatus, hasController: boolean): string | null {
  if (status.ready) {
    return null;
  }

  if (!hasController) {
    return 'Editing controller is not bound';
  }

  if (status.snapshotParagraphCount === 0) {
    return 'Editing snapshot produced no paragraphs';
  }

  if (status.supportedParagraphCount === 0) {
    const topReason = status.unsupportedParagraphHistogram[0];
    return topReason
      ? `Editing snapshot produced no supported paragraphs. Top blocker: ${topReason.reason} (${topReason.count})`
      : 'Editing snapshot produced no supported paragraphs';
  }

  if (status.renderedParagraphCount === 0) {
    return 'No rendered paragraph blocks are mounted yet';
  }

  if (status.renderedEditableParagraphCount === 0 && status.paragraphsWithoutDomSegmentsCount > 0) {
    return 'Rendered supported paragraphs are missing inline segment anchors';
  }

  if (status.domSegmentCount === 0) {
    return 'No inline segment anchors are mounted in the streamed DOM';
  }

  if (status.missingRenderedBlockIdCount > 0) {
    return 'Rendered paragraphs are missing from the editing snapshot';
  }

  return 'Editing surface is still preparing';
}

function buildEditingSurfaceStatus(
  accumulated: AccumulatedState,
  selection: EditingSnapshotSelection,
  painterHost: HTMLElement,
  bootstrapPhase: V2EditingBootstrapPhase,
  bootstrapIssue: string | null,
): V2EditingSurfaceStatus {
  const snapshot = selection.snapshot ?? createEmptyEditingSnapshot();
  const blockIdSnapshot = selection.blockIdSnapshot ?? createEmptyEditingSnapshot();
  const sourceRefSnapshot = selection.sourceRefSnapshot ?? createEmptyEditingSnapshot();
  const renderedParagraphBlockIds = collectRenderedParagraphBlockIds(accumulated, painterHost);
  const blockElementsById = collectRenderedParagraphElementsById(painterHost, renderedParagraphBlockIds);
  const missingRenderedBlockIds: string[] = [];
  const paragraphsWithoutDomSegments: string[] = [];
  let renderedEditableParagraphCount = 0;
  let renderedEmptyEditableParagraphCount = 0;

  renderedParagraphBlockIds.forEach((blockId) => {
    const paragraph = snapshot.paragraphsByBlockId.get(blockId);
    if (!paragraph) {
      missingRenderedBlockIds.push(blockId);
      return;
    }

    if (!paragraph.supported) {
      return;
    }

    const blockElement = blockElementsById.get(blockId);
    const segmentCount = countBlockSegments(blockElement);
    if (segmentCount > 0) {
      renderedEditableParagraphCount += 1;
      if (isEmptyEditableParagraph(paragraph)) {
        renderedEmptyEditableParagraphCount += 1;
      }
      return;
    }

    paragraphsWithoutDomSegments.push(blockId);
  });

  const domSegmentCount = painterHost.querySelectorAll(`[${DATA_ATTRS.SD_SEGMENT_ID}]`).length;
  const unsupportedParagraphHistogram = buildUnsupportedParagraphHistogram(snapshot);

  return {
    ready: renderedEditableParagraphCount > 0 && domSegmentCount > 0,
    bootstrapPhase,
    bootstrapIssue,
    snapshotSource: selection.snapshotSource,
    renderedParagraphCount: renderedParagraphBlockIds.length,
    renderedEditableParagraphCount,
    renderedEmptyEditableParagraphCount,
    domSegmentCount,
    snapshotParagraphCount: snapshot.orderedParagraphs.length,
    supportedParagraphCount: countSupportedParagraphs(snapshot),
    emptyEditableParagraphCount: countEmptyEditableParagraphs(snapshot),
    blockIdParagraphCount: blockIdSnapshot.orderedParagraphs.length,
    blockIdSupportedParagraphCount: countSupportedParagraphs(blockIdSnapshot),
    sourceRefParagraphCount: sourceRefSnapshot.orderedParagraphs.length,
    sourceRefSupportedParagraphCount: countSupportedParagraphs(sourceRefSnapshot),
    blockIdOnlySupportedParagraphCount: countSupportedOnlyInLeftSnapshot(blockIdSnapshot, sourceRefSnapshot),
    sourceRefOnlySupportedParagraphCount: countSupportedOnlyInLeftSnapshot(sourceRefSnapshot, blockIdSnapshot),
    missingRenderedBlockIdCount: missingRenderedBlockIds.length,
    paragraphsWithoutDomSegmentsCount: paragraphsWithoutDomSegments.length,
    unsupportedParagraphHistogram,
    missingRenderedBlockIds,
    paragraphsWithoutDomSegments,
  };
}

function countEmptyEditableParagraphs(snapshot: V2EditableDocumentSnapshot): number {
  return snapshot.orderedParagraphs.filter((paragraph) => isEmptyEditableParagraph(paragraph)).length;
}

function reconcileSimpleEditableParagraphText(
  blocks: readonly FlowBlock[],
  snapshot: V2EditableDocumentSnapshot,
): void {
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
      continue;
    }

    const paragraph = snapshot.paragraphsByBlockId.get(block.id);
    if (!paragraph?.supported) {
      continue;
    }

    reconcileEditableParagraphBlockText(block, paragraph);
  }
}

function reconcileEditableParagraphBlockText(
  block: Extract<FlowBlock, { kind: 'paragraph' }>,
  paragraph: V2EditableParagraph,
): boolean {
  if (supportsSimpleParagraphTextReconciliation(paragraph)) {
    return reconcileSimpleEditableParagraphBlockText(block, paragraph);
  }

  return rebuildEditableParagraphBlockRuns(block, paragraph);
}

function reconcileSimpleEditableParagraphBlockText(
  block: Extract<FlowBlock, { kind: 'paragraph' }>,
  paragraph: V2EditableParagraph,
): boolean {
  const textRuns = block.runs.filter(isParagraphTextCarrierRun);
  if (textRuns.length === 0) {
    return false;
  }

  textRuns.forEach((run, index) => {
    run.text = index === 0 ? paragraph.text : '';
    if (run.pmStart != null) {
      run.pmEnd = run.pmStart + run.text.length;
    }
  });

  return true;
}

function rebuildEditableParagraphBlockRuns(
  block: Extract<FlowBlock, { kind: 'paragraph' }>,
  paragraph: V2EditableParagraph,
): boolean {
  if (!supportsParagraphRunRebuild(block, paragraph)) {
    return false;
  }

  const templates = collectParagraphRunTemplates(block);
  if (templates.length === 0) {
    return false;
  }

  block.runs = paragraph.segments.map((segment) =>
    createRebuiltParagraphRun(selectParagraphRunTemplate(templates, segment), paragraph, segment),
  );
  return true;
}

function supportsSimpleParagraphTextReconciliation(paragraph: V2EditableParagraph): boolean {
  const mutableSegments = paragraph.segments.filter((segment) => segment.isMutableText);
  if (mutableSegments.length === 0 || mutableSegments.length !== paragraph.segments.length) {
    return false;
  }

  return new Set(mutableSegments.map((segment) => segment.runRef.id)).size === 1;
}

function supportsParagraphRunRebuild(
  block: Extract<FlowBlock, { kind: 'paragraph' }>,
  paragraph: V2EditableParagraph,
): boolean {
  return (
    paragraph.supported &&
    paragraph.segments.length > 0 &&
    block.runs.length > 0 &&
    block.runs.every(isParagraphTextCarrierRun)
  );
}

type ParagraphRunTemplate = {
  readonly run: Extract<FlowBlock, { kind: 'paragraph' }>['runs'][number] & {
    text: string;
    pmStart?: number;
    pmEnd?: number;
    dataAttrs?: Record<string, string>;
  };
  readonly runRefId: string | null;
};

function collectParagraphRunTemplates(
  block: Extract<FlowBlock, { kind: 'paragraph' }>,
): readonly ParagraphRunTemplate[] {
  return block.runs.filter(isParagraphTextCarrierRun).map((run) => ({
    run,
    runRefId: run.dataAttrs?.[DATA_ATTRS.SD_RUN_REF] ?? null,
  }));
}

function selectParagraphRunTemplate(
  templates: readonly ParagraphRunTemplate[],
  segment: V2EditableParagraph['segments'][number],
): ParagraphRunTemplate {
  return (
    templates.find((template) => template.runRefId === segment.runRef.id) ??
    templates[Math.min(segment.runIndex, templates.length - 1)] ??
    templates[0]
  );
}

function createRebuiltParagraphRun(
  template: ParagraphRunTemplate,
  paragraph: V2EditableParagraph,
  segment: V2EditableParagraph['segments'][number],
): ParagraphRunTemplate['run'] {
  const { pmStart: _pmStart, pmEnd: _pmEnd, dataAttrs, ...baseRun } = template.run;
  return {
    ...baseRun,
    text: segment.text,
    dataAttrs: {
      ...(dataAttrs ?? {}),
      [DATA_ATTRS.SD_ENTITY_REF]: paragraph.paragraphRef.id,
      [DATA_ATTRS.SD_STORY_ID]: paragraph.storyId,
      [DATA_ATTRS.SD_RUN_REF]: segment.runRef.id,
      [DATA_ATTRS.SD_SEGMENT_ID]: segment.segmentId,
      [DATA_ATTRS.SD_SEGMENT_START]: String(segment.paragraphStart),
      [DATA_ATTRS.SD_SEGMENT_END]: String(segment.paragraphEnd),
      [DATA_ATTRS.SD_INTERACTION_KIND]: segment.isMutableText ? 'text' : 'protected-text',
    },
  } as ParagraphRunTemplate['run'];
}

function isParagraphTextCarrierRun(run: Extract<FlowBlock, { kind: 'paragraph' }>['runs'][number]): run is Extract<
  FlowBlock,
  { kind: 'paragraph' }
>['runs'][number] & {
  text: string;
  pmStart?: number;
  pmEnd?: number;
  dataAttrs?: Record<string, string>;
} {
  return (run.kind === undefined || run.kind === 'text') && typeof run.text === 'string';
}

function collectRenderedParagraphBlockIds(accumulated: AccumulatedState, painterHost: HTMLElement): string[] {
  const renderedBlockIds = new Set<string>();
  painterHost.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}]`).forEach((element) => {
    const blockId = element.getAttribute(DATA_ATTRS.BLOCK_ID);
    if (blockId) {
      renderedBlockIds.add(blockId);
    }
  });

  return accumulated.blocks
    .filter((block) => block.kind === 'paragraph' && renderedBlockIds.has(block.id))
    .map((block) => block.id);
}

function collectRenderedParagraphElementsById(
  painterHost: HTMLElement,
  blockIds: readonly string[],
): Map<string, HTMLElement> {
  const blockIdSet = new Set(blockIds);
  const elementsById = new Map<string, HTMLElement>();

  painterHost.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}]`).forEach((element) => {
    const blockId = element.getAttribute(DATA_ATTRS.BLOCK_ID);
    if (!blockId || !blockIdSet.has(blockId) || elementsById.has(blockId)) {
      return;
    }

    elementsById.set(blockId, element);
  });

  return elementsById;
}

function countBlockSegments(blockElement: HTMLElement | undefined): number {
  if (!blockElement) {
    return 0;
  }

  return blockElement.querySelectorAll(`[${DATA_ATTRS.SD_SEGMENT_ID}]`).length;
}

function applyEditingSurfaceDiagnostics(element: HTMLElement, status: V2EditingSurfaceStatus): void {
  element.setAttribute(EDITING_SURFACE_READY_ATTR, String(status.ready));
  element.setAttribute(EDITING_SURFACE_BOOTSTRAP_PHASE_ATTR, status.bootstrapPhase);
  element.setAttribute(EDITING_SURFACE_BOOTSTRAP_ISSUE_ATTR, status.bootstrapIssue ?? '');
  element.setAttribute(EDITING_SURFACE_SOURCE_ATTR, status.snapshotSource);
  element.setAttribute(EDITING_SURFACE_RENDERED_PARAGRAPH_COUNT_ATTR, String(status.renderedParagraphCount));
  element.setAttribute(EDITING_SURFACE_RENDERED_EDITABLE_COUNT_ATTR, String(status.renderedEditableParagraphCount));
  element.setAttribute(EDITING_SURFACE_DOM_SEGMENT_COUNT_ATTR, String(status.domSegmentCount));
  element.setAttribute(EDITING_SURFACE_SNAPSHOT_PARAGRAPH_COUNT_ATTR, String(status.snapshotParagraphCount));
  element.setAttribute(EDITING_SURFACE_SUPPORTED_PARAGRAPH_COUNT_ATTR, String(status.supportedParagraphCount));
  element.setAttribute(EDITING_SURFACE_BLOCK_ID_SUPPORTED_COUNT_ATTR, String(status.blockIdSupportedParagraphCount));
  element.setAttribute(
    EDITING_SURFACE_SOURCE_REF_SUPPORTED_COUNT_ATTR,
    String(status.sourceRefSupportedParagraphCount),
  );
  element.setAttribute(
    EDITING_SURFACE_BLOCK_ID_ONLY_SUPPORTED_COUNT_ATTR,
    String(status.blockIdOnlySupportedParagraphCount),
  );
  element.setAttribute(
    EDITING_SURFACE_SOURCE_REF_ONLY_SUPPORTED_COUNT_ATTR,
    String(status.sourceRefOnlySupportedParagraphCount),
  );
  element.setAttribute(EDITING_SURFACE_MISSING_RENDERED_COUNT_ATTR, String(status.missingRenderedBlockIdCount));
  element.setAttribute(
    EDITING_SURFACE_MISSING_RENDERED_SAMPLE_ATTR,
    JSON.stringify(status.missingRenderedBlockIds.slice(0, 10)),
  );
  element.setAttribute(
    EDITING_SURFACE_PARAGRAPHS_WITHOUT_SEGMENTS_COUNT_ATTR,
    String(status.paragraphsWithoutDomSegmentsCount),
  );
  element.setAttribute(
    EDITING_SURFACE_PARAGRAPHS_WITHOUT_SEGMENTS_SAMPLE_ATTR,
    JSON.stringify(status.paragraphsWithoutDomSegments.slice(0, 10)),
  );
  element.setAttribute(
    EDITING_SURFACE_UNSUPPORTED_HISTOGRAM_ATTR,
    JSON.stringify(status.unsupportedParagraphHistogram.slice(0, 10)),
  );
}

function createLoadingOverlay(loadingTexts: LoadingOverlayTexts): {
  overlay: HTMLDivElement;
  message: HTMLParagraphElement;
  progress: HTMLDivElement;
  progressValue: HTMLSpanElement;
  progressBar: HTMLDivElement;
} {
  const overlay = document.createElement('div');
  overlay.className = 'v2-streaming-renderer__loading';
  overlay.hidden = true;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'v2-streaming-renderer__loading-panel';

  const title = document.createElement('h2');
  title.className = 'v2-streaming-renderer__loading-title';
  title.textContent = loadingTexts.title;

  const message = document.createElement('p');
  message.className = 'v2-streaming-renderer__loading-message';
  message.textContent = loadingTexts.openingMessage;

  const meta = document.createElement('div');
  meta.className = 'v2-streaming-renderer__loading-meta';

  const progressLabel = document.createElement('span');
  progressLabel.className = 'v2-streaming-renderer__loading-progress-label';
  progressLabel.textContent = 'Progress';

  const progressValue = document.createElement('span');
  progressValue.className = 'v2-streaming-renderer__loading-progress-value';
  progressValue.textContent = '0%';

  meta.append(progressLabel, progressValue);

  const progress = document.createElement('div');
  progress.className = 'v2-streaming-renderer__loading-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', 'Document loading progress');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', '0');

  const progressTrack = document.createElement('div');
  progressTrack.className = 'v2-streaming-renderer__loading-progress-track';

  const progressBar = document.createElement('div');
  progressBar.className = 'v2-streaming-renderer__loading-progress-bar';
  progressTrack.appendChild(progressBar);
  progress.appendChild(progressTrack);

  panel.append(title, message, meta, progress);
  overlay.appendChild(panel);

  return { overlay, message, progress, progressValue, progressBar };
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

  const loadingOverlay = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading');
  if (loadingOverlay) {
    loadingOverlay.style.position = 'fixed';
    loadingOverlay.style.top = 'var(--sd-ui-loader-offset-top, 132px)';
    loadingOverlay.style.left = '50%';
    loadingOverlay.style.transform = 'translateX(-50%)';
    loadingOverlay.style.width = 'var(--sd-ui-loader-width, min(420px, calc(100vw - 48px)))';
    loadingOverlay.style.alignItems = 'center';
    loadingOverlay.style.justifyContent = 'center';
    loadingOverlay.style.zIndex = 'var(--sd-ui-loader-z-index, 20)';
    loadingOverlay.style.pointerEvents = 'none';
  }

  const loadingPanel = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-panel');
  if (loadingPanel) {
    loadingPanel.style.display = 'grid';
    loadingPanel.style.gap = 'var(--sd-ui-loader-gap, 12px)';
    loadingPanel.style.width = '100%';
    loadingPanel.style.padding = 'var(--sd-ui-loader-padding, 20px 24px)';
    loadingPanel.style.borderRadius = 'var(--sd-ui-loader-radius, 14px)';
    loadingPanel.style.background =
      'var(--sd-ui-loader-bg, color-mix(in srgb, var(--sd-ui-bg, #ffffff) 96%, transparent))';
    loadingPanel.style.boxShadow = 'var(--sd-ui-loader-shadow, var(--sd-ui-shadow, 0 4px 12px rgba(0, 0, 0, 0.12)))';
    loadingPanel.style.border = '1px solid var(--sd-ui-loader-border, var(--sd-ui-border, #dbdbdb))';
  }

  const loadingTitle = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-title');
  if (loadingTitle) {
    loadingTitle.style.margin = '0';
    loadingTitle.style.fontSize = 'var(--sd-ui-loader-title-size, 18px)';
    loadingTitle.style.fontWeight = 'var(--sd-ui-loader-title-weight, 600)';
    loadingTitle.style.color = 'var(--sd-ui-loader-title-color, var(--sd-ui-text, #47484a))';
  }

  const loadingMessage = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-message');
  if (loadingMessage) {
    loadingMessage.style.margin = '0';
    loadingMessage.style.fontSize = 'var(--sd-ui-loader-message-size, 14px)';
    loadingMessage.style.lineHeight = 'var(--sd-ui-loader-message-line-height, 1.5)';
    loadingMessage.style.color = 'var(--sd-ui-loader-message-color, var(--sd-ui-text-muted, #666666))';
  }

  const loadingMeta = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-meta');
  if (loadingMeta) {
    loadingMeta.style.display = 'flex';
    loadingMeta.style.alignItems = 'center';
    loadingMeta.style.justifyContent = 'space-between';
    loadingMeta.style.gap = 'var(--sd-ui-loader-meta-gap, 12px)';
  }

  const loadingProgressLabel = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-progress-label');
  if (loadingProgressLabel) {
    loadingProgressLabel.style.fontSize = 'var(--sd-ui-loader-meta-size, 12px)';
    loadingProgressLabel.style.fontWeight = 'var(--sd-ui-loader-meta-weight, 600)';
    loadingProgressLabel.style.letterSpacing = '0.02em';
    loadingProgressLabel.style.textTransform = 'uppercase';
    loadingProgressLabel.style.color = 'var(--sd-ui-loader-meta-color, var(--sd-ui-text-muted, #666666))';
  }

  const loadingProgressValue = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-progress-value');
  if (loadingProgressValue) {
    loadingProgressValue.style.fontSize = 'var(--sd-ui-loader-value-size, 13px)';
    loadingProgressValue.style.fontWeight = 'var(--sd-ui-loader-value-weight, 600)';
    loadingProgressValue.style.color = 'var(--sd-ui-loader-value-color, var(--sd-ui-text, #47484a))';
  }

  const loadingProgress = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-progress');
  if (loadingProgress) {
    loadingProgress.style.width = '100%';
    loadingProgress.style.display = 'block';
  }

  const loadingProgressTrack = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-progress-track');
  if (loadingProgressTrack) {
    loadingProgressTrack.style.position = 'relative';
    loadingProgressTrack.style.width = '100%';
    loadingProgressTrack.style.height = 'var(--sd-ui-loader-progress-height, 8px)';
    loadingProgressTrack.style.overflow = 'hidden';
    loadingProgressTrack.style.borderRadius = 'var(--sd-ui-loader-progress-radius, 999px)';
    loadingProgressTrack.style.background =
      'var(--sd-ui-loader-progress-track-bg, color-mix(in srgb, var(--sd-ui-border, #dbdbdb) 45%, transparent))';
  }

  const loadingProgressBar = root.querySelector<HTMLElement>('.v2-streaming-renderer__loading-progress-bar');
  if (loadingProgressBar) {
    loadingProgressBar.style.height = '100%';
    loadingProgressBar.style.width = '0%';
    loadingProgressBar.style.borderRadius = 'var(--sd-ui-loader-progress-radius, 999px)';
    loadingProgressBar.style.background =
      'var(--sd-ui-loader-progress-fill, linear-gradient(90deg, var(--sd-ui-action, #1355ff), var(--sd-color-blue-300, #85a5ff)))';
    loadingProgressBar.style.transition = 'width var(--sd-ui-loader-progress-transition-duration, 220ms) ease';
  }
}

function clampProgressPercent(progressPercent: number): number {
  if (!Number.isFinite(progressPercent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(progressPercent)));
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

/**
 * The v2 model projection layer publishes FlowBlock shapes that are
 * intentionally wire-compatible with the layout-engine contract package.
 *
 * TypeScript cannot prove that compatibility across package boundaries, so the
 * host normalizes the boundary once here instead of spreading assertions
 * throughout the render pipeline.
 */
function toContractFlowBlocks(blocks: WindowedProjectionResult['blocks']): FlowBlock[] {
  return blocks as unknown as FlowBlock[];
}

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function getFieldHeavyRatio(stats: WindowedProjectionResult['projectionStats']): number | undefined {
  if (!stats) {
    return undefined;
  }

  const ratioDenominator = stats.fieldHeavyParagraphs + stats.plainParagraphs;
  if (ratioDenominator === 0) {
    return undefined;
  }

  return stats.fieldHeavyParagraphs / ratioDenominator;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createCooperativeMeasureBlock(
  measure: (block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) => Promise<Measure>,
): (block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) => Promise<Measure> {
  let lastYieldAt = perfNow();

  return async (block, constraints) => {
    if (perfNow() - lastYieldAt >= MAIN_THREAD_YIELD_BUDGET_MS) {
      await yieldToBrowser();
      lastYieldAt = perfNow();
    }

    return measure(block, constraints);
  };
}

async function yieldToBrowser(): Promise<void> {
  const browserScheduler = getBrowserScheduler();
  if (typeof browserScheduler?.yield === 'function') {
    await browserScheduler.yield();
    return;
  }

  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function getBrowserScheduler(): { yield?: () => Promise<void> } | null {
  const candidate = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return candidate ?? null;
}

function makeCancelledWindowResult(): WindowedProjectionResult {
  return {
    blocks: [],
    continuation: {
      nextBodyChildIndex: 0,
      hasMore: false,
      totalBodyChildCount: 0,
    },
    blockToSourceRef: new Map(),
    sectionMetadata: {
      sectionBreaks: [],
    },
  };
}

function isPreviewUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'PreviewWindowUnsupportedError' || error.message.startsWith('Preview projection does not support')
  );
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
  const imageRefs = new Map<string, { relationshipId: string; sourcePartUri: string }>();
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
    imageRefs.set(`${entry.sourcePartUri}:${entry.relationshipId}`, entry);
  }
  for (const entry of nextManifest.imageRefs) {
    imageRefs.set(`${entry.sourcePartUri}:${entry.relationshipId}`, entry);
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
