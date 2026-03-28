import { InProcessRuntimeV2, WorkerProxyV2, type DocumentRuntime } from '@superdoc/v2-model';

type RuntimeFactoryOptions = {
  createWorker?: (() => Worker) | null;
  createInProcessRuntime?: () => DocumentRuntime;
};

/**
 * Create the default browser runtime for the product `v2` pipeline.
 *
 * Browser builds should prefer the worker-backed runtime so large-document
 * projection does not block the main thread. The in-process runtime remains as
 * a fallback for environments without Worker support and for defensive recovery
 * when worker construction fails.
 */
export function createDefaultV2DocumentRuntime(options: RuntimeFactoryOptions = {}): DocumentRuntime {
  const createInProcessRuntime = options.createInProcessRuntime ?? (() => new InProcessRuntimeV2());
  const createWorker = options.createWorker ?? resolveDefaultWorkerFactory();

  if (!createWorker) {
    return createInProcessRuntime();
  }

  try {
    return new WorkerProxyV2(createWorker());
  } catch {
    return createInProcessRuntime();
  }
}

function resolveDefaultWorkerFactory(): (() => Worker) | null {
  if (!supportsModuleWorkers()) {
    return null;
  }

  return () => new Worker(new URL('./v2-model.worker.ts', import.meta.url), { type: 'module' });
}

function supportsModuleWorkers(): boolean {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}
