import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerHealthMonitor } from '../src/runtime/worker-health.js';
import type { DocumentRuntime } from '../src/runtime/runtime-interface.js';

function createRuntimeStub(overrides?: Partial<DocumentRuntime>): DocumentRuntime {
  return {
    openSource: vi.fn(),
    ready: vi.fn(),
    getRenderShell: vi.fn(),
    projectPreviewWindow: vi.fn(),
    projectWindow: vi.fn(),
    projectNextWindow: vi.fn(),
    prefetchWindow: vi.fn(),
    advanceRenderShell: vi.fn(),
    advanceStructure: vi.fn(),
    enrich: vi.fn(),
    cancelTask: vi.fn(),
    status: vi.fn().mockResolvedValue({ currentStage: 'render-shell' }),
    save: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    ...overrides,
  } as unknown as DocumentRuntime;
}

describe('WorkerHealthMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when the worker responds before the timeout', async () => {
    const runtime = createRuntimeStub();
    const monitor = new WorkerHealthMonitor(runtime);

    await expect(monitor.checkLiveness(50)).resolves.toBe(true);
    expect(monitor.isDead).toBe(false);
  });

  it('declares the worker dead after a real liveness timeout', async () => {
    vi.useFakeTimers();

    const runtime = createRuntimeStub({
      status: vi.fn(() => new Promise(() => {})),
    });
    const monitor = new WorkerHealthMonitor(runtime);
    const onWorkerDeath = vi.fn();
    monitor.onWorkerDeath(onWorkerDeath);

    const livenessPromise = monitor.checkLiveness(25);
    await vi.advanceTimersByTimeAsync(25);

    await expect(livenessPromise).resolves.toBe(false);
    expect(monitor.isDead).toBe(true);
    expect(onWorkerDeath).toHaveBeenCalledWith('Worker unresponsive (Worker liveness check timed out after 25ms)');
  });

  it('does not declare the worker dead for non-fatal status errors', async () => {
    const runtime = createRuntimeStub({
      status: vi.fn().mockRejectedValue(new Error('No session open')),
    });
    const monitor = new WorkerHealthMonitor(runtime);
    const onWorkerDeath = vi.fn();
    monitor.onWorkerDeath(onWorkerDeath);

    await expect(monitor.checkLiveness(25)).resolves.toBe(false);
    expect(monitor.isDead).toBe(false);
    expect(onWorkerDeath).not.toHaveBeenCalled();
  });

  it('declares the worker dead for fatal worker transport errors', async () => {
    const runtime = createRuntimeStub({
      status: vi.fn().mockRejectedValue(new Error('Worker error: channel closed')),
    });
    const monitor = new WorkerHealthMonitor(runtime);
    const onWorkerDeath = vi.fn();
    monitor.onWorkerDeath(onWorkerDeath);

    await expect(monitor.checkLiveness(25)).resolves.toBe(false);
    expect(monitor.isDead).toBe(true);
    expect(onWorkerDeath).toHaveBeenCalledWith('Worker unresponsive (Worker error: channel closed)');
  });
});
