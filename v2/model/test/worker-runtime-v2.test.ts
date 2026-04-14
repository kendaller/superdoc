// ---------------------------------------------------------------------------
// Worker runtime v2 integration tests
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { installWorkerHostV2, WorkerProxyV2 } from '../src/runtime/index.js';
import { open, segmentsToText } from '../src/index.js';
import type { WorkerMessageEnvelope, WorkerRequestV2, WorkerResponseV2 } from '../src/runtime/worker-protocol.js';
import { createMinimalDocx } from './helpers/create-test-docx.js';
import { createInlineImageDocx } from './helpers/create-rich-docx.js';

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
    await runtime.ready('first-paint-shell');

    const renderShell = await runtime.getRenderShell();

    expect(renderShell).toBeDefined();
    expect(renderShell).toMatchObject({
      bodyChildCount: expect.any(Number),
      availableShells: {
        styles: false,
        numbering: false,
        settings: false,
      },
      primaryPageGeometry: {
        width: 12240,
        height: 15840,
      },
    });
    expect(renderShell?.sections).toEqual([]);

    await runtime.advanceRenderShell();
    const enrichedShell = await runtime.getRenderShell();
    expect(enrichedShell?.availableShells).toEqual({
      styles: true,
      numbering: true,
      settings: true,
    });

    await runtime.close();
  });

  it('passes manifest-backed image enrichment through the worker runtime', async () => {
    const { mainThreadWorker, workerScope } = createWorkerLoopback();
    installWorkerHostV2(workerScope);

    const runtime = new WorkerProxyV2(mainThreadWorker);
    await runtime.openSource(createInlineImageDocx());
    await runtime.ready('render-shell');

    const result = await runtime.enrich('images', {
      ids: ['rId5'],
      manifest: {
        headerFooterRefs: [],
        footnoteRefs: [],
        endnoteRefs: [],
        commentRefs: [],
        imageRefs: [{ relationshipId: 'rId5', sourcePartUri: '/word/document.xml' }],
        hyperlinkRefs: [],
      },
    });

    expect(result.target).toBe('images');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].mimeType).toBe('image/png');
    expect(result.items[0].data).toBeInstanceOf(ArrayBuffer);

    await runtime.close();
  });

  it('applies semantic mutations through the worker proxy and reports revisions', async () => {
    const { mainThreadWorker, workerScope } = createWorkerLoopback();
    installWorkerHostV2(workerScope);

    const bytes = createMinimalDocx('Hello');
    const inspectorHandle = await open(bytes);
    await inspectorHandle.ready('structure');
    const inspectorModel = inspectorHandle.semanticModel();
    if (!inspectorModel) {
      throw new Error('Inspector model was not created');
    }

    const mainStory = inspectorModel.mainStory();
    if (!mainStory) {
      throw new Error('Missing main story');
    }

    const paragraph = inspectorModel.blockEntities(mainStory.ref)[0];
    if (!paragraph || paragraph.kind !== 'paragraph') {
      throw new Error('Missing first paragraph');
    }

    const runtime = new WorkerProxyV2(mainThreadWorker);
    await runtime.openSource(bytes);
    await runtime.ready('structure');

    const initialRevision = await runtime.getRevision();
    expect(initialRevision).toBeTruthy();

    const mutationResult = await runtime.applyOperation({
      id: 'worker-mutation-1',
      label: 'Insert paragraph',
      kind: 'insertParagraph',
      relativeTo: paragraph.ref,
      position: 'after',
    });

    expect(mutationResult).toMatchObject({
      ok: true,
      revision: expect.any(String),
    });
    expect(mutationResult.revision).not.toBe(initialRevision);
    expect(await runtime.getRevision()).toBe(mutationResult.revision);

    const undoResult = await runtime.undo();
    expect(undoResult).toMatchObject({
      ok: true,
      revision: expect.any(String),
    });
    expect(undoResult.revision).not.toBe(mutationResult.revision);

    await inspectorHandle.close();
    await runtime.close();
  });

  it('resolves source-backed text mutations through invokeMutation without pre-expanded runs', async () => {
    const { mainThreadWorker, workerScope } = createWorkerLoopback();
    installWorkerHostV2(workerScope);

    const bytes = createMinimalDocx('Hello');
    const inspectorHandle = await open(bytes);
    await inspectorHandle.ready('structure');
    const inspectorModel = inspectorHandle.semanticModel();
    if (!inspectorModel) {
      throw new Error('Inspector model was not created');
    }

    const mainStory = inspectorModel.mainStory();
    if (!mainStory) {
      throw new Error('Missing main story');
    }

    const paragraph = inspectorModel.blockEntities(mainStory.ref)[0];
    if (!paragraph || paragraph.kind !== 'paragraph' || !paragraph.sourceRefs[0]) {
      throw new Error('Missing first paragraph');
    }

    const run = inspectorModel.runs(paragraph.ref)[0];
    if (!run || !run.sourceRefs[0]) {
      throw new Error('Missing first run');
    }

    const runtime = new WorkerProxyV2(mainThreadWorker);
    await runtime.openSource(bytes);

    const mutationResult = await runtime.invokeMutation!('paragraph.insertText', {
      paragraphSourceRef: paragraph.sourceRefs[0],
      targetSourceRef: run.sourceRefs[0],
      text: '!',
      segmentIndex: 0,
      charOffset: 5,
    });

    expect(mutationResult).toMatchObject({
      ok: true,
      revision: expect.any(String),
    });

    const savedBytes = await runtime.save();
    const mutatedHandle = await open(savedBytes);
    await mutatedHandle.ready('structure');
    const mutatedModel = mutatedHandle.semanticModel();
    if (!mutatedModel) {
      throw new Error('Mutated model was not created');
    }

    const mutatedStory = mutatedModel.mainStory();
    if (!mutatedStory) {
      throw new Error('Missing mutated main story');
    }

    const mutatedParagraph = mutatedModel.blockEntities(mutatedStory.ref)[0];
    if (!mutatedParagraph || mutatedParagraph.kind !== 'paragraph') {
      throw new Error('Missing mutated paragraph');
    }

    const mutatedRun = mutatedModel.runs(mutatedParagraph.ref)[0];
    if (!mutatedRun) {
      throw new Error('Missing mutated run');
    }

    expect(segmentsToText(mutatedModel.segments(mutatedRun.ref))).toBe('Hello!');

    await mutatedHandle.close();
    await inspectorHandle.close();
    await runtime.close();
  });

  it('rejects pending requests when the worker reports a message deserialization failure', async () => {
    const mainThreadWorker = createMessageErrorWorkerStub();
    const runtime = new WorkerProxyV2(mainThreadWorker);

    const statusPromise = runtime.status();
    mainThreadWorker.onmessageerror?.(new MessageEvent('messageerror'));

    await expect(statusPromise).rejects.toThrow('Worker message deserialization failed');
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

function createMessageErrorWorkerStub(): Worker {
  return {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate(): void {},
  } as unknown as Worker;
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
