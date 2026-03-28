// ---------------------------------------------------------------------------
// Range-reader proxy — MessagePort bridge for range-backed sources
//
// Functions cannot cross the structured clone boundary, so ArchiveByteSource
// with kind "range-reader" cannot be posted to a worker directly. This module
// provides both sides of a MessagePort-based proxy:
//
// - Main thread: installRangeReaderHost(port, reader)
//   Listens for { reqId, start, end } requests and replies with bytes.
//
// - Worker: createPortBackedReader(port, size)
//   Returns an AsyncArchiveReader that sends range requests over the port.
//
// The lazy-source advantage is fully preserved — only the bytes actually
// requested (central directory, metadata entries, visible parts) cross the
// port.
// ---------------------------------------------------------------------------

import type { AsyncArchiveReader } from '../types/package.js';

// ---- Configuration ----------------------------------------------------------

export type RangeReaderOptions = {
  /** Timeout in ms for a single read request. Default: 30_000. */
  timeoutMs?: number;
  /** Maximum retries on timeout (not on explicit errors). Default: 2. */
  maxRetries?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

// ---- Message shapes ---------------------------------------------------------

type RangeReadRequest = {
  reqId: number;
  start: number;
  end: number;
};

type RangeReadResponse = { reqId: number; bytes: Uint8Array } | { reqId: number; error: string };

type PendingReadRequest = {
  resolve: (bytes: Uint8Array) => void;
  reject: (err: Error) => void;
};

type PortReaderState = {
  closed: boolean;
  pending: Map<number, PendingReadRequest>;
};

const portReaderStates = new WeakMap<MessagePort, PortReaderState>();

// ---- Main-thread side -------------------------------------------------------

/**
 * Install a range-read host on a MessagePort.
 * The host listens for range-read requests and delegates to the real reader.
 *
 * Call this on the main thread after creating a MessageChannel. Send port2
 * to the worker; keep port1 and pass it here with the real reader/source.
 *
 * Returns a cleanup function that removes the listener and closes the port.
 */
export function installRangeReaderHost(
  port: MessagePort,
  reader: { read(opts: { start: number; endExclusive: number }): Promise<Uint8Array> },
): () => void {
  const handler = async (e: MessageEvent) => {
    const req = e.data as RangeReadRequest;
    try {
      const bytes = await reader.read({ start: req.start, endExclusive: req.end });
      port.postMessage({ reqId: req.reqId, bytes } satisfies RangeReadResponse, [bytes.buffer as ArrayBuffer]);
    } catch (err) {
      port.postMessage({
        reqId: req.reqId,
        error: err instanceof Error ? err.message : String(err),
      } satisfies RangeReadResponse);
    }
  };

  port.onmessage = handler;

  return () => {
    port.onmessage = null;
    port.close();
  };
}

// ---- Worker side ------------------------------------------------------------

/**
 * Create an AsyncArchiveReader backed by a MessagePort.
 * The reader sends range-read requests to the main thread over the port
 * and waits for byte responses.
 *
 * Call this inside the worker after receiving a port via the openSource
 * message's range-proxy descriptor.
 */
export function createPortBackedReader(
  port: MessagePort,
  size: number,
  options?: RangeReaderOptions,
): AsyncArchiveReader {
  let reqCounter = 0;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

  const state: PortReaderState = {
    closed: false,
    pending: new Map<number, PendingReadRequest>(),
  };
  portReaderStates.set(port, state);

  port.onmessage = (e: MessageEvent) => {
    if (state.closed) {
      return;
    }

    const resp = e.data as RangeReadResponse;
    const entry = state.pending.get(resp.reqId);
    if (!entry) return;
    state.pending.delete(resp.reqId);

    if ('error' in resp) {
      entry.reject(new Error(resp.error));
    } else {
      entry.resolve(resp.bytes);
    }
  };

  /** Send a single read request with a timeout guard. */
  function rawRead(start: number, end: number): Promise<Uint8Array> {
    if (state.closed) {
      return Promise.reject(createReaderClosedError());
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const reqId = reqCounter++;

      const timer = setTimeout(() => {
        // Remove the pending entry so a late response doesn't resolve
        if (state.pending.delete(reqId)) {
          reject(new RangeReadTimeoutError(start, end, timeoutMs));
        }
      }, timeoutMs);

      state.pending.set(reqId, {
        resolve: (bytes) => {
          clearTimeout(timer);
          resolve(bytes);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      port.postMessage({ reqId, start, end } satisfies RangeReadRequest);
    });
  }

  return {
    size,
    async read(start: number, end: number): Promise<Uint8Array> {
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await rawRead(start, end);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));

          // Only retry on timeout, not on explicit errors or reader-closed
          if (!(lastError instanceof RangeReadTimeoutError)) {
            throw lastError;
          }

          if (attempt < maxRetries) {
            // Exponential backoff: 500ms, 1000ms (capped at 5s)
            const backoff = Math.min(500 * 2 ** attempt, 5000);
            await new Promise<void>((r) => setTimeout(r, backoff));
          }
        }
      }

      throw lastError!;
    },
  };
}

/** Typed error for range-read timeout, distinguishable from explicit reader errors. */
export class RangeReadTimeoutError extends Error {
  readonly start: number;
  readonly end: number;
  readonly timeoutMs: number;

  constructor(start: number, end: number, timeoutMs: number) {
    super(`Range read timed out after ${timeoutMs}ms for [${start}, ${end})`);
    this.name = 'RangeReadTimeoutError';
    this.start = start;
    this.end = end;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Close a port-backed reader's port and reject any pending requests.
 * Call this when the document is closed or the worker is shutting down.
 */
export function closePortBackedReader(port: MessagePort): void {
  rejectPendingReads(port, createReaderClosedError());
  port.onmessage = null;
  port.close();
}

function rejectPendingReads(port: MessagePort, error: Error): void {
  const state = portReaderStates.get(port);
  if (!state || state.closed) {
    return;
  }

  state.closed = true;
  for (const request of state.pending.values()) {
    request.reject(error);
  }
  state.pending.clear();
  portReaderStates.delete(port);
}

function createReaderClosedError(): Error {
  return new Error('Port-backed reader closed');
}
