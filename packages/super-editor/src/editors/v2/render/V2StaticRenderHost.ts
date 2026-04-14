import { EventEmitter } from 'eventemitter3';
import { measureBlock } from '@superdoc/measuring-dom';
import { createDomPainter } from '@superdoc/painter-dom';
import { DATA_ATTRS, DATASET_KEYS } from '@superdoc/dom-contract';
import { projectToFlowBlocks } from '@superdoc/v2-model';
import type { FlowBlock, Layout, Measure } from '@superdoc/contracts';
import type {
  EntityRef,
  SemanticOperation,
  SemanticOperationResult,
  SaveOptions,
  SaveResult,
} from '@superdoc/v2-model';
import type { LayoutEngineOptions, TrackedChangesOverrides } from '../../v1/core/presentation-editor/types.js';
import { runInstrumentedIncrementalLayout } from '../../../core/perf/runInstrumentedIncrementalLayout.js';
import {
  V2DocumentRuntime,
  type V2DocumentApiAdapter as PresentationV2DocumentApiAdapter,
  type V2DocumentSource,
  type V2SemanticDocument as PresentationV2SemanticDocument,
  type V2SemanticModel as PresentationV2SemanticModel,
} from '../runtime/V2DocumentRuntime.js';
import { V2EditingController, type InvokeResult, type NoopResult } from '../runtime/V2EditingController.js';
import {
  applyEditableInteractionData,
  buildEditableDocumentSnapshot,
  type V2EditableDocumentSnapshot,
} from '../editing/V2EditableDocumentSnapshot.js';
import {
  v2PerfTimeline,
  SPAN_RENDER,
  SPAN_PAINT,
  LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT,
  PAINT_FIRST_PAGE_MOUNTED,
} from '@superdoc/v2-perf';

const DEFAULT_PAGE_SIZE = { w: 612, h: 792 };
const DEFAULT_MARGINS = { top: 72, right: 72, bottom: 72, left: 72 };
const DEFAULT_PAGE_GAP = 24;
const DEFAULT_HORIZONTAL_PAGE_GAP = 20;
const DEFAULT_LAYOUT_MODE = 'vertical';
const DEFAULT_FLOW_MODE = 'paginated';
const MIN_SEMANTIC_CONTENT_WIDTH_PX = 240;
const RESIZE_RERENDER_DEBOUNCE_MS = 16;
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;

type DocumentMode = 'editing' | 'viewing' | 'suggesting';

export type V2StaticRenderHostOptions = {
  element: HTMLElement;
  documentId?: string;
  layoutEngineOptions?: LayoutEngineOptions;
  documentMode?: DocumentMode;
  disableContextMenu?: boolean;
};

export type V2StaticLayoutSnapshot = {
  blocks: FlowBlock[];
  measures: Measure[];
  layout: Layout | null;
};

/** Projection metadata exposed for targeting and interaction. */
export type V2ProjectionSnapshot = {
  readonly blockToEntityRef: ReadonlyMap<string, EntityRef>;
};

export type V2EditingSnapshot = V2EditableDocumentSnapshot;

export type V2StaticLayoutPayload = {
  blocks: FlowBlock[];
  measures: Measure[];
  layout: Layout;
};

type ResolvedLayoutInput = {
  pageSize: { w: number; h: number };
  margins: { top: number; right: number; bottom: number; left: number; header?: number; footer?: number };
  columns?: { count: number; gap: number };
  flowMode: 'paginated' | 'semantic';
  semantic?: {
    contentWidth: number;
    marginLeft: number;
    marginRight: number;
    marginTop: number;
    marginBottom: number;
  };
  sectionMetadata: [];
};

/**
 * Minimal static host for the v2 rendering pipeline.
 *
 * This class owns only:
 * - opening `v2/model`
 * - projecting to `FlowBlock[]`
 * - measuring, paginating, and painting
 * - a tiny compatibility surface for SuperDoc (`setZoom`, `setDocumentMode`, etc.)
 *
 * It intentionally does not implement editing, selections, or PM integration.
 */
export class V2StaticRenderHost extends EventEmitter {
  readonly element: HTMLElement;
  readonly options: { documentId?: string };

  #runtime = new V2DocumentRuntime();
  #editingController: V2EditingController | null = null;
  #unbindEditingController: (() => void) | null = null;
  #projectionSnapshot: V2ProjectionSnapshot = { blockToEntityRef: new Map() };
  #editingSnapshot: V2EditingSnapshot = {
    blockToEntityRef: new Map(),
    paragraphsByBlockId: new Map(),
    orderedParagraphs: [],
  };
  #viewportHost: HTMLDivElement;
  #painterHost: HTMLDivElement;
  #domPainter: ReturnType<typeof createDomPainter> | null = null;
  #layoutEngineOptions: LayoutEngineOptions;
  #documentMode: DocumentMode;
  #disableContextMenu: boolean;
  #trackedChangesOverrides: TrackedChangesOverrides | undefined;
  #layoutSnapshot: V2StaticLayoutSnapshot = {
    blocks: [],
    measures: [],
    layout: null,
  };
  #resizeObserver: ResizeObserver | null = null;
  #lastSemanticContainerWidth: number | null = null;
  #resizeTimeoutId: number | null = null;

  constructor(options: V2StaticRenderHostOptions) {
    super();

    this.element = options.element;
    this.options = { documentId: options.documentId };
    this.#layoutEngineOptions = normalizeLayoutEngineOptions(options.layoutEngineOptions);
    this.#documentMode = options.documentMode ?? 'editing';
    this.#disableContextMenu = Boolean(options.disableContextMenu);

    this.#viewportHost = document.createElement('div');
    this.#viewportHost.className = 'presentation-editor__viewport v2-static-renderer__viewport';
    this.#viewportHost.setAttribute('aria-hidden', 'true');

    this.#painterHost = document.createElement('div');
    this.#painterHost.className = 'presentation-editor__pages v2-static-renderer__pages';

    this.#viewportHost.appendChild(this.#painterHost);
    this.element.replaceChildren(this.#viewportHost);

    applyHostStyles(
      this.element,
      this.#viewportHost,
      this.#painterHost,
      this.#layoutEngineOptions.pageSize?.h ?? DEFAULT_PAGE_SIZE.h,
    );
    this.#installResizeObserver();
  }

  async load(source: V2DocumentSource): Promise<void> {
    const controller = this.#editingController;
    if (controller) {
      await this.#runtime.close();
      await controller.initialize(source);
    } else {
      await this.#runtime.initialize(source);
    }
    await this.render();
  }

  async render(): Promise<void> {
    const endRender = v2PerfTimeline.startSpan(SPAN_RENDER);
    try {
      const runtime = this.#getRenderRuntime();
      const semanticModel = runtime.semanticModel;
      if (!semanticModel) {
        throw new Error('Cannot render before the semantic model is initialized');
      }

      // Phase 1: Projection (instrumented inside projectToFlowBlocks)
      const projection = projectToFlowBlocks(semanticModel, {
        resolver: runtime.styleResolver,
      });
      this.#projectionSnapshot = { blockToEntityRef: projection.blockToEntityRef };
      const layoutBlocks = toContractBlocks(projection.blocks);
      this.#editingSnapshot = buildEditableDocumentSnapshot(semanticModel, projection.blockToEntityRef);
      if (isEditableDocumentMode(this.#documentMode)) {
        applyEditableInteractionData(layoutBlocks, this.#editingSnapshot);
      }
      const layoutOptions = this.#resolveLayoutInput(semanticModel);
      const previousSnapshot = this.#layoutSnapshot;

      // Phase 2+3: Measurement and pagination (via incrementalLayout)
      const { result } = await runInstrumentedIncrementalLayout({
        previousBlocks: previousSnapshot.blocks,
        previousLayout: previousSnapshot.layout,
        nextBlocks: layoutBlocks,
        layoutOptions,
        measureBlock: (block: FlowBlock, constraints: { maxWidth: number; maxHeight: number }) =>
          measureBlock(block, constraints),
        previousMeasures: previousSnapshot.measures,
      });

      result.layout.pageGap = getEffectivePageGap(this.#layoutEngineOptions);

      // Phase 4: Paint
      const endPaint = v2PerfTimeline.startSpan(SPAN_PAINT);
      try {
        const painter = this.#ensurePainter(layoutBlocks, result.measures);
        painter.setData?.(layoutBlocks, result.measures);
        painter.paint(result.layout, this.#painterHost);
        this.#applyInteractionMetadata(semanticModel);
      } finally {
        endPaint();
      }

      v2PerfTimeline.mark(PAINT_FIRST_PAGE_MOUNTED);
      v2PerfTimeline.gauge(LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT, countMountedPages(this.#painterHost));

      this.#layoutSnapshot = {
        blocks: layoutBlocks,
        measures: result.measures,
        layout: result.layout,
      };

      this.#applyZoom();

      const payload: V2StaticLayoutPayload = {
        blocks: layoutBlocks,
        measures: result.measures,
        layout: result.layout,
      };
      this.emit('layoutUpdated', payload);
      this.emit('paginationUpdate', payload);
    } finally {
      endRender();
    }
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

    if (this.#getRenderRuntime().isActive()) {
      void this.render().catch((error) => this.#emitLayoutError(error));
    }
  }

  getSemanticModel(): PresentationV2SemanticModel | null {
    return this.#getRenderRuntime().semanticModel;
  }

  getSemanticJson(): PresentationV2SemanticDocument | undefined {
    return this.#getRenderRuntime().semanticJson;
  }

  getSemanticDocumentApiAdapter(): PresentationV2DocumentApiAdapter | undefined {
    return this.#getRenderRuntime().documentApiAdapter;
  }

  getLayoutSnapshot(): V2StaticLayoutSnapshot {
    return {
      blocks: [...this.#layoutSnapshot.blocks],
      measures: [...this.#layoutSnapshot.measures],
      layout: this.#layoutSnapshot.layout,
    };
  }

  getPages(): Layout['pages'] {
    return this.#layoutSnapshot.layout?.pages ?? [];
  }

  /** Get the latest projection metadata for targeting. */
  getProjectionSnapshot(): V2ProjectionSnapshot {
    return this.#projectionSnapshot;
  }

  getEditingSnapshot(): V2EditingSnapshot {
    return this.#editingSnapshot;
  }

  // ---- Editing integration --------------------------------------------------

  /**
   * Bind an editing controller to this host.
   *
   * When bound, the host automatically rerenders after every successful
   * mutation. The host does not own the controller — the caller retains
   * ownership and lifecycle responsibility.
   */
  bindEditingController(controller: V2EditingController): () => void {
    this.#unbindEditingController?.();
    this.#editingController = controller;

    const unsubscribe = controller.on('changed', () => {
      void this.render().catch((error) => this.#emitLayoutError(error));
    });

    this.#unbindEditingController = () => {
      unsubscribe();
      if (this.#editingController === controller) {
        this.#editingController = null;
      }
      if (this.#unbindEditingController) {
        this.#unbindEditingController = null;
      }
    };

    if (controller.isActive()) {
      void this.#runtime.close().catch(() => {});
      void this.render().catch((error) => this.#emitLayoutError(error));
    }

    return this.#unbindEditingController;
  }

  /** The currently bound editing controller, if any. */
  get editingController(): V2EditingController | null {
    return this.#editingController;
  }

  /**
   * Apply a semantic operation through the bound editing controller.
   * Convenience method — throws if no controller is bound.
   */
  async applyOperation(op: SemanticOperation): Promise<SemanticOperationResult> {
    return this.#requireController().applyOperation(op);
  }

  /**
   * Execute a document-api operation through the bound editing controller.
   * Convenience method — throws if no controller is bound.
   */
  async invoke(operationKey: string, args: Record<string, unknown>): Promise<InvokeResult> {
    return this.#requireController().invoke(operationKey, args);
  }

  /** Undo through the bound editing controller. */
  async undo(): Promise<SemanticOperationResult | NoopResult> {
    return this.#requireController().undo();
  }

  /** Redo through the bound editing controller. */
  async redo(): Promise<SemanticOperationResult | NoopResult> {
    return this.#requireController().redo();
  }

  /** Save through the bound editing controller. */
  async save(options?: SaveOptions): Promise<SaveResult> {
    return this.#requireController().save(options);
  }

  #requireController(): V2EditingController {
    if (!this.#editingController) {
      throw new Error('[V2StaticRenderHost] No editing controller bound — call bindEditingController() first');
    }
    return this.#editingController;
  }

  onLayoutUpdated(handler: (payload: V2StaticLayoutPayload) => void): () => void {
    this.on('layoutUpdated', handler);
    return () => this.off('layoutUpdated', handler);
  }

  onLayoutError(
    handler: (error: { phase: 'initialization' | 'render'; error: Error; timestamp: number }) => void,
  ): () => void {
    this.on('layoutError', handler);
    return () => this.off('layoutError', handler);
  }

  setZoom(zoom: number): void {
    validateZoom(zoom);

    this.#layoutEngineOptions.zoom = zoom;
    this.#applyZoom();
    this.#domPainter?.setZoom?.(zoom);
    this.emit('zoomChange', { zoom });

    if (isSemanticFlow(this.#layoutEngineOptions) && this.#getRenderRuntime().isActive()) {
      void this.render().catch((error) => this.#emitLayoutError(error));
    }
  }

  setDocumentMode(mode: DocumentMode): void {
    this.#documentMode = mode;
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

  destroy(): void {
    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }

    if (this.#resizeTimeoutId !== null) {
      window.clearTimeout(this.#resizeTimeoutId);
      this.#resizeTimeoutId = null;
    }

    this.#domPainter = null;
    this.#unbindEditingController?.();
    this.#editingController = null;
    this.element.replaceChildren();
    void this.#runtime.close();
    this.emit('destroy');
    this.removeAllListeners();
  }

  #ensurePainter(blocks: FlowBlock[], measures: Measure[]): ReturnType<typeof createDomPainter> {
    const effectivePageGap = getEffectivePageGap(this.#layoutEngineOptions);
    const normalizedVirtualization = this.#layoutEngineOptions.virtualization?.enabled
      ? {
          ...this.#layoutEngineOptions.virtualization,
          gap: this.#layoutEngineOptions.virtualization.gap ?? effectivePageGap,
        }
      : this.#layoutEngineOptions.virtualization;

    if (!this.#domPainter) {
      this.#domPainter = createDomPainter({
        blocks,
        measures,
        layoutMode: this.#layoutEngineOptions.layoutMode ?? DEFAULT_LAYOUT_MODE,
        flowMode: this.#layoutEngineOptions.flowMode ?? DEFAULT_FLOW_MODE,
        pageGap: effectivePageGap,
        virtualization: normalizedVirtualization,
      });
      this.#domPainter.setScrollContainer?.(this.element);
      this.#domPainter.setZoom?.(this.#layoutEngineOptions.zoom ?? 1);
      return this.#domPainter;
    }

    this.#domPainter.setData?.(blocks, measures);
    return this.#domPainter;
  }

  #getRenderRuntime(): V2DocumentRuntime {
    return this.#editingController?.isActive() ? this.#editingController.runtime : this.#runtime;
  }

  #applyInteractionMetadata(semanticModel: PresentationV2SemanticModel): void {
    const blockElements = Array.from(this.#painterHost.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}]`));
    for (const element of blockElements) {
      const blockId = element.dataset[DATASET_KEYS.BLOCK_ID];
      if (!blockId) continue;

      const entityRef = this.#projectionSnapshot.blockToEntityRef.get(blockId);
      if (!entityRef) {
        element.removeAttribute(DATA_ATTRS.SD_ENTITY_REF);
        element.removeAttribute(DATA_ATTRS.SD_STORY_ID);
        element.removeAttribute(DATA_ATTRS.SD_INTERACTION_KIND);
        continue;
      }

      const entity = semanticModel.entity(entityRef);
      if (!entity) continue;

      element.setAttribute(DATA_ATTRS.SD_ENTITY_REF, entityRef.id);
      const editableParagraph = this.#editingSnapshot.paragraphsByBlockId.get(blockId);
      element.setAttribute(
        DATA_ATTRS.SD_INTERACTION_KIND,
        editableParagraph?.supported ? 'text' : classifyInteractionKind(entity.kind),
      );

      const storyId = findStoryIdForEntity(semanticModel, entityRef);
      if (storyId) {
        element.setAttribute(DATA_ATTRS.SD_STORY_ID, storyId);
      } else {
        element.removeAttribute(DATA_ATTRS.SD_STORY_ID);
      }
    }
  }

  #resolveLayoutInput(semanticModel: PresentationV2SemanticModel): ResolvedLayoutInput {
    const firstSection = semanticModel.sections()[0];
    const firstSectionRaw = firstSection?.raw();
    const flowMode = this.#layoutEngineOptions.flowMode ?? DEFAULT_FLOW_MODE;

    const pageSize = {
      w:
        normalizeSectionTwips(firstSectionRaw?.pageWidth) ??
        this.#layoutEngineOptions.pageSize?.w ??
        DEFAULT_PAGE_SIZE.w,
      h:
        normalizeSectionTwips(firstSectionRaw?.pageHeight) ??
        this.#layoutEngineOptions.pageSize?.h ??
        DEFAULT_PAGE_SIZE.h,
    };

    const margins = {
      top:
        normalizeSectionTwips(firstSectionRaw?.marginTop) ??
        this.#layoutEngineOptions.margins?.top ??
        DEFAULT_MARGINS.top,
      right:
        normalizeSectionTwips(firstSectionRaw?.marginRight) ??
        this.#layoutEngineOptions.margins?.right ??
        DEFAULT_MARGINS.right,
      bottom:
        normalizeSectionTwips(firstSectionRaw?.marginBottom) ??
        this.#layoutEngineOptions.margins?.bottom ??
        DEFAULT_MARGINS.bottom,
      left:
        normalizeSectionTwips(firstSectionRaw?.marginLeft) ??
        this.#layoutEngineOptions.margins?.left ??
        DEFAULT_MARGINS.left,
      ...(this.#layoutEngineOptions.margins?.header != null
        ? { header: this.#layoutEngineOptions.margins.header }
        : {}),
      ...(this.#layoutEngineOptions.margins?.footer != null
        ? { footer: this.#layoutEngineOptions.margins.footer }
        : {}),
    };

    const columns =
      firstSectionRaw?.cols && firstSectionRaw.cols > 1
        ? { count: firstSectionRaw.cols, gap: normalizeSectionTwips(720)! }
        : undefined;

    if (flowMode === 'semantic') {
      const semanticMargins = resolveSemanticMargins(margins);
      const containerWidth = resolveSemanticContainerWidth(this.element);
      const semanticContentWidth = Math.max(
        MIN_SEMANTIC_CONTENT_WIDTH_PX,
        containerWidth - semanticMargins.left - semanticMargins.right,
      );

      this.#lastSemanticContainerWidth = containerWidth;

      return {
        flowMode: 'semantic',
        pageSize: { w: semanticContentWidth + semanticMargins.left + semanticMargins.right, h: pageSize.h },
        margins: {
          ...margins,
          top: semanticMargins.top,
          right: semanticMargins.right,
          bottom: semanticMargins.bottom,
          left: semanticMargins.left,
        },
        columns: { count: 1, gap: 0 },
        semantic: {
          contentWidth: semanticContentWidth,
          marginLeft: semanticMargins.left,
          marginRight: semanticMargins.right,
          marginTop: semanticMargins.top,
          marginBottom: semanticMargins.bottom,
        },
        sectionMetadata: [],
      };
    }

    return {
      flowMode: 'paginated',
      pageSize,
      margins,
      ...(columns ? { columns } : {}),
      sectionMetadata: [],
    };
  }

  #applyZoom(): void {
    const layout = this.#layoutSnapshot.layout;
    const zoom = this.#layoutEngineOptions.zoom ?? 1;

    if (isSemanticFlow(this.#layoutEngineOptions)) {
      this.#viewportHost.style.minWidth = '';
      this.#viewportHost.style.minHeight = '';

      if (zoom === 1) {
        this.#viewportHost.style.width = '100%';
        this.#viewportHost.style.transform = '';
        this.#painterHost.style.width = '100%';
        this.#painterHost.style.transformOrigin = '';
        this.#painterHost.style.transform = '';
        return;
      }

      this.#viewportHost.style.width = `${100 / zoom}%`;
      this.#viewportHost.style.transform = '';
      this.#painterHost.style.width = '100%';
      this.#painterHost.style.transformOrigin = 'top left';
      this.#painterHost.style.transform = `scale(${zoom})`;
      return;
    }

    const pages = layout?.pages ?? [];
    const fallbackPageSize = resolveFallbackPageSize(layout?.pageSize, this.#layoutEngineOptions.pageSize);
    const layoutMode = this.#layoutEngineOptions.layoutMode ?? DEFAULT_LAYOUT_MODE;
    const pageGap = getEffectivePageGap(this.#layoutEngineOptions);

    let maxWidth = fallbackPageSize.w;
    let maxHeight = fallbackPageSize.h;
    let totalWidth = 0;
    let totalHeight = 0;

    if (pages.length > 0) {
      pages.forEach((page, index) => {
        const pageSize = resolveFallbackPageSize(page.size, fallbackPageSize);
        const pageWidth = pageSize.w;
        const pageHeight = pageSize.h;

        maxWidth = Math.max(maxWidth, pageWidth);
        maxHeight = Math.max(maxHeight, pageHeight);

        if (layoutMode === 'horizontal') {
          totalWidth += pageWidth;
          if (index > 0) totalWidth += pageGap;
        } else {
          totalHeight += pageHeight;
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

  #installResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.#resizeObserver = new ResizeObserver(() => {
      if (!isSemanticFlow(this.#layoutEngineOptions) || !this.#runtime.isActive()) {
        return;
      }

      const nextWidth = resolveSemanticContainerWidth(this.element);
      if (nextWidth === this.#lastSemanticContainerWidth) {
        return;
      }

      this.#lastSemanticContainerWidth = nextWidth;
      if (this.#resizeTimeoutId !== null) {
        window.clearTimeout(this.#resizeTimeoutId);
      }

      this.#resizeTimeoutId = window.setTimeout(() => {
        this.#resizeTimeoutId = null;
        void this.render().catch((error) => this.#emitLayoutError(error));
      }, RESIZE_RERENDER_DEBOUNCE_MS);
    });

    this.#resizeObserver.observe(this.element);
  }

  #emitLayoutError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.emit('layoutError', {
      phase: this.#runtime.isActive() ? 'render' : 'initialization',
      error: normalized,
      timestamp: Date.now(),
    });
  }
}

function resolveFallbackPageSize(
  primary: { w?: number; h?: number } | undefined | null,
  fallback: { w?: number; h?: number } | undefined | null,
): { w: number; h: number } {
  return {
    w: resolvePositiveDimension(primary?.w, fallback?.w, DEFAULT_PAGE_SIZE.w),
    h: resolvePositiveDimension(primary?.h, fallback?.h, DEFAULT_PAGE_SIZE.h),
  };
}

function resolvePositiveDimension(
  primary: number | undefined,
  fallback: number | undefined,
  defaultValue: number,
): number {
  if (typeof primary === 'number' && primary > 0) {
    return primary;
  }

  if (typeof fallback === 'number' && fallback > 0) {
    return fallback;
  }

  return defaultValue;
}

function normalizeLayoutEngineOptions(options?: LayoutEngineOptions): LayoutEngineOptions {
  const requestedFlowMode = options?.flowMode === 'semantic' ? 'semantic' : DEFAULT_FLOW_MODE;
  const requestedLayoutMode = options?.layoutMode ?? DEFAULT_LAYOUT_MODE;

  return {
    pageSize: options?.pageSize ?? DEFAULT_PAGE_SIZE,
    margins: options?.margins ?? DEFAULT_MARGINS,
    zoom: options?.zoom ?? 1,
    layoutMode: requestedFlowMode === 'semantic' ? 'vertical' : requestedLayoutMode,
    flowMode: requestedFlowMode,
    virtualization: normalizeVirtualizationOptions(options?.virtualization, requestedFlowMode),
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

function normalizeVirtualizationOptions(
  virtualization: LayoutEngineOptions['virtualization'],
  flowMode: LayoutEngineOptions['flowMode'],
): LayoutEngineOptions['virtualization'] {
  if (flowMode === 'semantic') {
    return {
      ...(virtualization ?? {}),
      enabled: false,
    };
  }

  if (!virtualization) {
    return {
      enabled: false,
    };
  }

  return virtualization;
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
  if (isSemanticFlow(options)) {
    return 0;
  }
  if (options.virtualization?.enabled) {
    return Math.max(0, options.virtualization.gap ?? DEFAULT_PAGE_GAP);
  }
  if (options.layoutMode === 'horizontal') {
    return DEFAULT_HORIZONTAL_PAGE_GAP;
  }
  return DEFAULT_PAGE_GAP;
}

function isSemanticFlow(options: LayoutEngineOptions): boolean {
  return options.flowMode === 'semantic';
}

function validateZoom(zoom: number): void {
  if (typeof zoom !== 'number') {
    throw new TypeError(`[V2StaticRenderHost] setZoom expects a number, received ${typeof zoom}`);
  }
  if (Number.isNaN(zoom)) {
    throw new RangeError('[V2StaticRenderHost] setZoom expects a valid number (not NaN)');
  }
  if (!Number.isFinite(zoom)) {
    throw new RangeError('[V2StaticRenderHost] setZoom expects a finite number');
  }
  if (zoom <= 0) {
    throw new RangeError('[V2StaticRenderHost] setZoom expects a positive number greater than 0');
  }
}

function resolveSemanticMargins(margins: { top: number; right: number; bottom: number; left: number }): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  return {
    top: margins.top,
    right: margins.right,
    bottom: margins.bottom,
    left: margins.left,
  };
}

function resolveSemanticContainerWidth(element: HTMLElement): number {
  const width = element.clientWidth;
  return Number.isFinite(width) && width > 0 ? width : DEFAULT_PAGE_SIZE.w;
}

function normalizeSectionTwips(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return (value / TWIPS_PER_INCH) * PX_PER_INCH;
}

function countMountedPages(container: ParentNode): number {
  return container.querySelectorAll('.superdoc-page').length;
}

function classifyInteractionKind(entityKind: string): string {
  switch (entityKind) {
    case 'paragraph':
      return 'paragraph';
    case 'table':
      return 'table';
    case 'drawing':
      return 'image';
    default:
      return 'other';
  }
}

function isEditableDocumentMode(mode: DocumentMode): boolean {
  return mode !== 'viewing';
}

function findStoryIdForEntity(semanticModel: PresentationV2SemanticModel, entityRef: EntityRef): string | undefined {
  let current = semanticModel.entity(entityRef);
  while (current) {
    if (isStoryKind(current.kind)) {
      return current.ref.id;
    }
    current = current.parentRef ? semanticModel.entity(current.parentRef) : undefined;
  }
  return undefined;
}

function isStoryKind(kind: string): boolean {
  return (
    kind === 'mainStory' ||
    kind === 'headerStory' ||
    kind === 'footerStory' ||
    kind === 'footnoteStory' ||
    kind === 'endnoteStory' ||
    kind === 'commentStory' ||
    kind === 'textboxStory'
  );
}

function toContractBlocks(
  blocks: ReadonlyArray<ReturnType<typeof projectToFlowBlocks>['blocks'][number]>,
): FlowBlock[] {
  return blocks as unknown as FlowBlock[];
}
