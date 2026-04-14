// ---------------------------------------------------------------------------
// InProcessRuntimeV2 — non-worker implementation of DocumentRuntime
//
// Calls session/projection functions directly without postMessage transport.
// Used by Node/CLI and for testing without a real Web Worker.
//
// Tasks run immediately in call order (no priority queue needed since
// there's no multi-threaded scheduling concern in a single-threaded
// synchronous context). AbortSignal is forwarded to session operations.
// ---------------------------------------------------------------------------

import type { ArchiveByteSource } from '../types/package.js';
import { createRenderShellSnapshot } from '../render-shell/index.js';
import type { WindowedProjectionResult } from '../projections/layout/index.js';
import type { DocumentHandle, ReadyStage, SaveOptions, SessionStatus } from '../types/session.js';
import type {
  DocumentRuntime,
  RuntimeEventHandler,
  SerializableSemanticOperation,
  RuntimeMutationResult,
} from './runtime-interface.js';
import type {
  TaskId,
  EnrichmentTarget,
  PrefetchWindowParams,
  ProjectPreviewWindowParams,
  ProjectWindowParams,
  WindowContinuation,
} from './worker-protocol.js';
import type { EnrichmentResult } from '../enrichment/enrichment-results.js';
import type { EnrichmentRequest } from '../enrichment/enrichment-request.js';
import type { SemanticOperation } from '../operations/types.js';
import { open } from '../session/open.js';
import { applySemanticOperation } from '../operations/apply.js';
import { SemanticHistory } from '../operations/history.js';
import { DocumentApiAdapter } from '../operations/doc-api-adapter.js';
import { executeEnrichment } from '../enrichment/executors/index.js';
import { WindowProjectionController } from './window-projection-controller.js';

export class InProcessRuntimeV2 implements DocumentRuntime {
  #handle: DocumentHandle | null = null;
  #eventHandlers = new Map<string, Set<RuntimeEventHandler>>();
  #windowProjection = new WindowProjectionController();
  #history = new SemanticHistory();

  // ---- Lifecycle ------------------------------------------------------------

  async openSource(source: Uint8Array | Blob | ArchiveByteSource): Promise<{ sessionId: string }> {
    // Close previous session if any
    if (this.#handle) {
      await this.#handle.close();
      this.#handle = null;
    }
    this.#windowProjection.clear();

    this.#handle = await open(source);
    this.#history.clear();
    return { sessionId: this.#handle.sessionId };
  }

  async close(): Promise<void> {
    if (this.#handle) {
      await this.#handle.close();
      this.#handle = null;
    }
    this.#windowProjection.clear();
  }

  // ---- Render pipeline ------------------------------------------------------

  async ready(stage: ReadyStage): Promise<void> {
    this.#assertOpen();
    await this.#handle!.ready(stage);
  }

  async getRenderShell() {
    this.#assertOpen();
    return createRenderShellSnapshot(this.#handle!.renderShell());
  }

  async projectPreviewWindow(params: ProjectPreviewWindowParams): Promise<WindowedProjectionResult> {
    this.#assertOpen();
    return this.#windowProjection.projectPreviewWindow(this.#handle!, params);
  }

  async projectWindow(params: ProjectWindowParams): Promise<WindowedProjectionResult> {
    this.#assertOpen();
    return this.#windowProjection.projectWindow(this.#handle!, params);
  }

  async projectNextWindow(continuation: WindowContinuation): Promise<WindowedProjectionResult> {
    this.#assertOpen();
    return this.#windowProjection.projectNextWindow(this.#handle!, continuation);
  }

  async prefetchWindow(params: PrefetchWindowParams): Promise<void> {
    this.#assertOpen();
    this.#windowProjection.prefetchWindow(this.#handle!, params);
  }

  async advanceRenderShell(): Promise<void> {
    this.#assertOpen();
    await this.#handle!.ready('render-shell');
  }

  async advanceStructure(): Promise<void> {
    this.#assertOpen();
    await this.#handle!.ready('structure');
  }

  async enrich(target: EnrichmentTarget, request?: EnrichmentRequest): Promise<EnrichmentResult> {
    this.#assertOpen();
    await this.#handle!.ready('render-shell', request?.signal);
    return executeEnrichment(this.#handle!, target, request?.ids, request?.manifest, request?.signal);
  }

  // ---- Task control ---------------------------------------------------------

  cancelTask(_taskId: TaskId): void {
    // In-process runtime has no background tasks to cancel.
    // This is a no-op to satisfy the interface.
  }

  // ---- Status ---------------------------------------------------------------

  async status(): Promise<SessionStatus> {
    this.#assertOpen();
    return this.#handle!.status();
  }

  async save(options?: SaveOptions): Promise<Uint8Array> {
    this.#assertOpen();
    const result = await this.#handle!.save({ ...options, target: 'bytes' });
    return result as Uint8Array;
  }

  // ---- Events ---------------------------------------------------------------

  on(event: string, handler: RuntimeEventHandler): () => void {
    let handlers = this.#eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.#eventHandlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => handlers!.delete(handler);
  }

  // ---- Editing (Phase 4) ----------------------------------------------------

  async applyOperation(op: SerializableSemanticOperation): Promise<RuntimeMutationResult> {
    this.#assertOpen();
    const model = this.#handle!.semanticModel();
    if (!model) {
      return { ok: false, error: 'Semantic model not available — call ready("structure") first' };
    }

    const result = await applySemanticOperation(
      op as unknown as SemanticOperation,
      model,
      model.session,
      this.#history,
      { replayExpandedEntities: false },
    );

    if (result.ok) {
      this.#windowProjection.clear();
      const revision = model.session.currentRevision;
      this.#emitEvent({ event: 'mutationCommitted', data: { revision, operationKind: op.kind } });
      this.#emitEvent({ event: 'revisionChanged', data: { revision } });
      return { ok: true, revision };
    }

    this.#emitEvent({ event: 'mutationFailed', data: { error: result.error ?? 'unknown', operationKind: op.kind } });
    return { ok: false, error: result.error };
  }

  async invokeMutation(operationKey: string, args: Record<string, unknown>): Promise<RuntimeMutationResult> {
    this.#assertOpen();
    const model = this.#handle!.semanticModel();
    if (!model) {
      return { ok: false, error: 'Semantic model not available' };
    }

    const adapter = new DocumentApiAdapter(model);
    const semanticOp = adapter.translate(operationKey, args);
    if (!semanticOp) {
      return { ok: false, error: `Unsupported operation: ${operationKey}` };
    }

    return this.applyOperation(semanticOp as unknown as SerializableSemanticOperation);
  }

  async undo(): Promise<RuntimeMutationResult> {
    const reverseOp = this.#history.undo();
    if (!reverseOp) return { ok: true, noop: true };

    this.#assertOpen();
    const model = this.#handle!.semanticModel();
    if (!model) return { ok: false, error: 'Semantic model not available' };

    const result = await applySemanticOperation(reverseOp, model, model.session, undefined, {
      replayExpandedEntities: false,
    });
    if (result.ok) {
      this.#windowProjection.clear();
      const revision = model.session.currentRevision;
      this.#emitEvent({ event: 'revisionChanged', data: { revision } });
      return { ok: true, revision };
    }
    return { ok: false, error: result.error };
  }

  async redo(): Promise<RuntimeMutationResult> {
    const forwardOp = this.#history.redo();
    if (!forwardOp) return { ok: true, noop: true };

    this.#assertOpen();
    const model = this.#handle!.semanticModel();
    if (!model) return { ok: false, error: 'Semantic model not available' };

    const result = await applySemanticOperation(forwardOp, model, model.session, undefined, {
      replayExpandedEntities: false,
    });
    if (result.ok) {
      this.#windowProjection.clear();
      const revision = model.session.currentRevision;
      this.#emitEvent({ event: 'revisionChanged', data: { revision } });
      return { ok: true, revision };
    }
    return { ok: false, error: result.error };
  }

  async getRevision(): Promise<string | null> {
    if (!this.#handle) return null;
    const model = this.#handle.semanticModel();
    return model?.session.currentRevision ?? null;
  }

  // ---- Internal access (for testing/CLI) ------------------------------------

  /** Direct access to the underlying DocumentHandle (not part of DocumentRuntime). */
  get documentHandle(): DocumentHandle | null {
    return this.#handle;
  }

  // ---- Private --------------------------------------------------------------

  #assertOpen(): void {
    if (!this.#handle) throw new Error('No session open');
  }

  #emitEvent(event: import('./worker-protocol.js').WorkerEventV2): void {
    const handlers = this.#eventHandlers.get(event.event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // Event handler errors must not break the runtime.
      }
    }
  }
}
