// ---------------------------------------------------------------------------
// Worker proxy — main-thread proxy for a worker-hosted DocumentHandle
//
// Sends WorkerRequests to a Worker, resolves promises from WorkerResponses.
// This is what the browser main thread uses to interact with the session.
// ---------------------------------------------------------------------------

import type {
  DocumentHandle,
  ReadyStage,
  SaveOptions,
  SaveResult,
  SessionStatus,
} from "../types/session.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";
import { createRequestId } from "./worker-protocol.js";

/**
 * Create a DocumentHandle that proxies all calls to a Web Worker.
 *
 * @param worker - The Worker instance hosting the session
 * @param bytes - The archive bytes to open (transferred to the worker)
 */
export async function openInWorker(
  worker: Worker,
  bytes: Uint8Array,
): Promise<DocumentHandle> {
  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  worker.onmessage = (e: MessageEvent) => {
    const resp = e.data as WorkerResponse;
    const entry = pending.get(resp.id);
    if (!entry) return;
    pending.delete(resp.id);

    if (resp.ok) {
      entry.resolve(resp.result);
    } else {
      entry.reject(new Error(resp.error));
    }
  };

  function send(req: WorkerRequest, transfer?: Transferable[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      pending.set(req.id, { resolve, reject });
      if (transfer) {
        worker.postMessage(req, transfer);
      } else {
        worker.postMessage(req);
      }
    });
  }

  // Open the document in the worker, transferring the bytes
  const openResult = (await send(
    { id: createRequestId(), method: "open", params: { bytes } },
    [bytes.buffer as ArrayBuffer],
  )) as { sessionId: string };

  return {
    sessionId: openResult.sessionId,

    async ready(stage?: ReadyStage): Promise<void> {
      await send({
        id: createRequestId(),
        method: "ready",
        params: { stage },
      });
    },

    async status(): Promise<SessionStatus> {
      return (await send({
        id: createRequestId(),
        method: "status",
      })) as SessionStatus;
    },

    async close(): Promise<void> {
      await send({ id: createRequestId(), method: "close" });
      worker.terminate();
    },

    async save(options?: SaveOptions): Promise<SaveResult> {
      // Worker transport only supports bytes — host enforces target: "bytes"
      return (await send({
        id: createRequestId(),
        method: "save",
        params: { options },
      })) as Uint8Array;
    },

    documentView() {
      throw new Error(
        "documentView() is not available on worker-proxied handles. " +
        "Use a main-thread handle for typed view access.",
      );
    },

    views() {
      throw new Error(
        "views() is not available on worker-proxied handles. " +
        "Use a main-thread handle for typed view access.",
      );
    },

    semanticModel() {
      throw new Error(
        "semanticModel() is not available on worker-proxied handles. " +
        "Use a main-thread handle for semantic model access.",
      );
    },
  };
}
