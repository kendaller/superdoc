// ---------------------------------------------------------------------------
// Worker RPC protocol types
//
// Defines the message shapes for communication between a main-thread
// proxy and a worker-hosted PackageSession.
// ---------------------------------------------------------------------------

import type { ReadyStage, SaveOptions } from "../types/session.js";

// ---- Request messages -----------------------------------------------------

export type WorkerRequest =
  | { id: string; method: "open"; params: { bytes: Uint8Array } }
  | { id: string; method: "ready"; params: { stage?: ReadyStage } }
  | { id: string; method: "status"; params?: undefined }
  | { id: string; method: "save"; params: { options?: SaveOptions } }
  | { id: string; method: "close"; params?: undefined };

// ---- Response messages ----------------------------------------------------

export type WorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

// ---- Event messages -------------------------------------------------------

export type WorkerEvent =
  | { event: "diagnostic"; data: { code: string; message: string } }
  | { event: "progress"; data: { stage: string; progress: number } }
  | { event: "revision"; data: { revision: string } };

// ---- Utility --------------------------------------------------------------

let requestCounter = 0;

export function createRequestId(): string {
  return `req-${requestCounter++}`;
}
