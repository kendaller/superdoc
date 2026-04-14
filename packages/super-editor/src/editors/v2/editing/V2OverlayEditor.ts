// ---------------------------------------------------------------------------
// V2 Overlay Editor
//
// Manages the lifecycle of an overlay text editor anchored to a rendered
// v2 paragraph. This is the browser-editing MVP surface.
//
// Flow:
//   1. User clicks a paragraph → block target resolved
//   2. Overlay activates over the paragraph bounds
//   3. User edits text in the overlay
//   4. On commit: diff → compile → apply semantic ops → rerender
//   5. Overlay closes, focus returns to host
//
// Safety policy: only activates on single-run paragraphs with no
// inline objects. Complex paragraphs reject with a clear message.
// ---------------------------------------------------------------------------

import type {
  EntityRef,
  SemanticModel,
  SemanticOperation,
  SemanticOperationResult,
  SourceRef,
} from '@superdoc/v2-model';
import { segmentsToText } from '@superdoc/v2-model';
import type { V2BlockTarget } from '../interaction/types.js';
import type { V2EditingController } from '../runtime/V2EditingController.js';
import { compileParagraphEdit, type CompileResult } from './V2ParagraphEditCompiler.js';

// ---- Types ------------------------------------------------------------------

/** State of the overlay editor. */
export type OverlayState =
  | { readonly kind: 'inactive' }
  | { readonly kind: 'active'; readonly edit: ActiveOverlayEdit }
  | { readonly kind: 'committing' };

/** Data for an active overlay editing session. */
export type ActiveOverlayEdit = {
  readonly blockId: string;
  readonly entityRef: EntityRef;
  readonly paragraphRef: EntityRef;
  readonly runRef: EntityRef;
  readonly paragraphSourceRef: SourceRef;
  readonly runSourceRef: SourceRef;
  readonly originalText: string;
  draftText: string;
  readonly rect: DOMRect;
};

/** Result of attempting to commit an overlay edit. */
export type CommitResult =
  | { readonly ok: true; readonly results: SemanticOperationResult[] }
  | { readonly ok: false; readonly reason: string };

/** Result of attempting to activate the overlay. */
export type ActivationResult =
  | { readonly ok: true; readonly edit: ActiveOverlayEdit }
  | { readonly ok: false; readonly reason: string };

export type OverlayOperationContext = {
  readonly edit: ActiveOverlayEdit;
};

export type OverlayOperationExecutor = (
  operation: SemanticOperation,
  context: OverlayOperationContext,
) => Promise<SemanticOperationResult>;

// ---- Controller -------------------------------------------------------------

/**
 * Orchestrates overlay-based paragraph editing for the v2 MVP.
 *
 * Usage:
 * ```ts
 * const overlay = new V2OverlayEditor(controller, model);
 * const activation = overlay.activate(blockTarget);
 * if (activation.ok) {
 *   // mount overlay UI, let user edit...
 *   overlay.updateDraft(newText);
 *   const result = await overlay.commit();
 * }
 * ```
 */
export class V2OverlayEditor {
  readonly #controller: V2EditingController;
  readonly #executeOperation: OverlayOperationExecutor;
  #state: OverlayState = { kind: 'inactive' };

  constructor(controller: V2EditingController, executeOperation?: OverlayOperationExecutor) {
    this.#controller = controller;
    this.#executeOperation = executeOperation ?? ((operation) => this.#controller.applyOperation(operation));
  }

  /** Current overlay state. */
  get state(): OverlayState {
    return this.#state;
  }

  /** Whether an overlay is currently active. */
  get isActive(): boolean {
    return this.#state.kind === 'active';
  }

  /**
   * Attempt to activate overlay editing on a block target.
   *
   * Returns a rejection if the paragraph is not in the safe editing class
   * (single text run, no inline objects).
   */
  activate(target: V2BlockTarget): ActivationResult {
    if (target.editableKind !== 'paragraph') {
      return { ok: false, reason: `Cannot overlay-edit a ${target.editableKind} block` };
    }

    const model = this.#controller.semanticModel;
    if (!model) {
      return { ok: false, reason: 'No active semantic model' };
    }

    const safety = checkParagraphSafety(model, target.entityRef);
    if (!safety.ok) {
      return safety;
    }

    const paragraph = model.entity(target.entityRef);
    if (!paragraph?.sourceRefs[0]) {
      return { ok: false, reason: 'Paragraph has no source reference' };
    }

    const { runRef, runSourceRef, text } = safety;

    const edit: ActiveOverlayEdit = {
      blockId: target.blockId,
      entityRef: target.entityRef,
      paragraphRef: target.entityRef,
      runRef,
      paragraphSourceRef: paragraph.sourceRefs[0],
      runSourceRef,
      originalText: text,
      draftText: text,
      rect: target.rect ?? new DOMRect(0, 0, 0, 0),
    };

    this.#state = { kind: 'active', edit };
    return { ok: true, edit };
  }

  /** Update the draft text while the overlay is active. */
  updateDraft(text: string): void {
    if (this.#state.kind !== 'active') return;
    this.#state.edit.draftText = text;
  }

  /**
   * Commit the current overlay edit.
   *
   * Compiles the text diff into semantic operations and applies them
   * through the editing controller. On success, the overlay closes
   * and the host rerenders from the mutated model.
   */
  async commit(): Promise<CommitResult> {
    if (this.#state.kind !== 'active') {
      return { ok: false, reason: 'No active overlay edit to commit' };
    }

    const { edit } = this.#state;
    this.#state = { kind: 'committing' };

    const compiled = compileParagraphEdit({
      paragraphRef: edit.paragraphRef,
      runRef: edit.runRef,
      originalText: edit.originalText,
      editedText: edit.draftText,
    });

    if (!compiled.ok) {
      this.#state = { kind: 'active', edit };
      return { ok: false, reason: compiled.reason };
    }

    if (compiled.operations.length === 0) {
      this.#state = { kind: 'inactive' };
      return { ok: true, results: [] };
    }

    const results: SemanticOperationResult[] = [];

    for (const op of compiled.operations) {
      const result = await this.#executeOperation(op, { edit });
      results.push(result);

      if (!result.ok) {
        this.#state = { kind: 'active', edit };
        return {
          ok: false,
          reason: `Operation failed: ${result.error ?? 'unknown error'}`,
        };
      }
    }

    this.#state = { kind: 'inactive' };
    return { ok: true, results };
  }

  /** Cancel the current overlay edit without committing. */
  cancel(): void {
    this.#state = { kind: 'inactive' };
  }
}

// ---- Safety checks ----------------------------------------------------------

type SafetyResult =
  | { readonly ok: true; readonly runRef: EntityRef; readonly runSourceRef: SourceRef; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Check whether a paragraph is in the safe editing class for overlay editing.
 *
 * Safe paragraphs have:
 * - exactly one run
 * - only text/tab/break segments (no inline objects, fields, drawings)
 */
function checkParagraphSafety(model: SemanticModel, paragraphRef: EntityRef): SafetyResult {
  const runs = model.runs(paragraphRef);

  if (runs.length === 0) {
    return { ok: false, reason: 'Paragraph has no runs' };
  }

  if (runs.length > 1) {
    return {
      ok: false,
      reason: 'Paragraph has multiple runs — overlay editing is limited to single-run paragraphs',
    };
  }

  const run = runs[0];
  const runSourceRef = run.sourceRefs[0];
  if (!runSourceRef) {
    return { ok: false, reason: 'Run has no source reference' };
  }
  const segments = model.segments(run.ref);

  for (const segment of segments) {
    if (!isSafeSegmentKind(segment.segmentKind)) {
      return {
        ok: false,
        reason: `Paragraph contains unsupported inline content: ${segment.segmentKind}`,
      };
    }
  }

  const text = segmentsToText(segments);

  return { ok: true, runRef: run.ref, runSourceRef, text };
}

/** Segment kinds that are safe for plain-text overlay editing. */
function isSafeSegmentKind(kind: string): boolean {
  return kind === 'text' || kind === 'tab' || kind === 'break';
}
