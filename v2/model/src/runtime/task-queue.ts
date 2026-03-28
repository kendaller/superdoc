// ---------------------------------------------------------------------------
// Task queue — priority scheduler for the worker runtime
//
// Runs inside a Web Worker (or in-process for Node/CLI). Tasks are executed
// one at a time in priority order. Critical tasks can preempt running
// background tasks via cooperative AbortSignal cancellation.
//
// Fully unit-testable without a real Worker — no DOM or postMessage deps.
// ---------------------------------------------------------------------------

import { type TaskId, type TaskPriority, priorityOrdinal } from './worker-protocol.js';

// ---- Types ------------------------------------------------------------------

export type TaskStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'errored';

export type QueuedTask = {
  taskId: TaskId;
  method: string;
  priority: TaskPriority;
  execute: (signal: AbortSignal) => Promise<unknown>;
  abortController: AbortController;
  status: TaskStatus;
  cancelReason?: string;
  result?: unknown;
  error?: Error;
};

export type TaskLifecycleEvent =
  | { kind: 'started'; task: QueuedTask }
  | { kind: 'completed'; task: QueuedTask; durationMs: number }
  | { kind: 'cancelled'; task: QueuedTask; reason: string }
  | { kind: 'errored'; task: QueuedTask; error: Error }
  | { kind: 'preempted'; task: QueuedTask; by: QueuedTask };

export type TaskLifecycleListener = (event: TaskLifecycleEvent) => void;

// ---- TaskQueue --------------------------------------------------------------

export class TaskQueue {
  #queued: QueuedTask[] = [];
  #running: QueuedTask | null = null;
  #processing = false;
  #listeners: TaskLifecycleListener[] = [];

  /** Number of tasks currently queued (not running). */
  get queuedCount(): number {
    return this.#queued.length;
  }

  /** The currently running task, if any. */
  get running(): QueuedTask | null {
    return this.#running;
  }

  /** Subscribe to task lifecycle events. Returns an unsubscribe function. */
  onLifecycle(listener: TaskLifecycleListener): () => void {
    this.#listeners.push(listener);
    return () => {
      const idx = this.#listeners.indexOf(listener);
      if (idx >= 0) this.#listeners.splice(idx, 1);
    };
  }

  /**
   * Enqueue a task. It will be inserted by priority (FIFO within the same
   * priority class). If the task should preempt the currently running task,
   * the running task is aborted first.
   *
   * Returns a promise that resolves when the task completes or rejects on
   * error/cancellation.
   */
  enqueue(task: QueuedTask): Promise<unknown> {
    task.status = 'queued';
    this.#insertByPriority(task);

    const promise = new Promise<unknown>((resolve, reject) => {
      const unsub = this.onLifecycle((event) => {
        if (event.task.taskId !== task.taskId) return;
        switch (event.kind) {
          case 'completed':
            unsub();
            resolve(event.task.result);
            break;
          case 'cancelled':
            unsub();
            reject(new TaskCancelledError(event.reason));
            break;
          case 'errored':
            unsub();
            reject(event.error);
            break;
        }
      });
    });

    // Preemption: if a higher-priority task arrives while a lower-priority
    // task is running, abort the running task. The processLoop is already
    // awaiting it — once it settles, the loop continues and picks up the
    // higher-priority task (which was inserted at the front of the queue).
    if (this.#running && this.#shouldPreempt(task.priority, this.#running.priority)) {
      this.#emit({ kind: 'preempted', task: this.#running, by: task });
      this.#requestCancelRunningTask(this.#running, 'preempted');
    }

    // Kick processing (non-blocking)
    void this.#processLoop();

    return promise;
  }

  /** Cancel a specific task by ID. Returns true if the task was found. */
  cancelTask(taskId: TaskId, reason = 'cancelled'): boolean {
    // Check running task
    if (this.#running?.taskId === taskId) {
      this.#requestCancelRunningTask(this.#running, reason);
      return true;
    }

    // Check queued tasks
    const idx = this.#queued.findIndex((t) => t.taskId === taskId);
    if (idx >= 0) {
      const task = this.#queued.splice(idx, 1)[0];
      this.#cancelQueuedTask(task, reason);
      return true;
    }

    return false;
  }

  /** Cancel all queued and running tasks. */
  cancelAll(reason: string): void {
    // Cancel queued first (avoids them starting during the abort settle)
    const queued = this.#queued.splice(0);
    for (const task of queued) {
      this.#cancelQueuedTask(task, reason);
    }

    if (this.#running) {
      this.#requestCancelRunningTask(this.#running, reason);
    }
  }

  /** Cancel all tasks at or below the given priority (higher ordinal = lower priority). */
  cancelByPriority(minPriority: TaskPriority, reason: string): void {
    const threshold = priorityOrdinal(minPriority);

    const remaining: QueuedTask[] = [];
    for (const task of this.#queued) {
      if (priorityOrdinal(task.priority) >= threshold) {
        this.#cancelQueuedTask(task, reason);
      } else {
        remaining.push(task);
      }
    }
    this.#queued = remaining;

    if (this.#running && priorityOrdinal(this.#running.priority) >= threshold) {
      this.#requestCancelRunningTask(this.#running, reason);
    }
  }

  // ---- Private --------------------------------------------------------------

  /** Insert a task into the queue sorted by priority (FIFO within class). */
  #insertByPriority(task: QueuedTask): void {
    const ord = priorityOrdinal(task.priority);
    // Find the first position where a lower-priority task sits
    let insertIdx = this.#queued.length;
    for (let i = 0; i < this.#queued.length; i++) {
      if (priorityOrdinal(this.#queued[i].priority) > ord) {
        insertIdx = i;
        break;
      }
    }
    this.#queued.splice(insertIdx, 0, task);
  }

  /** Should the incoming task preempt the currently running task? */
  #shouldPreempt(incoming: TaskPriority, running: TaskPriority): boolean {
    // Only critical preempts, and only non-critical running tasks
    return incoming === 'critical' && running === 'background';
  }

  /**
   * Main processing loop. Ensures one task runs at a time.
   *
   * Preemption model: enqueue() aborts the currently running task when a
   * higher-priority task arrives. This causes #executeTask's await to settle,
   * and the loop naturally picks the next (higher-priority) task from the queue.
   */
  async #processLoop(): Promise<void> {
    if (this.#processing) return;
    this.#processing = true;

    try {
      while (this.#queued.length > 0) {
        const next = this.#queued.shift()!;
        if (next.status === 'cancelled') continue;
        await this.#executeTask(next);
      }
    } finally {
      this.#processing = false;
    }
  }

  /** Execute a single task and handle its lifecycle. */
  async #executeTask(task: QueuedTask): Promise<void> {
    task.status = 'running';
    this.#running = task;
    this.#emit({ kind: 'started', task });

    const startTime = performance.now();

    try {
      task.result = await task.execute(task.abortController.signal);

      if (task.abortController.signal.aborted) {
        task.status = 'cancelled';
        this.#emit({ kind: 'cancelled', task, reason: this.#consumeCancelReason(task) });
      } else {
        task.status = 'completed';
        const durationMs = performance.now() - startTime;
        this.#emit({ kind: 'completed', task, durationMs });
      }
    } catch (err) {
      if (isAbortError(err)) {
        task.status = 'cancelled';
        this.#emit({ kind: 'cancelled', task, reason: this.#consumeCancelReason(task) });
      } else {
        task.status = 'errored';
        task.error = err instanceof Error ? err : new Error(String(err));
        this.#emit({ kind: 'errored', task, error: task.error });
      }
    } finally {
      if (this.#running === task) {
        this.#running = null;
      }
    }
  }

  /** Cancel a queued task immediately and emit its terminal event. */
  #cancelQueuedTask(task: QueuedTask, reason: string): void {
    task.status = 'cancelled';
    task.cancelReason = reason;
    task.abortController.abort();
    this.#emit({ kind: 'cancelled', task, reason });
  }

  /**
   * Request cancellation of a running task.
   *
   * The running task will emit its terminal cancellation event when its
   * execute() promise settles or notices the aborted signal.
   */
  #requestCancelRunningTask(task: QueuedTask, reason: string): void {
    if (task.status === 'cancelled') {
      return;
    }
    task.cancelReason = reason;
    task.abortController.abort();
  }

  #consumeCancelReason(task: QueuedTask): string {
    const reason = task.cancelReason ?? 'aborted';
    task.cancelReason = undefined;
    return reason;
  }

  #emit(event: TaskLifecycleEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}

// ---- Helpers ----------------------------------------------------------------

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError')
  );
}

// ---- TaskCancelledError -----------------------------------------------------

export class TaskCancelledError extends Error {
  override name = 'TaskCancelledError';

  constructor(public readonly reason: string) {
    super(`Task cancelled: ${reason}`);
  }
}
