// ---------------------------------------------------------------------------
// Metric vocabulary — typed constants matching the plan's locked names.
//
// These string constants are the single source of truth for metric names
// across all instrumented modules. Using these instead of raw strings
// prevents typos and enables rename-safe refactoring.
// ---------------------------------------------------------------------------

// ---- Source / Open ---------------------------------------------------------

export const OPEN_START = 'open.start' as const;
export const OPEN_FAST_OPEN_COMPLETE = 'open.fastOpenComplete' as const;
export const OPEN_FIRST_PAINT_SHELL_READY = 'open.firstPaintShellReady' as const;
export const OPEN_RENDER_SHELL_READY = 'open.renderShellReady' as const;
export const OPEN_STRUCTURE_READY = 'open.structureReady' as const;
export const OPEN_BYTES_READ_BEFORE_FIRST_PAINT = 'open.bytesReadBeforeFirstPaint' as const;
export const OPEN_XML_PARTS_MATERIALIZED_BEFORE_FIRST_PAINT = 'open.xmlPartsMaterializedBeforeFirstPaint' as const;

// ---- Projection ------------------------------------------------------------

export const PROJECTION_FIRST_WINDOW_START = 'projection.firstWindowStart' as const;
export const PROJECTION_FIRST_WINDOW_COMPLETE = 'projection.firstWindowComplete' as const;
export const PROJECTION_BLOCKS_PROJECTED_BEFORE_FIRST_PAINT = 'projection.blocksProjectedBeforeFirstPaint' as const;
export const PROJECTION_APPEND_WINDOW_COUNT = 'projection.appendWindowCount' as const;
export const PROJECTION_FIELD_HEAVY_PARAGRAPHS = 'projection.fieldHeavyParagraphsClassified' as const;
export const PROJECTION_PLAIN_PARAGRAPHS = 'projection.plainParagraphsClassified' as const;
export const PROJECTION_COMPLEX_PARAGRAPHS = 'projection.complexParagraphsClassified' as const;
export const PROJECTION_RUNS_SKIPPED_BY_FAST_PATH = 'projection.runsSkippedByFieldFastPath' as const;

// ---- Layout ----------------------------------------------------------------

export const LAYOUT_FIRST_MEASURE_START = 'layout.firstMeasureStart' as const;
export const LAYOUT_FIRST_MEASURE_COMPLETE = 'layout.firstMeasureComplete' as const;
export const LAYOUT_FIRST_PAGINATION_COMPLETE = 'layout.firstPaginationComplete' as const;
export const LAYOUT_BLOCKS_MEASURED_BEFORE_FIRST_PAINT = 'layout.blocksMeasuredBeforeFirstPaint' as const;
export const LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT = 'layout.pagesMountedAtFirstPaint' as const;

// ---- Paint -----------------------------------------------------------------

export const PAINT_FIRST_PAGE_MOUNTED = 'paint.firstPageMounted' as const;
export const PAINT_FIRST_VISIBLE_PAGE_STABLE = 'paint.firstVisiblePageStable' as const;
export const PAINT_FULL_VISIBLE_VIEWPORT_MOUNTED = 'paint.fullVisibleViewportMounted' as const;

// ---- Enrichment ------------------------------------------------------------

export const ENRICHMENT_COMMENTS_READY = 'enrichment.commentsReady' as const;
export const ENRICHMENT_HEADER_FOOTER_READY = 'enrichment.headerFooterReady' as const;
export const ENRICHMENT_NOTES_READY = 'enrichment.notesReady' as const;
export const ENRICHMENT_STRUCTURE_READY = 'enrichment.structureReady' as const;

// ---- Runtime ---------------------------------------------------------------

export const RUNTIME_MAIN_THREAD_LONG_TASKS_BEFORE_FIRST_PAINT = 'runtime.mainThreadLongTasksBeforeFirstPaint' as const;
export const RUNTIME_MAIN_THREAD_BLOCKED_MS_BEFORE_FIRST_PAINT = 'runtime.mainThreadBlockedMsBeforeFirstPaint' as const;
export const RUNTIME_WORKER_BUSY_MS_BEFORE_FIRST_PAINT = 'runtime.workerBusyMsBeforeFirstPaint' as const;
export const RUNTIME_PEAK_MEMORY_MB = 'runtime.peakMemoryMb' as const;
export const RUNTIME_MEMORY_AT_FIRST_PAINT_MB = 'runtime.memoryAtFirstPaintMb' as const;

// ---- Worker task scheduler --------------------------------------------------

export const RUNTIME_TASK_QUEUE_DEPTH = 'runtime.taskQueueDepth' as const;
export const RUNTIME_TASK_PREEMPTIONS = 'runtime.taskPreemptions' as const;
export const RUNTIME_TASK_CANCELLATIONS = 'runtime.taskCancellations' as const;

// ---- Span names (durations, not instants) ----------------------------------

export const SPAN_OPEN = 'open' as const;
export const SPAN_FAST_OPEN = 'open.fastOpen' as const;
export const SPAN_MATERIALIZE_XML = 'open.materializeXml' as const;
export const SPAN_ADVANCE_TO_FIRST_PAINT_SHELL = 'open.advanceToFirstPaintShell' as const;
export const SPAN_ADVANCE_TO_RENDER_SHELL = 'open.advanceToRenderShell' as const;
export const SPAN_ADVANCE_TO_STRUCTURE = 'open.advanceToStructure' as const;
export const SPAN_INDEX_XML_PARTS = 'open.indexXmlParts' as const;
export const SPAN_PROJECTION = 'projection' as const;
export const SPAN_STYLE_RESOLUTION = 'projection.styleResolution' as const;
export const SPAN_MEASUREMENT = 'layout.measurement' as const;
export const SPAN_PAGINATION = 'layout.pagination' as const;
export const SPAN_PAINT = 'paint' as const;
export const SPAN_RENDER = 'render' as const;
export const SPAN_RUNTIME_INIT = 'runtime.initialize' as const;
export const SPAN_WORKER_OPEN_SOURCE = 'runtime.worker.openSource' as const;
export const SPAN_WORKER_RENDER_SHELL = 'runtime.worker.getRenderShell' as const;
export const SPAN_WORKER_PROJECT_WINDOW = 'runtime.worker.projectWindow' as const;

// ---- Streaming host --------------------------------------------------------

export const SPAN_STREAMING_APPEND = 'streaming.append' as const;
export const SPAN_STREAMING_APPEND_PROJECTION = 'streaming.append.projection' as const;
export const SPAN_STREAMING_APPEND_LAYOUT = 'streaming.append.layout' as const;
export const SPAN_STREAMING_APPEND_PAINT = 'streaming.append.paint' as const;
export const SPAN_STREAMING_TOTAL = 'streaming.total' as const;
export const STREAMING_STATE_TRANSITION = 'streaming.stateTransition' as const;

// ---- Enterprise hardening ---------------------------------------------------

export const ENTERPRISE_WORKER_ERROR_COUNT = 'enterprise.workerErrorCount' as const;
export const ENTERPRISE_FALLBACK_COUNT = 'enterprise.fallbackCount' as const;
export const ENTERPRISE_CANCELLATION_COUNT = 'enterprise.cancellationCount' as const;
export const ENTERPRISE_MEMORY_WARNING_COUNT = 'enterprise.memoryWarningCount' as const;
export const ENTERPRISE_DEGRADED_COUNT = 'enterprise.degradedCount' as const;
export const ENTERPRISE_EVICTION_COUNT = 'enterprise.evictionCount' as const;
export const ENTERPRISE_RESOURCE_VIOLATION_COUNT = 'enterprise.resourceViolationCount' as const;

// ---- Aggregate type for all metric names -----------------------------------

export type OpenMetricName =
  | typeof OPEN_START
  | typeof OPEN_FAST_OPEN_COMPLETE
  | typeof OPEN_FIRST_PAINT_SHELL_READY
  | typeof OPEN_RENDER_SHELL_READY
  | typeof OPEN_STRUCTURE_READY;

export type OpenCountName =
  | typeof OPEN_BYTES_READ_BEFORE_FIRST_PAINT
  | typeof OPEN_XML_PARTS_MATERIALIZED_BEFORE_FIRST_PAINT;

export type ProjectionMetricName = typeof PROJECTION_FIRST_WINDOW_START | typeof PROJECTION_FIRST_WINDOW_COMPLETE;

export type ProjectionCountName =
  | typeof PROJECTION_BLOCKS_PROJECTED_BEFORE_FIRST_PAINT
  | typeof PROJECTION_APPEND_WINDOW_COUNT
  | typeof PROJECTION_FIELD_HEAVY_PARAGRAPHS
  | typeof PROJECTION_PLAIN_PARAGRAPHS
  | typeof PROJECTION_COMPLEX_PARAGRAPHS
  | typeof PROJECTION_RUNS_SKIPPED_BY_FAST_PATH;

export type LayoutMetricName =
  | typeof LAYOUT_FIRST_MEASURE_START
  | typeof LAYOUT_FIRST_MEASURE_COMPLETE
  | typeof LAYOUT_FIRST_PAGINATION_COMPLETE;

export type LayoutCountName =
  | typeof LAYOUT_BLOCKS_MEASURED_BEFORE_FIRST_PAINT
  | typeof LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT;

export type PaintMetricName =
  | typeof PAINT_FIRST_PAGE_MOUNTED
  | typeof PAINT_FIRST_VISIBLE_PAGE_STABLE
  | typeof PAINT_FULL_VISIBLE_VIEWPORT_MOUNTED;

export type RuntimeCountName =
  | typeof RUNTIME_MAIN_THREAD_LONG_TASKS_BEFORE_FIRST_PAINT
  | typeof RUNTIME_MAIN_THREAD_BLOCKED_MS_BEFORE_FIRST_PAINT
  | typeof RUNTIME_WORKER_BUSY_MS_BEFORE_FIRST_PAINT
  | typeof RUNTIME_PEAK_MEMORY_MB
  | typeof RUNTIME_MEMORY_AT_FIRST_PAINT_MB
  | typeof RUNTIME_TASK_QUEUE_DEPTH
  | typeof RUNTIME_TASK_PREEMPTIONS
  | typeof RUNTIME_TASK_CANCELLATIONS;

export type EnterpriseCountName =
  | typeof ENTERPRISE_WORKER_ERROR_COUNT
  | typeof ENTERPRISE_FALLBACK_COUNT
  | typeof ENTERPRISE_CANCELLATION_COUNT
  | typeof ENTERPRISE_MEMORY_WARNING_COUNT
  | typeof ENTERPRISE_DEGRADED_COUNT
  | typeof ENTERPRISE_EVICTION_COUNT
  | typeof ENTERPRISE_RESOURCE_VIOLATION_COUNT;

export type SpanName =
  | typeof SPAN_OPEN
  | typeof SPAN_FAST_OPEN
  | typeof SPAN_MATERIALIZE_XML
  | typeof SPAN_ADVANCE_TO_FIRST_PAINT_SHELL
  | typeof SPAN_ADVANCE_TO_RENDER_SHELL
  | typeof SPAN_ADVANCE_TO_STRUCTURE
  | typeof SPAN_INDEX_XML_PARTS
  | typeof SPAN_PROJECTION
  | typeof SPAN_STYLE_RESOLUTION
  | typeof SPAN_MEASUREMENT
  | typeof SPAN_PAGINATION
  | typeof SPAN_PAINT
  | typeof SPAN_RENDER
  | typeof SPAN_RUNTIME_INIT
  | typeof SPAN_WORKER_OPEN_SOURCE
  | typeof SPAN_WORKER_RENDER_SHELL
  | typeof SPAN_WORKER_PROJECT_WINDOW
  | typeof SPAN_STREAMING_APPEND
  | typeof SPAN_STREAMING_APPEND_PROJECTION
  | typeof SPAN_STREAMING_APPEND_LAYOUT
  | typeof SPAN_STREAMING_APPEND_PAINT
  | typeof SPAN_STREAMING_TOTAL;
