import type { FlowBlock, Layout, Measure, SectionMetadata } from '@superdoc/contracts';
import type { DependencyManifest, SectionMetadataDelta } from '@superdoc/v2-model';
import type { V2EditableDocumentSnapshot } from '../editing/V2EditableDocumentSnapshot.js';

// ---- State machine -----------------------------------------------------------

export type HostState =
  | 'idle'
  | 'opening'
  | 'renderShellReady'
  | 'firstWindowProjected'
  | 'firstPaintComplete'
  | 'streaming'
  | 'enriching'
  | 'complete'
  | 'degraded'
  | 'failed';

export type StateTransitionEntry = {
  state: HostState;
  timestamp: number;
};

export type StateChangeEvent = {
  previous: HostState;
  current: HostState;
  timestamp: number;
  /** Present when current === 'degraded'. */
  degradedInfo?: DegradedInfo;
};

// ---- Loading overlay -------------------------------------------------------

export type LoadingOverlayTexts = {
  title: string;
  openingMessage: string;
  preparingMessage: string;
  almostReadyMessage: string;
};

export type LoadingOverlayState = {
  visible: boolean;
  title: string;
  message: string;
  progressPercent: number;
};

// ---- Degraded mode policy ----------------------------------------------------

export type DegradedReason =
  | 'append-stalled'
  | 'enrichment-unavailable'
  | 'worker-error'
  | 'memory-pressure'
  | 'partial-render';

export type DegradedInfo = {
  reason: DegradedReason;
  message: string;
  timestamp: number;
  /** Whether recovery is possible without reloading. */
  recoverable: boolean;
};

// ---- Memory policy -----------------------------------------------------------

export type MemoryPolicy = {
  /** Max pages to keep in DOM. Default: 200. */
  maxMountedPages: number;
  /** Max blocks to keep in accumulated state. Default: 5000. */
  maxAccumulatedBlocks: number;
  /** Max heap MB before emitting a warning. null = no limit. */
  heapWarningMb: number | null;
  /** Max heap MB before forcing eviction. null = no limit. */
  heapCeilingMb: number | null;
};

export type WindowEvictionRecord = {
  windowIndex: number;
  evictedAt: number;
  blockRange: [startIdx: number, endIdx: number];
};

// ---- Window tracking ---------------------------------------------------------

export type WindowRecord = {
  index: number;
  startBodyChildIndex: number;
  bodyChildCount: number;
  blockCount: number;
  blocks: FlowBlock[];
  blockIds: string[];
  sectionMetadataDelta: SectionMetadataDelta;
  dependencyManifest?: DependencyManifest;
  projectionMode: 'preview' | 'exact';
  status: 'projected' | 'measured' | 'laid-out' | 'failed';
};

// ---- Accumulated layout state ------------------------------------------------

export type AccumulatedState = {
  blocks: FlowBlock[];
  measures: Measure[];
  layout: Layout | null;
  windowRecords: WindowRecord[];
  blockToSourceRef: ReadonlyMap<string, { partUri: string; nodeId: string; sourceNodePath?: string }>;
  editingSnapshot: V2EditableDocumentSnapshot;
  nextBodyChildIndex: number;
  totalBodyChildCount: number;
  sectionMetadata: SectionMetadata[];
  dependencyManifest: DependencyManifest;
};

// ---- Page completeness -------------------------------------------------------

export type PageCompleteness = {
  bodyComplete: boolean;
  headerFooterComplete: boolean;
  notesComplete: boolean;
  imagesComplete: boolean;
  commentsComplete: boolean;
  /** Derived: all fields are true. */
  isFullyComplete: boolean;
  /** Derived: body is complete but some enrichment remains. */
  hasDeferredDependencies: boolean;
};

// ---- Layout snapshot / payload -----------------------------------------------

export type V2StreamingLayoutSnapshot = {
  blocks: FlowBlock[];
  measures: Measure[];
  layout: Layout | null;
  isStreaming: boolean;
};

export type V2StreamingLayoutPayload = {
  blocks: FlowBlock[];
  measures: Measure[];
  layout: Layout;
};

// ---- Editing surface diagnostics ---------------------------------------------

export type V2EditingSnapshotSource = 'none' | 'blockIds' | 'sourceRefs' | 'merged';

export type V2EditingBootstrapPhase =
  | 'idle'
  | 'awaiting-controller'
  | 'preparing-snapshot'
  | 'repainting'
  | 'ready'
  | 'blocked'
  | 'failed';

export type V2EditingHistogramEntry = {
  readonly reason: string;
  readonly count: number;
};

export type V2EditingSurfaceStatus = {
  ready: boolean;
  bootstrapPhase: V2EditingBootstrapPhase;
  bootstrapIssue: string | null;
  snapshotSource: V2EditingSnapshotSource;
  renderedParagraphCount: number;
  renderedEditableParagraphCount: number;
  renderedEmptyEditableParagraphCount: number;
  domSegmentCount: number;
  snapshotParagraphCount: number;
  supportedParagraphCount: number;
  emptyEditableParagraphCount: number;
  blockIdParagraphCount: number;
  blockIdSupportedParagraphCount: number;
  sourceRefParagraphCount: number;
  sourceRefSupportedParagraphCount: number;
  blockIdOnlySupportedParagraphCount: number;
  sourceRefOnlySupportedParagraphCount: number;
  missingRenderedBlockIdCount: number;
  paragraphsWithoutDomSegmentsCount: number;
  unsupportedParagraphHistogram: readonly V2EditingHistogramEntry[];
  missingRenderedBlockIds: readonly string[];
  paragraphsWithoutDomSegments: readonly string[];
};
