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
