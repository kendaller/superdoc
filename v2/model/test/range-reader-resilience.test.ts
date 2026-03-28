// ---------------------------------------------------------------------------
// Range-reader resilience tests — timeout, retry, partial availability
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPortBackedReader,
  installRangeReaderHost,
  closePortBackedReader,
  RangeReadTimeoutError,
} from '../src/runtime/range-reader-proxy.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Helper: advance fake timers while keeping the read promise's rejection
 * captured so vitest doesn't treat it as "unhandled".
 */
async function advanceAndCatch(promise: Promise<unknown>, ms: number): Promise<void> {
  // Attach a no-op catch so the rejection doesn't escape
  promise.catch(() => {});
  await vi.advanceTimersByTimeAsync(ms);
}

describe('range-reader resilience', () => {
  describe('timeout', () => {
    it('rejects with RangeReadTimeoutError when port never responds', async () => {
      const channel = new MessageChannel();
      // Don't install a host — port1 never replies
      const reader = createPortBackedReader(channel.port2, 100, { timeoutMs: 200, maxRetries: 0 });

      const readPromise = reader.read(0, 10);
      await advanceAndCatch(readPromise, 200);

      await expect(readPromise).rejects.toThrow(RangeReadTimeoutError);
      await expect(readPromise).rejects.toThrow('timed out after 200ms');

      channel.port1.close();
      closePortBackedReader(channel.port2);
    });

    it('timeout error includes range and duration metadata', async () => {
      const channel = new MessageChannel();
      const reader = createPortBackedReader(channel.port2, 100, { timeoutMs: 500, maxRetries: 0 });

      const readPromise = reader.read(10, 50);
      await advanceAndCatch(readPromise, 500);

      try {
        await readPromise;
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RangeReadTimeoutError);
        const timeoutErr = err as RangeReadTimeoutError;
        expect(timeoutErr.start).toBe(10);
        expect(timeoutErr.end).toBe(50);
        expect(timeoutErr.timeoutMs).toBe(500);
      }

      channel.port1.close();
      closePortBackedReader(channel.port2);
    });
  });

  describe('retry on timeout', () => {
    it('succeeds on second attempt after first timeout', async () => {
      const fullBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      let readCallCount = 0;

      const realReader = {
        read(opts: { start: number; endExclusive: number }): Promise<Uint8Array> {
          readCallCount++;
          if (readCallCount === 1) {
            // First call: never resolve (simulate timeout)
            return new Promise(() => {});
          }
          return Promise.resolve(fullBytes.slice(opts.start, opts.endExclusive));
        },
      };

      const channel = new MessageChannel();
      const cleanup = installRangeReaderHost(channel.port1, realReader);
      const reader = createPortBackedReader(channel.port2, 10, { timeoutMs: 100, maxRetries: 2 });

      const readPromise = reader.read(0, 5);
      readPromise.catch(() => {}); // Prevent unhandled rejection during timer advance

      // First attempt times out
      await vi.advanceTimersByTimeAsync(100);
      // Backoff: 500ms
      await vi.advanceTimersByTimeAsync(500);
      // Second attempt — host responds via MessagePort
      // Need to yield to microtask queue for MessagePort delivery
      await vi.advanceTimersByTimeAsync(0);

      // Use real timers briefly to let MessagePort deliver
      vi.useRealTimers();
      const result = await readPromise;
      vi.useFakeTimers();

      expect(Array.from(result)).toEqual([0, 1, 2, 3, 4]);
      expect(readCallCount).toBe(2);

      cleanup();
      closePortBackedReader(channel.port2);
    });

    it('exhausts retries and throws the last timeout error', async () => {
      const channel = new MessageChannel();
      // No host installed — all reads will time out
      const reader = createPortBackedReader(channel.port2, 100, { timeoutMs: 100, maxRetries: 2 });

      const readPromise = reader.read(0, 10);
      readPromise.catch(() => {}); // Prevent unhandled rejection during timer advance

      // Attempt 0: timeout at 100ms
      await vi.advanceTimersByTimeAsync(100);
      // Backoff 1: 500ms
      await vi.advanceTimersByTimeAsync(500);
      // Attempt 1: timeout at 100ms
      await vi.advanceTimersByTimeAsync(100);
      // Backoff 2: 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      // Attempt 2 (final): timeout at 100ms
      await vi.advanceTimersByTimeAsync(100);

      await expect(readPromise).rejects.toThrow(RangeReadTimeoutError);

      channel.port1.close();
      closePortBackedReader(channel.port2);
    });
  });

  describe('no retry on explicit error', () => {
    it('rejects immediately on explicit error from host, no retry', async () => {
      const realReader = {
        read(_opts: { start: number; endExclusive: number }): Promise<Uint8Array> {
          return Promise.reject(new Error('disk I/O error'));
        },
      };

      const channel = new MessageChannel();
      const cleanup = installRangeReaderHost(channel.port1, realReader);
      const reader = createPortBackedReader(channel.port2, 100, { timeoutMs: 5000, maxRetries: 2 });

      // Use real timers since the error is delivered via MessagePort
      vi.useRealTimers();

      await expect(reader.read(0, 10)).rejects.toThrow('disk I/O error');

      vi.useFakeTimers();
      cleanup();
      closePortBackedReader(channel.port2);
    });

    it('does not retry when reader is closed', async () => {
      const channel = new MessageChannel();
      const reader = createPortBackedReader(channel.port2, 100, { timeoutMs: 5000, maxRetries: 2 });

      const readPromise = reader.read(0, 10);
      closePortBackedReader(channel.port2);

      await expect(readPromise).rejects.toThrow('Port-backed reader closed');
    });
  });

  describe('partial range availability', () => {
    it('succeeds for ranges within available bytes, errors for ranges beyond', async () => {
      const availableBytes = 50_000;
      const fullBytes = new Uint8Array(availableBytes);
      for (let i = 0; i < availableBytes; i++) fullBytes[i] = i % 256;

      const realReader = {
        read(opts: { start: number; endExclusive: number }): Promise<Uint8Array> {
          if (opts.endExclusive > availableBytes) {
            return Promise.reject(new Error(`Range [${opts.start}, ${opts.endExclusive}) exceeds available bytes`));
          }
          return Promise.resolve(fullBytes.slice(opts.start, opts.endExclusive));
        },
      };

      const channel = new MessageChannel();
      const cleanup = installRangeReaderHost(channel.port1, realReader);
      const reader = createPortBackedReader(channel.port2, 100_000, { timeoutMs: 5000, maxRetries: 0 });

      // Use real timers for MessagePort delivery
      vi.useRealTimers();

      // Read within available range — should succeed
      const chunk = await reader.read(0, 100);
      expect(chunk).toHaveLength(100);

      // Read beyond available range — should fail immediately (no retry)
      await expect(reader.read(49_000, 51_000)).rejects.toThrow('exceeds available bytes');

      vi.useFakeTimers();
      cleanup();
      closePortBackedReader(channel.port2);
    });
  });
});
