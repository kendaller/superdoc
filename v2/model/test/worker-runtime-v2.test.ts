// ---------------------------------------------------------------------------
// Worker runtime v2 integration tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { installWorkerHostV2, WorkerProxyV2 } from '../src/runtime/index.js';
import type { WorkerMessageEnvelope, WorkerRequestV2, WorkerResponseV2 } from '../src/runtime/worker-protocol.js';
import { createMinimalDocx } from './helpers/create-test-docx.js';

type FakeWorkerScope = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(data: unknown, transfer?: Transferable[]): void;
};

describe('worker runtime v2', () => {
  it('awaits status() before posting the worker response', async () => {
    const { scope, postedMessages } = createRecordingWorkerScope();
    installWorkerHostV2(scope);

    await dispatchToWorker(scope, postedMessages, createOpenSourceRequest());
    const statusResponse = await dispatchToWorker(scope, postedMessages, {
      id: 'status-1',
      taskId: 'task-status-1',
      method: 'status',
      params: {},
      priority: 'critical',
    });

    expect(statusResponse.ok).toBe(true);
    expect(isThenable(statusResponse.result)).toBe(false);
    expect(statusResponse.result).toMatchObject({
      currentStage: 'fast-open',
      sessionId: expect.any(String),
    });
  });

  it('returns a serializable render-shell snapshot through the worker proxy', async () => {
    const { mainThreadWorker, workerScope } = createWorkerLoopback();
    installWorkerHostV2(workerScope);

    const runtime = new WorkerProxyV2(mainThreadWorker);
    await runtime.openSource(createMinimalDocx());
    await runtime.ready('render-shell');

    const renderShell = await runtime.getRenderShell();

    expect(renderShell).toBeDefined();
    expect(renderShell).toMatchObject({
      bodyChildCount: expect.any(Number),
      availableShells: {
        styles: true,
        numbering: true,
        settings: true,
      },
      primaryPageGeometry: {
        width: 12240,
        height: 15840,
      },
    });
    expect(renderShell?.sections.length).toBeGreaterThan(0);

    await runtime.close();
  });
});

function createRecordingWorkerScope(): {
  scope: FakeWorkerScope;
  postedMessages: WorkerMessageEnvelope[];
} {
  const postedMessages: WorkerMessageEnvelope[] = [];

  return {
    postedMessages,
    scope: {
      onmessage: null,
      postMessage(data: unknown): void {
        postedMessages.push(data as WorkerMessageEnvelope);
      },
    },
  };
}

function createWorkerLoopback(): {
  mainThreadWorker: Worker;
  workerScope: FakeWorkerScope;
} {
  const workerScope: FakeWorkerScope = {
    onmessage: null,
    postMessage(data: unknown): void {
      queueMicrotask(() => {
        mainThreadWorker.onmessage?.(new MessageEvent('message', { data }));
      });
    },
  };

  const mainThreadWorker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(data: unknown): void {
      queueMicrotask(() => {
        workerScope.onmessage?.(new MessageEvent('message', { data }));
      });
    },
    terminate(): void {},
  } as unknown as Worker;

  return { mainThreadWorker, workerScope };
}

async function dispatchToWorker(
  scope: FakeWorkerScope,
  postedMessages: WorkerMessageEnvelope[],
  request: WorkerRequestV2,
): Promise<WorkerResponseV2> {
  const initialCount = postedMessages.length;

  scope.onmessage?.(
    new MessageEvent('message', {
      data: { version: 2, payload: request } satisfies WorkerMessageEnvelope,
    }),
  );

  return waitForResponse(postedMessages, request.id, initialCount);
}

async function waitForResponse(
  postedMessages: WorkerMessageEnvelope[],
  requestId: string,
  startIndex: number,
): Promise<WorkerResponseV2> {
  const timeoutAt = Date.now() + 500;

  while (Date.now() < timeoutAt) {
    for (const message of postedMessages.slice(startIndex)) {
      const response = asWorkerResponse(message);
      if (response && response.id === requestId) {
        return response;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out waiting for worker response ${requestId}`);
}

function asWorkerResponse(message: WorkerMessageEnvelope): WorkerResponseV2 | undefined {
  if (message.version !== 2) {
    return undefined;
  }

  const payload = message.payload;
  if (!('id' in payload) || !('ok' in payload)) {
    return undefined;
  }

  return payload as WorkerResponseV2;
}

function createOpenSourceRequest(): WorkerRequestV2 {
  return {
    id: 'open-1',
    taskId: 'task-open-1',
    method: 'openSource',
    params: {
      source: {
        kind: 'memory',
        bytes: createMinimalDocx(),
      },
    },
    priority: 'critical',
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}
