// ---------------------------------------------------------------------------
// Worker host — runs inside a Web Worker, owns the PackageSession
//
// Receives WorkerRequests via postMessage, dispatches to session methods,
// returns WorkerResponses. Binary payloads use transferables where possible.
// ---------------------------------------------------------------------------

import type { DocumentHandle } from "../types/session.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";
import { open } from "../session/open.js";

/**
 * Install the worker host message handler.
 * Call this inside a Web Worker's top-level scope.
 */
export function installWorkerHost(scope: {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown, transfer?: Transferable[]): void;
}): void {
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
      case "open": {
        handle = await open(req.params.bytes);
        return { sessionId: handle.sessionId };
      }
      case "ready": {
        if (!handle) throw new Error("No session open");
        await handle.ready(req.params?.stage);
        return null;
      }
      case "status": {
        if (!handle) throw new Error("No session open");
        return handle.status();
      }
      case "save": {
        if (!handle) throw new Error("No session open");
        // Worker transport only supports Uint8Array transfer — force bytes target
        const options = { ...req.params?.options, target: "bytes" as const };
        const result = await handle.save(options);
        return result;
      }
      case "close": {
        if (!handle) throw new Error("No session open");
        await handle.close();
        handle = null;
        return null;
      }
      default:
        throw new Error(`Unknown method: ${(req as WorkerRequest).method}`);
    }
  }
}
