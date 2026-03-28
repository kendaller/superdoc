// ---------------------------------------------------------------------------
// WorkerProxyV2 — main-thread proxy for a v2 task-based worker
//
// Sends WorkerRequestV2 messages to a Worker, resolves promises from
// WorkerResponseV2 messages, and delivers WorkerEventV2 to subscribers.
//
// Supports Blob and range-reader sources (via MessagePort proxy) in addition
// to the original Uint8Array path. Uses generation-based stale result
// suppression to handle rapid document switches.
// ---------------------------------------------------------------------------

import type { ArchiveByteSource } from '../types/package.js';
import type { RenderShellSnapshot } from '../render-shell/index.js';
import type { ReadyStage, SaveOptions, SessionStatus } from '../types/session.js';
import type { WindowedProjectionResult } from '../projections/layout/index.js';
import type { EnrichmentResult } from '../enrichment/enrichment-results.js';
import type { EnrichmentRequest, SerializableEnrichmentRequest } from '../enrichment/enrichment-request.js';
import type {
  TaskId,
  TaskPriority,
  WorkerRequestV2,
  WorkerResponseV2,
  WorkerEventV2,
  WorkerMessageEnvelope,
  WorkerSourceDescriptor,
  EnrichmentTarget,
  PrefetchWindowParams,
  ProjectWindowParams,
  WindowContinuation,
} from './worker-protocol.js';
import { createRequestId, createTaskId } from './worker-protocol.js';
import { installRangeReaderHost } from './range-reader-proxy.js';

// ---- Types ------------------------------------------------------------------

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  generation: number;
  cleanupAbort?: () => void;
};

type EventHandler = (event: WorkerEventV2) => void;

// ---- WorkerProxyV2 ----------------------------------------------------------

export class WorkerProxyV2 {
  #worker: Worker;
  #pending = new Map<string, PendingRequest>();
  #eventHandlers = new Map<string, Set<EventHandler>>();
  #generation = 0;
  #cleanupRangeReader: (() => void) | null = null;

  constructor(worker: Worker) {
    this.#worker = worker;
    this.#worker.onmessage = (e: MessageEvent) => this.#handleMessage(e);

    this.#worker.onerror = (e: ErrorEvent) => {
      this.#emitEvent({
        event: 'workerError',
        data: { message: e.message, filename: e.filename, lineno: e.lineno },
      });
      this.#rejectAllPending(new Error(`Worker error: ${e.message}`));
    };

    this.#worker.onmessageerror = () => {
      const error = new Error('Worker message deserialization failed');
      this.#emitEvent({
        event: 'workerError',
        data: { message: error.message },
      });
      this.#rejectAllPending(error);
    };
  }

  // ---- Lifecycle ------------------------------------------------------------

  async openSource(source: Uint8Array | Blob | ArchiveByteSource): Promise<{ sessionId: string }> {
    // New generation — invalidate all pending requests from previous document
    this.#generation++;
    this.#rejectStale('Superseded by new document open');
    this.#cleanupPreviousRangeReader();

    const { descriptor, transfer } = this.#buildSourceDescriptor(source);

    return this.#send('openSource', { source: descriptor }, 'critical', transfer) as Promise<{ sessionId: string }>;
  }

  async ready(stage: ReadyStage): Promise<void> {
    await this.#send('ready', { stage }, 'critical');
  }

  async getRenderShell(): Promise<RenderShellSnapshot | undefined> {
    return this.#send('getRenderShell', {}, 'critical') as Promise<RenderShellSnapshot | undefined>;
  }

  async projectWindow(params: ProjectWindowParams): Promise<WindowedProjectionResult> {
    return this.#send(
      'projectWindow',
      params,
      params.startBodyChildIndex === 0 ? 'critical' : 'near-viewport',
    ) as Promise<WindowedProjectionResult>;
  }

  async projectNextWindow(continuation: WindowContinuation): Promise<WindowedProjectionResult> {
    return this.#send('projectNextWindow', { continuation }, 'near-viewport') as Promise<WindowedProjectionResult>;
  }

  async prefetchWindow(params: PrefetchWindowParams): Promise<void> {
    await this.#send('prefetchWindow', params, 'near-viewport');
  }

  async advanceRenderShell(): Promise<void> {
    await this.#send('advanceRenderShell', {}, 'background');
  }

  async advanceStructure(): Promise<void> {
    await this.#send('advanceStructure', {}, 'background');
  }

  async enrich(target: EnrichmentTarget, request?: EnrichmentRequest): Promise<EnrichmentResult> {
    const serializableRequest = toSerializableEnrichmentRequest(request);

    return this.#send(
      'enrich',
      {
        target,
        ...(serializableRequest ? { request: serializableRequest } : {}),
      },
      'background',
      undefined,
      request?.signal,
    ) as Promise<EnrichmentResult>;
  }

  cancelTask(taskId: TaskId): void {
    // Fire-and-forget — no response needed
    const id = createRequestId();
    const tId = createTaskId();
    const req: WorkerRequestV2 = {
      id,
      taskId: tId,
      method: 'cancelTask',
      params: { taskId },
      priority: 'critical',
    };
    this.#worker.postMessage({ version: 2, payload: req } satisfies WorkerMessageEnvelope);
  }

  async status(): Promise<SessionStatus> {
    return this.#send('status', {}, 'critical') as Promise<SessionStatus>;
  }

  async save(options?: SaveOptions): Promise<Uint8Array> {
    return this.#send('save', { options }, 'critical') as Promise<Uint8Array>;
  }

  async close(): Promise<void> {
    this.#cleanupPreviousRangeReader();
    await this.#send('close', {}, 'critical');
    this.#worker.terminate();
  }

  // ---- Events ---------------------------------------------------------------

  /**
   * Subscribe to worker events. Returns an unsubscribe function.
   *
   * Event names: "taskStarted", "taskCompleted", "taskCancelled",
   * "progress", "diagnostic", "revision", "memory"
   */
  on(event: string, handler: EventHandler): () => void {
    let handlers = this.#eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.#eventHandlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => handlers!.delete(handler);
  }

  // ---- Private: event emission -----------------------------------------------

  #emitEvent(event: WorkerEventV2): void {
    const handlers = this.#eventHandlers.get(event.event);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  #rejectAllPending(error: Error): void {
    for (const [id, entry] of this.#pending) {
      this.#pending.delete(id);
      entry.cleanupAbort?.();
      entry.reject(error);
    }
  }

  // ---- Private: message handling --------------------------------------------

  #handleMessage(e: MessageEvent): void {
    const msg = e.data as WorkerMessageEnvelope;

    // Ignore v1 messages (shouldn't happen with a v2 host, but be safe)
    if (!('version' in msg) || msg.version !== 2) return;

    const payload = msg.payload;

    // Response (has id + ok fields)
    if ('id' in payload && 'ok' in payload) {
      const resp = payload as WorkerResponseV2;
      const entry = this.#pending.get(resp.id);
      if (!entry) return;
      this.#pending.delete(resp.id);
      entry.cleanupAbort?.();

      // Stale result suppression
      if (entry.generation !== this.#generation) return;

      if (resp.ok) {
        entry.resolve(resp.result);
      } else {
        const err = new Error(resp.error);
        if (resp.code === 'CANCELLED') {
          err.name = 'TaskCancelledError';
        }
        entry.reject(err);
      }
      return;
    }

    // Event (has event field)
    if ('event' in payload) {
      this.#emitEvent(payload as WorkerEventV2);
    }
  }

  // ---- Private: send --------------------------------------------------------

  #send(
    method: string,
    params: unknown,
    priority: TaskPriority,
    transfer?: Transferable[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError('Request aborted before dispatch'));
    }

    const id = createRequestId();
    const taskId = createTaskId();

    const req = {
      id,
      taskId,
      method,
      params,
      priority,
    } as WorkerRequestV2;

    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        generation: this.#generation,
      };

      if (signal) {
        const onAbort = () => {
          this.cancelTask(taskId);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        pending.cleanupAbort = () => {
          signal.removeEventListener('abort', onAbort);
        };
      }

      this.#pending.set(id, pending);

      const envelope: WorkerMessageEnvelope = { version: 2, payload: req };
      if (transfer?.length) {
        this.#worker.postMessage(envelope, transfer);
      } else {
        this.#worker.postMessage(envelope);
      }
    });
  }

  // ---- Private: source descriptor -------------------------------------------

  #buildSourceDescriptor(source: Uint8Array | Blob | ArchiveByteSource): {
    descriptor: WorkerSourceDescriptor;
    transfer: Transferable[];
  } {
    // Raw Uint8Array
    if (source instanceof Uint8Array) {
      return {
        descriptor: { kind: 'memory', bytes: source },
        transfer: [source.buffer as ArrayBuffer],
      };
    }

    // Raw Blob
    if (source instanceof Blob) {
      return {
        descriptor: { kind: 'blob', blob: source },
        transfer: [],
      };
    }

    // ArchiveByteSource variants
    switch (source.kind) {
      case 'memory':
        return {
          descriptor: { kind: 'memory', bytes: source.bytes },
          transfer: [source.bytes.buffer as ArrayBuffer],
        };

      case 'blob':
        return {
          descriptor: { kind: 'blob', blob: source.blob },
          transfer: [],
        };

      case 'range-reader': {
        const channel = new MessageChannel();
        // Install host on port1 (main thread keeps it)
        this.#cleanupRangeReader = installRangeReaderHost(channel.port1, source);
        // Send port2 to worker (transferred)
        return {
          descriptor: { kind: 'range-proxy', port: channel.port2, size: source.size },
          transfer: [channel.port2],
        };
      }
    }
  }

  // ---- Private: cleanup -----------------------------------------------------

  #rejectStale(reason: string): void {
    for (const [id, entry] of this.#pending) {
      if (entry.generation < this.#generation) {
        this.#pending.delete(id);
        entry.cleanupAbort?.();
        entry.reject(new Error(reason));
      }
    }
  }

  #cleanupPreviousRangeReader(): void {
    if (this.#cleanupRangeReader) {
      this.#cleanupRangeReader();
      this.#cleanupRangeReader = null;
    }
  }
}

function toSerializableEnrichmentRequest(request?: EnrichmentRequest): SerializableEnrichmentRequest | undefined {
  if (!request) {
    return undefined;
  }

  const serializableRequest: SerializableEnrichmentRequest = {};
  if (request.ids) {
    serializableRequest.ids = request.ids;
  }
  if (request.manifest) {
    serializableRequest.manifest = request.manifest;
  }

  return Object.keys(serializableRequest).length > 0 ? serializableRequest : undefined;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}
