// ---------------------------------------------------------------------------
// Worker health monitor — optional liveness check for production use.
//
// Uses the existing status() RPC as a ping. If the worker stops responding
// or the transport reports a fatal worker failure, subscribed handlers fire.
// ---------------------------------------------------------------------------

import type { DocumentRuntime } from './runtime-interface.js';

export type WorkerDeathHandler = (reason: string) => void;

const FATAL_WORKER_ERROR_PREFIX = 'Worker error:';
const WORKER_MESSAGE_ERROR_TEXT = 'Worker message deserialization failed';
const WORKER_TERMINATED_TEXT = 'Worker terminated';

class WorkerLivenessTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Worker liveness check timed out after ${timeoutMs}ms`);
    this.name = 'WorkerLivenessTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class WorkerHealthMonitor {
  #runtime: DocumentRuntime;
  #handlers = new Set<WorkerDeathHandler>();
  #dead = false;

  constructor(runtime: DocumentRuntime) {
    this.#runtime = runtime;
  }

  /** Subscribe to worker death notifications. Returns unsubscribe function. */
  onWorkerDeath(handler: WorkerDeathHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  /**
   * Check if the worker is still responsive by sending a status() RPC
   * and waiting for a response within the timeout.
   *
   * If the worker doesn't respond, all onWorkerDeath handlers fire.
   */
  async checkLiveness(timeoutMs = 30_000): Promise<boolean> {
    if (this.#dead) return false;

    try {
      const result = await withTimeout(this.#runtime.status(), timeoutMs);
      return result != null;
    } catch (error) {
      const deathReason = classifyWorkerDeath(error);
      if (!deathReason) {
        return false;
      }

      this.#declareDead(deathReason);
      return false;
    }
  }

  /** Whether the monitor has declared the worker dead. */
  get isDead(): boolean {
    return this.#dead;
  }

  #declareDead(reason: string): void {
    if (this.#dead) {
      return;
    }

    this.#dead = true;
    for (const handler of this.#handlers) {
      handler(reason);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WorkerLivenessTimeoutError(timeoutMs)), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function classifyWorkerDeath(error: unknown): string | null {
  if (error instanceof WorkerLivenessTimeoutError) {
    return `Worker unresponsive (${error.message})`;
  }

  const message = getErrorMessage(error);
  if (!message) {
    return null;
  }

  if (message.startsWith(FATAL_WORKER_ERROR_PREFIX)) {
    return `Worker unresponsive (${message})`;
  }

  if (message.includes(WORKER_MESSAGE_ERROR_TEXT) || message.includes(WORKER_TERMINATED_TEXT)) {
    return `Worker unresponsive (${message})`;
  }

  return null;
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  return null;
}
