// ---------------------------------------------------------------------------
// TaskQueue unit tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskQueue, TaskCancelledError, type QueuedTask } from '../src/runtime/task-queue.js';
import type { TaskPriority } from '../src/runtime/worker-protocol.js';

function createTask(
  taskId: string,
  priority: TaskPriority,
  execute: (signal: AbortSignal) => Promise<unknown>,
  method = 'test',
): QueuedTask {
  return {
    taskId,
    method,
    priority,
    execute,
    abortController: new AbortController(),
    status: 'queued',
  };
}

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Creates a task that resolves after a delay (cancellable). */
function delayTask(taskId: string, priority: TaskPriority, ms: number, value: unknown = taskId): QueuedTask {
  return createTask(taskId, priority, async (signal) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
    return value;
  });
}

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  describe('basic execution', () => {
    it('executes a single task', async () => {
      const task = createTask('t1', 'critical', async () => 'result-1');
      const result = await queue.enqueue(task);
      expect(result).toBe('result-1');
      expect(task.status).toBe('completed');
    });

    it('executes tasks sequentially', async () => {
      const order: string[] = [];

      const t1 = createTask('t1', 'critical', async () => {
        order.push('t1');
        return 'r1';
      });
      const t2 = createTask('t2', 'critical', async () => {
        order.push('t2');
        return 'r2';
      });

      const [r1, r2] = await Promise.all([queue.enqueue(t1), queue.enqueue(t2)]);

      expect(r1).toBe('r1');
      expect(r2).toBe('r2');
      expect(order).toEqual(['t1', 't2']);
    });
  });

  describe('priority ordering', () => {
    it('executes critical before near-viewport before background', async () => {
      const order: string[] = [];
      const gate = { resolve: () => {} };
      const gatePromise = new Promise<void>((r) => {
        gate.resolve = r;
      });

      // First task blocks the queue
      const blocker = createTask('blocker', 'critical', async () => {
        await gatePromise;
        order.push('blocker');
      });

      // Enqueue in reverse priority order
      const bg = createTask('bg', 'background', async () => {
        order.push('bg');
      });
      const nv = createTask('nv', 'near-viewport', async () => {
        order.push('nv');
      });
      const crit = createTask('crit', 'critical', async () => {
        order.push('crit');
      });

      const p0 = queue.enqueue(blocker);
      const p3 = queue.enqueue(bg);
      const p2 = queue.enqueue(nv);
      const p1 = queue.enqueue(crit);

      // Release the blocker
      gate.resolve();
      await Promise.all([p0, p1, p2, p3]);

      // After blocker, priority order should be: critical, near-viewport, background
      expect(order).toEqual(['blocker', 'crit', 'nv', 'bg']);
    });

    it('FIFO within same priority class', async () => {
      const order: string[] = [];
      const gate = { resolve: () => {} };
      const gatePromise = new Promise<void>((r) => {
        gate.resolve = r;
      });

      const blocker = createTask('blocker', 'critical', async () => {
        await gatePromise;
      });

      const bg1 = createTask('bg1', 'background', async () => {
        order.push('bg1');
      });
      const bg2 = createTask('bg2', 'background', async () => {
        order.push('bg2');
      });
      const bg3 = createTask('bg3', 'background', async () => {
        order.push('bg3');
      });

      const p0 = queue.enqueue(blocker);
      const p1 = queue.enqueue(bg1);
      const p2 = queue.enqueue(bg2);
      const p3 = queue.enqueue(bg3);

      gate.resolve();
      await Promise.all([p0, p1, p2, p3]);

      expect(order).toEqual(['bg1', 'bg2', 'bg3']);
    });
  });

  describe('preemption', () => {
    it('critical preempts running background task', async () => {
      const events: string[] = [];

      // Long-running background task that checks signal
      const bgTask = createTask('bg', 'background', async (signal) => {
        events.push('bg-start');
        for (let i = 0; i < 100; i++) {
          if (signal.aborted) {
            events.push('bg-aborted');
            throw new DOMException('Aborted', 'AbortError');
          }
          await delay(5);
        }
        events.push('bg-done');
      });

      const bgPromise = queue.enqueue(bgTask);

      // Wait for bg to start, then enqueue critical
      await delay(20);
      expect(events).toContain('bg-start');

      const critTask = createTask('crit', 'critical', async () => {
        events.push('crit-done');
        return 'critical-result';
      });

      const critPromise = queue.enqueue(critTask);
      const critResult = await critPromise;

      expect(critResult).toBe('critical-result');
      expect(events).toContain('crit-done');

      // Background task should have been cancelled
      await expect(bgPromise).rejects.toThrow();
    });
  });

  describe('cancelTask', () => {
    it('cancels a queued task', async () => {
      const gate = { resolve: () => {} };
      const gatePromise = new Promise<void>((r) => {
        gate.resolve = r;
      });

      const blocker = createTask('blocker', 'critical', async () => {
        await gatePromise;
      });
      const target = createTask('target', 'background', async () => 'should-not-run');

      const p0 = queue.enqueue(blocker);
      const p1 = queue.enqueue(target);

      expect(queue.cancelTask('target')).toBe(true);

      gate.resolve();
      await p0;
      await expect(p1).rejects.toThrow(TaskCancelledError);
      expect(target.status).toBe('cancelled');
    });

    it('cancels a running task', async () => {
      const task = delayTask('long', 'critical', 5000);
      const promise = queue.enqueue(task);

      await delay(20); // Let it start
      expect(queue.cancelTask('long')).toBe(true);

      await expect(promise).rejects.toThrow();
    });

    it('emits a single cancellation event for a running task', async () => {
      const task = delayTask('long', 'critical', 5000);
      const cancelledEvents: Array<{ taskId: string; reason: string }> = [];

      queue.onLifecycle((event) => {
        if (event.kind === 'cancelled') {
          cancelledEvents.push({
            taskId: event.task.taskId,
            reason: event.reason,
          });
        }
      });

      const promise = queue.enqueue(task);

      await delay(20);
      expect(queue.cancelTask('long', 'user-request')).toBe(true);

      await expect(promise).rejects.toThrow(TaskCancelledError);
      expect(cancelledEvents).toEqual([{ taskId: 'long', reason: 'user-request' }]);
    });

    it('returns false for unknown taskId', () => {
      expect(queue.cancelTask('nonexistent')).toBe(false);
    });
  });

  describe('cancelAll', () => {
    it('cancels all queued and running tasks', async () => {
      const t1 = delayTask('t1', 'critical', 5000);
      const t2 = createTask('t2', 'background', async () => 'r2');
      const t3 = createTask('t3', 'background', async () => 'r3');

      const p1 = queue.enqueue(t1);
      const p2 = queue.enqueue(t2);
      const p3 = queue.enqueue(t3);

      await delay(20); // Let t1 start

      queue.cancelAll('document-close');

      await expect(p1).rejects.toThrow();
      await expect(p2).rejects.toThrow();
      await expect(p3).rejects.toThrow();

      expect(t1.status).toBe('cancelled');
      expect(t2.status).toBe('cancelled');
      expect(t3.status).toBe('cancelled');
    });

    it('preserves the caller-provided reason for a running task', async () => {
      const task = delayTask('t1', 'critical', 5000);
      const cancelledReasons: string[] = [];

      queue.onLifecycle((event) => {
        if (event.kind === 'cancelled' && event.task.taskId === 't1') {
          cancelledReasons.push(event.reason);
        }
      });

      const promise = queue.enqueue(task);

      await delay(20);
      queue.cancelAll('document-close');

      await expect(promise).rejects.toThrow(TaskCancelledError);
      expect(cancelledReasons).toEqual(['document-close']);
    });
  });

  describe('cancelByPriority', () => {
    it('cancels background tasks but keeps critical', async () => {
      const gate = { resolve: () => {} };
      const gatePromise = new Promise<void>((r) => {
        gate.resolve = r;
      });

      const crit = createTask('crit', 'critical', async () => {
        await gatePromise;
        return 'crit-result';
      });
      const bg = createTask('bg', 'background', async () => 'bg-result');

      const pCrit = queue.enqueue(crit);
      const pBg = queue.enqueue(bg);

      queue.cancelByPriority('background', 'scroll-change');

      gate.resolve();
      const critResult = await pCrit;
      expect(critResult).toBe('crit-result');
      await expect(pBg).rejects.toThrow();
    });
  });

  describe('lifecycle events', () => {
    it('emits started and completed events', async () => {
      const events: string[] = [];

      queue.onLifecycle((event) => {
        events.push(`${event.kind}:${event.task.taskId}`);
      });

      const task = createTask('t1', 'critical', async () => 'done');
      await queue.enqueue(task);

      expect(events).toContain('started:t1');
      expect(events).toContain('completed:t1');
    });

    it('emits cancelled event on cancelTask', async () => {
      const events: string[] = [];
      queue.onLifecycle((event) => {
        if (event.kind === 'cancelled') {
          events.push(`cancelled:${event.task.taskId}:${event.reason}`);
        }
      });

      const gate = { resolve: () => {} };
      const gatePromise = new Promise<void>((r) => {
        gate.resolve = r;
      });
      const blocker = createTask('blocker', 'critical', async () => {
        await gatePromise;
      });
      const target = createTask('target', 'background', async () => {});

      const pBlocker = queue.enqueue(blocker);
      const pTarget = queue.enqueue(target);

      queue.cancelTask('target', 'user-cancelled');

      gate.resolve();
      await pBlocker;
      await expect(pTarget).rejects.toThrow(TaskCancelledError);

      expect(events).toContain('cancelled:target:user-cancelled');
    });

    it('unsubscribe works', async () => {
      const events: string[] = [];

      const unsub = queue.onLifecycle((event) => {
        events.push(event.kind);
      });

      unsub();

      await queue.enqueue(createTask('t1', 'critical', async () => 'done'));
      expect(events).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('rejects promise when task throws', async () => {
      const task = createTask('t1', 'critical', async () => {
        throw new Error('task failed');
      });

      await expect(queue.enqueue(task)).rejects.toThrow('task failed');
      expect(task.status).toBe('errored');
    });

    it('continues processing after task error', async () => {
      const failing = createTask('fail', 'critical', async () => {
        throw new Error('oops');
      });
      const succeeding = createTask('ok', 'critical', async () => 'success');

      const p1 = queue.enqueue(failing);
      const p2 = queue.enqueue(succeeding);

      await expect(p1).rejects.toThrow('oops');
      expect(await p2).toBe('success');
    });
  });

  describe('queuedCount', () => {
    it('tracks queue depth', async () => {
      expect(queue.queuedCount).toBe(0);

      const gate = { resolve: () => {} };
      const gatePromise = new Promise<void>((r) => {
        gate.resolve = r;
      });

      const blocker = createTask('blocker', 'critical', async () => {
        await gatePromise;
      });
      const t1 = createTask('t1', 'background', async () => {});
      const t2 = createTask('t2', 'background', async () => {});

      queue.enqueue(blocker);
      queue.enqueue(t1);
      queue.enqueue(t2);

      await delay(10); // Let blocker start running

      // blocker is running, t1 and t2 are queued
      expect(queue.queuedCount).toBe(2);
      expect(queue.running?.taskId).toBe('blocker');

      gate.resolve();
      await delay(50);

      expect(queue.queuedCount).toBe(0);
      expect(queue.running).toBe(null);
    });
  });
});
