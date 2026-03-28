// ---------------------------------------------------------------------------
// Worker host — runs inside a Web Worker, owns the PackageSession
//
// V1: Simple request/response dispatch for open/ready/status/save/close.
// V2: Task-based dispatch with priority scheduling, cancellation, source
//     transport (Blob, range-proxy), and lifecycle events.
// ---------------------------------------------------------------------------

import type { DocumentHandle } from '../types/session.js';
import { createRenderShellSnapshot } from '../render-shell/index.js';
import { executeEnrichment } from '../enrichment/executors/index.js';
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerRequestV2,
  WorkerResponseV2,
  WorkerEventV2,
  WorkerMessageEnvelope,
  WorkerSourceDescriptor,
} from './worker-protocol.js';
import { open } from '../session/open.js';
import { TaskQueue, type QueuedTask } from './task-queue.js';
import { createPortBackedReader, closePortBackedReader } from './range-reader-proxy.js';
import type { ArchiveByteSource } from '../types/package.js';
import { WindowProjectionController } from './window-projection-controller.js';

// ---- Shared worker scope type -----------------------------------------------

type WorkerScope = {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown, transfer?: Transferable[]): void;
};

// ===== V1 Host (legacy, unchanged) ===========================================

/**
 * Install the worker host message handler (v1 protocol).
 * Call this inside a Web Worker's top-level scope.
 */
export function installWorkerHost(scope: WorkerScope): void {
  let handle: DocumentHandle | null = null;

  scope.onmessage = async (e: MessageEvent) => {
    const req = e.data as WorkerRequest;
    try {
      const result = await dispatch(req);
      const response: WorkerResponse = { id: req.id, ok: true, result };

      // Transfer Uint8Array results if possible
      if (result instanceof Uint8Array) {
        scope.postMessage(response, [result.buffer as ArrayBuffer]);
      } else {
        scope.postMessage(response);
      }
    } catch (err) {
      const response: WorkerResponse = {
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      scope.postMessage(response);
    }
  };

  async function dispatch(req: WorkerRequest): Promise<unknown> {
    switch (req.method) {
      case 'open': {
        handle = await open(req.params.bytes);
        return { sessionId: handle.sessionId };
      }
      case 'ready': {
        if (!handle) throw new Error('No session open');
        await handle.ready(req.params?.stage);
        return null;
      }
      case 'status': {
        if (!handle) throw new Error('No session open');
        return await handle.status();
      }
      case 'save': {
        if (!handle) throw new Error('No session open');
        // Worker transport only supports Uint8Array transfer — force bytes target
        const options = { ...req.params?.options, target: 'bytes' as const };
        const result = await handle.save(options);
        return result;
      }
      case 'close': {
        if (!handle) throw new Error('No session open');
        await handle.close();
        handle = null;
        return null;
      }
      default:
        throw new Error(`Unknown method: ${(req as WorkerRequest).method}`);
    }
  }
}

// ===== V2 Host (task-based) ==================================================

/**
 * Install the v2 worker host message handler.
 *
 * Supports both v1 and v2 protocol messages via the version-tagged envelope.
 * V2 messages are dispatched through a TaskQueue with priority scheduling
 * and cooperative cancellation.
 */
export function installWorkerHostV2(scope: WorkerScope): void {
  let handle: DocumentHandle | null = null;
  let rangeReaderPort: MessagePort | null = null;
  const queue = new TaskQueue();
  const windowProjection = new WindowProjectionController();

  // Wire task lifecycle events to worker event messages
  queue.onLifecycle((event) => {
    switch (event.kind) {
      case 'started':
        emitEvent(scope, {
          event: 'taskStarted',
          taskId: event.task.taskId,
          method: event.task.method,
          priority: event.task.priority,
        });
        break;
      case 'completed':
        emitEvent(scope, {
          event: 'taskCompleted',
          taskId: event.task.taskId,
          method: event.task.method,
          durationMs: event.durationMs,
        });
        break;
      case 'cancelled':
        emitEvent(scope, {
          event: 'taskCancelled',
          taskId: event.task.taskId,
          method: event.task.method,
          reason: event.reason,
        });
        break;
    }
  });

  scope.onmessage = async (e: MessageEvent) => {
    const msg = e.data as WorkerMessageEnvelope;

    // V1 legacy path
    if (!('version' in msg) || msg.version === 1) {
      await handleV1(msg.payload as WorkerRequest, scope);
      return;
    }

    // V2 path
    const req = msg.payload as WorkerRequestV2;
    handleV2(req);
  };

  // ---- V1 legacy dispatch (inline) ------------------------------------------

  async function handleV1(req: WorkerRequest, s: WorkerScope): Promise<void> {
    try {
      let result: unknown;
      switch (req.method) {
        case 'open':
          handle = await open(req.params.bytes);
          result = { sessionId: handle.sessionId };
          break;
        case 'ready':
          if (!handle) throw new Error('No session open');
          await handle.ready(req.params?.stage);
          result = null;
          break;
        case 'status':
          if (!handle) throw new Error('No session open');
          result = await handle.status();
          break;
        case 'save': {
          if (!handle) throw new Error('No session open');
          const options = { ...req.params?.options, target: 'bytes' as const };
          result = await handle.save(options);
          break;
        }
        case 'close':
          if (!handle) throw new Error('No session open');
          await handle.close();
          handle = null;
          result = null;
          break;
        default:
          throw new Error(`Unknown v1 method: ${(req as WorkerRequest).method}`);
      }

      const response: WorkerResponse = { id: req.id, ok: true, result };
      if (result instanceof Uint8Array) {
        s.postMessage(response, [result.buffer as ArrayBuffer]);
      } else {
        s.postMessage(response);
      }
    } catch (err) {
      s.postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
  }

  // ---- V2 dispatch ----------------------------------------------------------

  function handleV2(req: WorkerRequestV2): void {
    // Immediate methods — bypass the queue
    switch (req.method) {
      case 'cancelTask':
        queue.cancelTask(req.params.taskId);
        sendV2Response(scope, req, null);
        return;

      case 'status':
        void respondWithV2Status(req);
        return;

      case 'close':
        queue.cancelAll('document-close');
        cleanupRangeReaderPort();
        windowProjection.clear();
        if (handle) {
          void closeOpenHandle(req);
        } else {
          sendV2Response(scope, req, null);
        }
        return;
    }

    // openSource: cancel all existing tasks and close current session
    if (req.method === 'openSource') {
      queue.cancelAll('new-document-open');
      cleanupRangeReaderPort();
      windowProjection.clear();
      if (handle) {
        void handle.close();
        handle = null;
      }
    }

    // Scheduled methods — wrap in a QueuedTask and enqueue
    const task: QueuedTask = {
      taskId: req.taskId,
      method: req.method,
      priority: req.priority,
      abortController: new AbortController(),
      status: 'queued',
      execute: (signal) => executeV2Method(req, signal),
    };

    queue.enqueue(task).then(
      (result) => {
        // Transfer Uint8Array results
        if (result instanceof Uint8Array) {
          sendV2Response(scope, req, result, [result.buffer as ArrayBuffer]);
        } else if (isImageEnrichmentResult(result)) {
          // Transfer image ArrayBuffers to avoid copying
          const transferables = result.items.map((item: { data: ArrayBuffer }) => item.data);
          sendV2Response(scope, req, result, transferables);
        } else {
          sendV2Response(scope, req, result);
        }
      },
      (err) => {
        sendV2Error(scope, req, err);
      },
    );
  }

  // ---- V2 method execution --------------------------------------------------

  async function executeV2Method(req: WorkerRequestV2, signal: AbortSignal): Promise<unknown> {
    switch (req.method) {
      case 'openSource': {
        const source = await resolveSourceDescriptor(req.params.source);
        handle = await open(source);
        return { sessionId: handle.sessionId };
      }

      case 'ready': {
        if (!handle) throw new Error('No session open');
        await handle.ready(req.params.stage, signal);
        return null;
      }

      case 'getRenderShell': {
        if (!handle) throw new Error('No session open');
        return createRenderShellSnapshot(handle.renderShell());
      }

      case 'projectWindow': {
        if (!handle) throw new Error('No session open');
        return windowProjection.projectWindow(handle, req.params);
      }

      case 'projectNextWindow': {
        if (!handle) throw new Error('No session open');
        return windowProjection.projectNextWindow(handle, req.params.continuation);
      }

      case 'prefetchWindow': {
        if (!handle) throw new Error('No session open');
        windowProjection.prefetchWindow(handle, req.params);
        return null;
      }

      case 'advanceStructure': {
        if (!handle) throw new Error('No session open');
        await handle.ready('structure', signal);
        return null;
      }

      case 'enrich': {
        if (!handle) throw new Error('No session open');
        await handle.ready('render-shell', signal);
        return executeEnrichment(
          handle,
          req.params.target,
          req.params.request?.ids,
          req.params.request?.manifest,
          signal,
        );
      }

      case 'save': {
        if (!handle) throw new Error('No session open');
        const options = { ...req.params?.options, target: 'bytes' as const };
        return handle.save(options);
      }

      default:
        throw new Error(`Unknown v2 method: ${(req as WorkerRequestV2).method}`);
    }
  }

  // ---- Source descriptor resolution -----------------------------------------

  async function resolveSourceDescriptor(desc: WorkerSourceDescriptor): Promise<Uint8Array | Blob | ArchiveByteSource> {
    switch (desc.kind) {
      case 'memory':
        return desc.bytes;

      case 'blob':
        return { kind: 'blob', blob: desc.blob, size: desc.blob.size };

      case 'range-proxy': {
        rangeReaderPort = desc.port;
        const reader = createPortBackedReader(desc.port, desc.size);
        return {
          kind: 'range-reader',
          size: desc.size,
          read: (opts: { start: number; endExclusive: number }) => reader.read(opts.start, opts.endExclusive),
        };
      }
    }
  }

  // ---- Cleanup helpers ------------------------------------------------------

  function cleanupRangeReaderPort(): void {
    if (rangeReaderPort) {
      closePortBackedReader(rangeReaderPort);
      rangeReaderPort = null;
    }
  }

  async function respondWithV2Status(req: WorkerRequestV2): Promise<void> {
    try {
      if (!handle) throw new Error('No session open');
      const status = await handle.status();
      sendV2Response(scope, req, status);
    } catch (err) {
      sendV2Error(scope, req, err);
    }
  }

  async function closeOpenHandle(req: WorkerRequestV2): Promise<void> {
    try {
      await handle!.close();
      handle = null;
      windowProjection.clear();
      sendV2Response(scope, req, null);
    } catch (err) {
      sendV2Error(scope, req, err);
    }
  }
}

// ---- V2 response/event helpers ----------------------------------------------

function sendV2Response(scope: WorkerScope, req: WorkerRequestV2, result: unknown, transfer?: Transferable[]): void {
  const response: WorkerResponseV2 = {
    id: req.id,
    taskId: req.taskId,
    ok: true,
    result,
  };
  const envelope: WorkerMessageEnvelope = { version: 2, payload: response };
  if (transfer) {
    scope.postMessage(envelope, transfer);
  } else {
    scope.postMessage(envelope);
  }
}

function sendV2Error(scope: WorkerScope, req: WorkerRequestV2, err: unknown): void {
  const isCancel =
    (err instanceof Error && err.name === 'TaskCancelledError') ||
    (err instanceof DOMException && err.name === 'AbortError');

  const response: WorkerResponseV2 = {
    id: req.id,
    taskId: req.taskId,
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    ...(isCancel ? { code: 'CANCELLED' } : {}),
  };
  scope.postMessage({ version: 2, payload: response } satisfies WorkerMessageEnvelope);
}

function emitEvent(scope: WorkerScope, event: WorkerEventV2): void {
  scope.postMessage({ version: 2, payload: event } satisfies WorkerMessageEnvelope);
}

function isImageEnrichmentResult(result: unknown): result is { target: 'images'; items: { data: ArrayBuffer }[] } {
  return (
    result !== null &&
    typeof result === 'object' &&
    (result as { target?: string }).target === 'images' &&
    Array.isArray((result as { items?: unknown }).items)
  );
}
