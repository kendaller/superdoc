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
import type { DocumentRuntime, RuntimeEventHandler } from './runtime-interface.js';
import type { TaskId, EnrichmentTarget, ProjectWindowParams, WindowContinuation } from './worker-protocol.js';
import { open } from '../session/open.js';
import { WindowProjectionController } from './window-projection-controller.js';

export class InProcessRuntimeV2 implements DocumentRuntime {
  #handle: DocumentHandle | null = null;
  #eventHandlers = new Map<string, Set<RuntimeEventHandler>>();
  #windowProjection = new WindowProjectionController();

  // ---- Lifecycle ------------------------------------------------------------

  async openSource(source: Uint8Array | Blob | ArchiveByteSource): Promise<{ sessionId: string }> {
    // Close previous session if any
    if (this.#handle) {
      await this.#handle.close();
      this.#handle = null;
    }
    this.#windowProjection.clear();

    this.#handle = await open(source);
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

  async projectWindow(params: ProjectWindowParams): Promise<WindowedProjectionResult> {
    this.#assertOpen();
    return this.#windowProjection.projectWindow(this.#handle!, params);
  }

  async projectNextWindow(continuation: WindowContinuation): Promise<WindowedProjectionResult> {
    this.#assertOpen();
    return this.#windowProjection.projectNextWindow(this.#handle!, continuation);
  }

  async prefetchWindow(params: { startBodyChildIndex: number; maxBodyChildCount: number }): Promise<void> {
    this.#assertOpen();
    this.#windowProjection.prefetchWindow(this.#handle!, params);
  }

  async advanceStructure(): Promise<void> {
    this.#assertOpen();
    await this.#handle!.ready('structure');
  }

  async enrich(_target: EnrichmentTarget): Promise<unknown> {
    throw new Error('enrich not yet implemented — requires workstream 06');
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

  // ---- Internal access (for testing/CLI) ------------------------------------

  /** Direct access to the underlying DocumentHandle (not part of DocumentRuntime). */
  get documentHandle(): DocumentHandle | null {
    return this.#handle;
  }

  // ---- Private --------------------------------------------------------------

  #assertOpen(): void {
    if (!this.#handle) throw new Error('No session open');
  }
}
