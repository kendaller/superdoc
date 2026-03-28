import { installWorkerHostV2 } from '@superdoc/v2-model';

type RuntimeWorkerScope = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(data: unknown, transfer?: Transferable[]): void;
};

installWorkerHostV2(self as unknown as RuntimeWorkerScope);
