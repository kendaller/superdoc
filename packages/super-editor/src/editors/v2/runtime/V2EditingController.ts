// ---------------------------------------------------------------------------
// V2 Editing Controller
//
// The single product-facing entry point for mutating a v2 document.
// Owns:
//   - mutation execution via applySemanticOperation
//   - semantic history (undo/redo)
//   - revision tracking (from live PackageSession)
//   - document-api execution for supported operations
//   - save (delegates to document handle)
//   - change notifications to hosts/UI
//
// This controller is host-agnostic. It does not know about rendering,
// layout, DOM, or any host-specific concerns. Hosts bind to it and
// listen for change events.
// ---------------------------------------------------------------------------

import { applySemanticOperation, SemanticHistory, DocumentApiAdapter, SemanticModel } from '@superdoc/v2-model';
import type {
  SemanticOperation,
  SemanticOperationResult,
  PackageSession,
  EntityRef,
  SaveOptions,
  SaveResult,
} from '@superdoc/v2-model';
import { V2DocumentRuntime, type V2DocumentSource } from './V2DocumentRuntime.js';

// ---- Event types ------------------------------------------------------------

/** Payload emitted after every successful mutation. */
export type V2MutationCommittedEvent = {
  readonly operation: SemanticOperation;
  readonly result: SemanticOperationResult;
  readonly revision: string;
  readonly invalidation: V2InvalidationHint;
};

/** Hint describing what region of the document was affected. */
export type V2InvalidationHint = {
  readonly kind: 'full-document' | 'from-block' | 'from-entity';
  readonly blockId?: string;
  readonly entityRef?: EntityRef;
};

/** Result for operations that produce no change. */
export type NoopResult = { readonly noop: true; readonly reason: string };

/** Result for operations not supported by the v2 backend. */
export type UnsupportedResult = { readonly unsupported: true; readonly operationKey: string };

/** Union of all possible invoke results. */
export type InvokeResult = SemanticOperationResult | UnsupportedResult;

/** Controller event names. */
export type V2ControllerEvent = 'changed' | 'error' | 'saved';

type EventHandlers = {
  changed: (event: V2MutationCommittedEvent) => void;
  error: (error: Error) => void;
  saved: () => void;
};

// ---- Controller -------------------------------------------------------------

/**
 * Host-agnostic editing controller for the v2 document model.
 *
 * Usage:
 * ```ts
 * const controller = new V2EditingController();
 * await controller.initialize(source);
 * const result = await controller.applyOperation(op);
 * const bytes = await controller.save();
 * ```
 */
export class V2EditingController {
  readonly #runtime = new V2DocumentRuntime();
  readonly #history = new SemanticHistory();
  readonly #listeners = new Map<V2ControllerEvent, Set<Function>>();
  #savedUndoDepth = 0;

  // ---- Lifecycle ------------------------------------------------------------

  async initialize(source: V2DocumentSource): Promise<void> {
    this.#history.clear();
    this.#savedUndoDepth = 0;
    await this.#runtime.initialize(source);

    // Verify the model (and thus session) is accessible.
    const model = this.#runtime.semanticModel;
    if (!model) {
      throw new Error('[V2EditingController] Runtime did not produce a semantic model');
    }
  }

  async close(): Promise<void> {
    this.#history.clear();
    this.#savedUndoDepth = 0;
    await this.#runtime.close();
    this.#listeners.clear();
  }

  /** Whether the controller has an active document. */
  isActive(): boolean {
    return this.#runtime.isActive();
  }

  // ---- Mutation execution ---------------------------------------------------

  /**
   * Apply a semantic operation to the live document.
   *
   * On success: model rebuilds, history records, revision advances,
   * and `changed` event fires.
   */
  async applyOperation(op: SemanticOperation): Promise<SemanticOperationResult> {
    const { model, session } = this.#requireActive();
    console.debug('[V2EditingController] Applying operation', {
      kind: op.kind,
      target: 'target' in op ? op.target : undefined,
    });

    const result = await applySemanticOperation(op, model, session, this.#history);
    console.debug('[V2EditingController] Operation completed', {
      kind: op.kind,
      ok: result.ok,
      error: result.ok ? null : result.error,
      revision: this.revision,
    });

    if (result.ok) {
      this.#emitChanged(op, result);
    }

    return result;
  }

  /**
   * Execute a document-api operation by key.
   *
   * Translates the operation to a semantic operation and applies it.
   * Returns `UnsupportedResult` for operations not yet supported.
   */
  async invoke(operationKey: string, args: Record<string, unknown>): Promise<InvokeResult> {
    const { model } = this.#requireActive();

    const adapter = new DocumentApiAdapter(model);
    const semanticOp = adapter.translate(operationKey, args);

    if (!semanticOp) {
      return { unsupported: true, operationKey };
    }

    return this.applyOperation(semanticOp);
  }

  // ---- Undo / Redo ----------------------------------------------------------

  async undo(): Promise<SemanticOperationResult | NoopResult> {
    const reverseOp = this.#history.undo();
    if (!reverseOp) {
      return { noop: true, reason: 'Nothing to undo' };
    }

    // Apply the reverse op WITHOUT recording it in history again.
    // History already moved the entry to the redo stack.
    const { model, session } = this.#requireActive();
    const result = await applySemanticOperation(reverseOp, model, session);

    if (result.ok) {
      this.#emitChanged(reverseOp, result);
    }

    return result;
  }

  async redo(): Promise<SemanticOperationResult | NoopResult> {
    const forwardOp = this.#history.redo();
    if (!forwardOp) {
      return { noop: true, reason: 'Nothing to redo' };
    }

    // Apply without recording — history already moved entry back.
    const { model, session } = this.#requireActive();
    const result = await applySemanticOperation(forwardOp, model, session);

    if (result.ok) {
      this.#emitChanged(forwardOp, result);
    }

    return result;
  }

  get canUndo(): boolean {
    return this.#history.canUndo();
  }

  get canRedo(): boolean {
    return this.#history.canRedo();
  }

  // ---- Save -----------------------------------------------------------------

  async save(options?: SaveOptions): Promise<SaveResult> {
    const handle = this.#runtime.documentHandle;
    if (!handle) {
      throw new Error('[V2EditingController] Cannot save — no active document');
    }

    const result = await handle.save(options);
    this.#savedUndoDepth = this.#history.undoDepth();
    this.#emit('saved');
    return result;
  }

  // ---- Inspection -----------------------------------------------------------

  /** Current session revision. Null before initialization. */
  get revision(): string | null {
    const model = this.#runtime.semanticModel;
    if (!model || !(model instanceof SemanticModel)) return null;
    return model.session.currentRevision;
  }

  /** The underlying semantic model. Null before initialization. */
  get semanticModel(): SemanticModel | null {
    return this.#runtime.semanticModel;
  }

  /** The underlying document handle. Null before initialization. */
  get documentHandle() {
    return this.#runtime.documentHandle;
  }

  /** The underlying runtime. */
  get runtime(): V2DocumentRuntime {
    return this.#runtime;
  }

  /** Whether the document has unsaved mutations. */
  get isDirty(): boolean {
    return this.#history.undoDepth() !== this.#savedUndoDepth;
  }

  /** List of document-api operations supported by the v2 backend. */
  supportedOperations(): string[] {
    const model = this.#runtime.semanticModel;
    if (!model) return [];
    return new DocumentApiAdapter(model).supportedOperations();
  }

  // ---- Events ---------------------------------------------------------------

  on<E extends V2ControllerEvent>(event: E, handler: EventHandlers[E]): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  // ---- Private helpers ------------------------------------------------------

  #requireActive(): { model: SemanticModel; session: PackageSession } {
    const model = this.#runtime.semanticModel;
    if (!model || !(model instanceof SemanticModel)) {
      throw new Error('[V2EditingController] No active document — call initialize() first');
    }
    return { model, session: model.session };
  }

  #emitChanged(op: SemanticOperation, result: SemanticOperationResult): void {
    const { session } = this.#requireActive();
    const event: V2MutationCommittedEvent = {
      operation: op,
      result,
      revision: session.currentRevision,
      invalidation: { kind: 'full-document' },
    };
    this.#emit('changed', event);
  }

  #emit(event: V2ControllerEvent, payload?: unknown): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch {
        // Listener errors must not break the controller.
      }
    }
  }
}
