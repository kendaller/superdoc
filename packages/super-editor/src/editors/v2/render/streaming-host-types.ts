import type { FlowBlock, Layout, Measure, SectionMetadata } from '@superdoc/contracts';
import type { DependencyManifest, SectionMetadataDelta } from '@superdoc/v2-model';

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
