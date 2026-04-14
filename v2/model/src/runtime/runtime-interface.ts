// ---------------------------------------------------------------------------
// DocumentRuntime — shared interface for worker and in-process runtimes
//
// Both WorkerProxyV2 (browser) and InProcessRuntimeV2 (Node/CLI/tests)
// implement this interface. The streaming paginated host programs against
// DocumentRuntime, not against worker-specific types.
// ---------------------------------------------------------------------------

import type { ArchiveByteSource } from '../types/package.js';
import type { RenderShellSnapshot } from '../render-shell/index.js';
import type { ReadyStage, SaveOptions, SessionStatus } from '../types/session.js';
import type { WindowedProjectionResult } from '../projections/layout/index.js';
import type {
  TaskId,
  EnrichmentTarget,
  PrefetchWindowParams,
  ProjectPreviewWindowParams,
  ProjectWindowParams,
  WindowContinuation,
  WorkerEventV2,
} from './worker-protocol.js';
import type { EnrichmentResult } from '../enrichment/enrichment-results.js';
import type { EnrichmentRequest } from '../enrichment/enrichment-request.js';

export type RuntimeEventHandler = (event: WorkerEventV2) => void;

/**
 * Unified runtime interface for the v2 document pipeline.
 *
 * This is what the streaming paginated host (workstream 05) programs against.
 * Implementations:
 * - WorkerProxyV2: sends messages to a Web Worker
 * - InProcessRuntimeV2: calls session/projection functions directly
 */
export interface DocumentRuntime {
  // ---- Lifecycle ------------------------------------------------------------

  openSource(source: Uint8Array | Blob | ArchiveByteSource): Promise<{ sessionId: string }>;
  close(): Promise<void>;

  // ---- Render pipeline ------------------------------------------------------

  ready(stage: ReadyStage): Promise<void>;
  getRenderShell(): Promise<RenderShellSnapshot | undefined>;
  projectPreviewWindow(params: ProjectPreviewWindowParams): Promise<WindowedProjectionResult>;
  projectWindow(params: ProjectWindowParams): Promise<WindowedProjectionResult>;
  projectNextWindow(continuation: WindowContinuation): Promise<WindowedProjectionResult>;
  prefetchWindow(params: PrefetchWindowParams): Promise<void>;
  advanceRenderShell(): Promise<void>;
  advanceStructure(): Promise<void>;
  enrich(target: EnrichmentTarget, request?: EnrichmentRequest): Promise<EnrichmentResult>;

  // ---- Task control ---------------------------------------------------------

  cancelTask(taskId: TaskId): void;

  // ---- Status ---------------------------------------------------------------

  status(): Promise<SessionStatus>;
  save(options?: SaveOptions): Promise<Uint8Array>;

  // ---- Editing (Phase 4) ----------------------------------------------------

  /**
   * Apply a serialized semantic operation to the live document.
   * Returns the operation result with success/failure and revision.
   */
  applyOperation?(op: SerializableSemanticOperation): Promise<RuntimeMutationResult>;

  /**
   * Execute a document-api operation by key.
   * Translates and applies through the semantic operation pipeline.
   */
  invokeMutation?(operationKey: string, args: Record<string, unknown>): Promise<RuntimeMutationResult>;

  /** Undo the last operation. */
  undo?(): Promise<RuntimeMutationResult>;

  /** Redo the last undone operation. */
  redo?(): Promise<RuntimeMutationResult>;

  /** Get the current session revision. */
  getRevision?(): Promise<string | null>;

  // ---- Events ---------------------------------------------------------------

  on(event: string, handler: RuntimeEventHandler): () => void;
}

// ---- Editing types ----------------------------------------------------------

/**
 * JSON-serializable representation of a semantic operation.
 * Used for worker message transport — the worker deserializes and applies.
 */
export type SerializableSemanticOperation = {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly [key: string]: unknown;
};

/** Result of a runtime mutation (serializable for worker transport). */
export type RuntimeMutationResult = {
  readonly ok: boolean;
  readonly revision?: string;
  readonly error?: string;
  readonly noop?: boolean;
};
