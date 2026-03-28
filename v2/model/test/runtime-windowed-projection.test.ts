import { describe, expect, it } from 'vitest';
import { InProcessRuntimeV2, WorkerProxyV2, installWorkerHostV2 } from '../src/runtime/index.js';
import { createMultiParagraphDocx } from './helpers/create-test-docx.js';

describe('windowed projection runtimes', () => {
  it('projects and prefetched windows in-process', async () => {
    const runtime = new InProcessRuntimeV2();
    await runtime.openSource(createMultiParagraphDocx(['Alpha', 'Beta', 'Gamma']));
    await runtime.ready('render-shell');

    const firstWindow = await runtime.projectWindow({
      startBodyChildIndex: 0,
      maxBodyChildCount: 1,
      includeDependencyManifest: true,
    });

    expect(paragraphText(firstWindow.blocks)).toContain('Alpha');
    expect(firstWindow.continuation.nextBodyChildIndex).toBe(1);

    await runtime.prefetchWindow({
      startBodyChildIndex: 1,
      maxBodyChildCount: 1,
    });

    const secondWindow = await runtime.projectNextWindow({
      nextBodyChildIndex: 1,
      maxBodyChildCount: 1,
    });

    expect(paragraphText(secondWindow.blocks)).toContain('Beta');
    expect(secondWindow.continuation.nextBodyChildIndex).toBe(2);

    await runtime.close();
  });

  it('projects and prefetched windows through the worker proxy', async () => {
    const { mainThreadWorker, workerScope } = createWorkerLoopback();
    installWorkerHostV2(workerScope);

    const runtime = new WorkerProxyV2(mainThreadWorker);
    await runtime.openSource(createMultiParagraphDocx(['Alpha', 'Beta', 'Gamma']));
    await runtime.ready('render-shell');

    const firstWindow = await runtime.projectWindow({
      startBodyChildIndex: 0,
      maxBodyChildCount: 1,
      includeDependencyManifest: true,
    });

    expect(paragraphText(firstWindow.blocks)).toContain('Alpha');
    expect(firstWindow.continuation.nextBodyChildIndex).toBe(1);

    await runtime.prefetchWindow({
      startBodyChildIndex: 1,
      maxBodyChildCount: 1,
    });

    const secondWindow = await runtime.projectNextWindow({
      nextBodyChildIndex: 1,
      maxBodyChildCount: 1,
    });

    expect(paragraphText(secondWindow.blocks)).toContain('Beta');
    expect(secondWindow.continuation.nextBodyChildIndex).toBe(2);

    await runtime.close();
  });
});

function paragraphText(blocks: Array<{ kind?: string; runs?: Array<{ kind?: string; text?: string }> }>): string {
  return blocks
    .filter((block) => block.kind === 'paragraph')
    .flatMap((block) => block.runs ?? [])
    .filter((run) => run.kind === 'text' || run.kind === undefined)
    .map((run) => run.text ?? '')
    .join('');
}

type FakeWorkerScope = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(data: unknown, transfer?: Transferable[]): void;
};

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
