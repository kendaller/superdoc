// V1 (legacy, unchanged)
export { installWorkerHost } from './worker-host.js';
export { openInWorker } from './worker-proxy.js';
export { openInProcess } from './in-process.js';
export type { WorkerRequest, WorkerResponse, WorkerEvent } from './worker-protocol.js';

// V2 (task-based protocol)
export { installWorkerHostV2 } from './worker-host.js';
export { WorkerProxyV2 } from './worker-proxy-v2.js';
export { InProcessRuntimeV2 } from './in-process-v2.js';
export { TaskQueue, TaskCancelledError } from './task-queue.js';
export type { QueuedTask, TaskStatus, TaskLifecycleEvent } from './task-queue.js';
export type { DocumentRuntime, RuntimeEventHandler } from './runtime-interface.js';
export { createPortBackedReader, installRangeReaderHost, closePortBackedReader } from './range-reader-proxy.js';
export type {
  TaskId,
  TaskPriority,
  WorkerSourceDescriptor,
  WorkerRequestV2,
  WorkerResponseV2,
  WorkerEventV2,
  WorkerMessageEnvelope,
  EnrichmentTarget,
  ProjectWindowParams,
  WindowContinuation,
} from './worker-protocol.js';
export { createRequestId, createTaskId, priorityOrdinal } from './worker-protocol.js';
