// ---------------------------------------------------------------------------
// Worker RPC protocol types
//
// Defines the message shapes for communication between a main-thread
// proxy and a worker-hosted PackageSession.
//
// V1: Simple 5-method RPC (open, ready, status, save, close).
// V2: Task-based protocol with priority scheduling, cancellation, and
//     rich source transport (Blob, range-reader via MessagePort).
// ---------------------------------------------------------------------------

import type { ReadyStage, SaveOptions } from '../types/session.js';
import type { SerializableEnrichmentRequest } from '../enrichment/enrichment-request.js';

// ===== V1 Protocol (legacy, preserved for backward compatibility) ===========

// ---- Request messages -----------------------------------------------------

export type WorkerRequest =
  | { id: string; method: 'open'; params: { bytes: Uint8Array } }
  | { id: string; method: 'ready'; params: { stage?: ReadyStage } }
  | { id: string; method: 'status'; params?: undefined }
  | { id: string; method: 'save'; params: { options?: SaveOptions } }
  | { id: string; method: 'close'; params?: undefined };

// ---- Response messages ----------------------------------------------------

export type WorkerResponse = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string };

// ---- Event messages -------------------------------------------------------

export type WorkerEvent =
  | { event: 'diagnostic'; data: { code: string; message: string } }
  | { event: 'progress'; data: { stage: string; progress: number } }
  | { event: 'revision'; data: { revision: string } };

// ===== V2 Protocol ==========================================================

// ---- Identifiers -----------------------------------------------------------

export type TaskId = string;

export type TaskPriority = 'critical' | 'near-viewport' | 'background';

// ---- Source transport -------------------------------------------------------

/**
 * Describes how to reconstruct a document source inside the worker.
 *
 * - `memory`: Raw bytes transferred via ArrayBuffer.
 * - `blob`: Structured-cloneable Blob (preserves lazy loading).
 * - `range-proxy`: MessagePort channel back to the main-thread range reader.
 */
export type WorkerSourceDescriptor =
  | { kind: 'memory'; bytes: Uint8Array }
  | { kind: 'blob'; blob: Blob }
  | { kind: 'range-proxy'; port: MessagePort; size: number };

// ---- Enrichment targets -----------------------------------------------------

export type EnrichmentTarget = 'comments' | 'headers-footers' | 'footnotes' | 'endnotes' | 'images';

// ---- Projection parameters --------------------------------------------------

export type ProjectWindowParams = {
  startBodyChildIndex: number;
  maxBodyChildCount: number;
  stopAfterPageEstimate?: number;
  includeDependencyManifest?: boolean;
};

export type WindowContinuation = {
  nextBodyChildIndex: number;
  maxBodyChildCount: number;
};

// ---- V2 Request messages ----------------------------------------------------

export type WorkerRequestV2 =
  | {
      id: string;
      taskId: TaskId;
      method: 'openSource';
      params: { source: WorkerSourceDescriptor };
      priority: TaskPriority;
    }
  | { id: string; taskId: TaskId; method: 'ready'; params: { stage: ReadyStage }; priority: TaskPriority }
  | { id: string; taskId: TaskId; method: 'getRenderShell'; params: Record<string, never>; priority: TaskPriority }
  | { id: string; taskId: TaskId; method: 'projectWindow'; params: ProjectWindowParams; priority: TaskPriority }
  | {
      id: string;
      taskId: TaskId;
      method: 'projectNextWindow';
      params: { continuation: WindowContinuation };
      priority: TaskPriority;
    }
  | {
      id: string;
      taskId: TaskId;
      method: 'prefetchWindow';
      params: { startBodyChildIndex: number; maxBodyChildCount: number };
      priority: TaskPriority;
    }
  | { id: string; taskId: TaskId; method: 'advanceStructure'; params: Record<string, never>; priority: TaskPriority }
  | {
      id: string;
      taskId: TaskId;
      method: 'enrich';
      params: { target: EnrichmentTarget; request?: SerializableEnrichmentRequest };
      priority: TaskPriority;
    }
  | { id: string; taskId: TaskId; method: 'cancelTask'; params: { taskId: TaskId }; priority: TaskPriority }
  | { id: string; taskId: TaskId; method: 'status'; params: Record<string, never>; priority: TaskPriority }
  | { id: string; taskId: TaskId; method: 'save'; params: { options?: SaveOptions }; priority: TaskPriority }
  | { id: string; taskId: TaskId; method: 'close'; params: Record<string, never>; priority: TaskPriority };

// ---- V2 Response messages ---------------------------------------------------

export type WorkerResponseV2 =
  | { id: string; taskId: TaskId; ok: true; result: unknown }
  | { id: string; taskId: TaskId; ok: false; error: string; code?: string };

// ---- V2 Event messages ------------------------------------------------------

export type WorkerEventV2 =
  | { event: 'taskStarted'; taskId: TaskId; method: string; priority: TaskPriority }
  | { event: 'taskCompleted'; taskId: TaskId; method: string; durationMs: number }
  | { event: 'taskCancelled'; taskId: TaskId; method: string; reason: string }
  | { event: 'progress'; taskId: TaskId; stage: string; progress: number }
  | { event: 'diagnostic'; data: { code: string; message: string; severity: string } }
  | { event: 'revision'; data: { revision: string } }
  | { event: 'memory'; data: { heapUsedMb: number; heapTotalMb: number } };

// ---- Version-tagged envelope ------------------------------------------------

/**
 * All messages on the worker boundary are wrapped in a versioned envelope.
 * This allows v1 and v2 protocols to coexist during migration.
 */
export type WorkerMessageEnvelope =
  | { version: 1; payload: WorkerRequest | WorkerResponse }
  | { version: 2; payload: WorkerRequestV2 | WorkerResponseV2 | WorkerEventV2 };

// ---- Utility ----------------------------------------------------------------

let requestCounter = 0;

export function createRequestId(): string {
  return `req-${requestCounter++}`;
}

let taskCounter = 0;

export function createTaskId(): string {
  return `task-${taskCounter++}`;
}

/** Numeric priority for ordering: lower = higher priority. */
export function priorityOrdinal(p: TaskPriority): number {
  switch (p) {
    case 'critical':
      return 0;
    case 'near-viewport':
      return 1;
    case 'background':
      return 2;
  }
}
