import { afterEach, describe, expect, it, vi } from 'vitest';
import { InProcessRuntimeV2, WorkerProxyV2, type DocumentRuntime } from '@superdoc/v2-model';
import { createDefaultV2DocumentRuntime } from './create-default-runtime.js';

describe('createDefaultV2DocumentRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the worker-backed runtime when worker construction succeeds', () => {
    const fakeWorker = createFakeWorker();

    const runtime = createDefaultV2DocumentRuntime({
      createWorker: () => fakeWorker,
    });

    expect(runtime).toBeInstanceOf(WorkerProxyV2);
  });

  it('falls back to the in-process runtime when worker construction throws', () => {
    const fallbackRuntime = new InProcessRuntimeV2();

    const runtime = createDefaultV2DocumentRuntime({
      createWorker: () => {
        throw new Error('worker unavailable');
      },
      createInProcessRuntime: () => fallbackRuntime,
    });

    expect(runtime).toBe(fallbackRuntime);
  });

  it('falls back to the in-process runtime when no worker factory is available', () => {
    const originalWorker = globalThis.Worker;
    const fallbackRuntime = new InProcessRuntimeV2();

    try {
      Reflect.deleteProperty(globalThis, 'Worker');

      const runtime = createDefaultV2DocumentRuntime({
        createInProcessRuntime: () => fallbackRuntime,
      });

      expect(runtime).toBe(fallbackRuntime);
    } finally {
      if (originalWorker) {
        globalThis.Worker = originalWorker;
      }
    }
  });
});

function createFakeWorker(): Worker {
  return {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  } as unknown as Worker;
}
