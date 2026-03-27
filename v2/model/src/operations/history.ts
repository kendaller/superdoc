// ---------------------------------------------------------------------------
// Semantic operation history — undo/redo at the semantic level
//
// Records operations at the semantic level so undo reverses editing intent
// (e.g., "undo split paragraph" = merge paragraphs), not arbitrary XML surgery.
//
// Each push records a forward operation and its computed reverse.
// Undo pops from the undo stack and pushes to redo. Redo does the opposite.
// Any new operation clears the redo stack (standard undo/redo contract).
// ---------------------------------------------------------------------------

import type { SemanticOperation } from "./types.js";
import type { SemanticModel } from "../model.js";
import type { Entity } from "../entities/types.js";

// ---- History entry ----------------------------------------------------------

type HistoryEntry = {
  readonly forward: SemanticOperation;
  readonly reverse: SemanticOperation;
};

// ---- SemanticHistory --------------------------------------------------------

/**
 * Semantic-level undo/redo journal.
 *
 * Records operations at the semantic level for meaningful undo.
 * Each entry carries both the forward operation (what was done)
 * and its reverse (what to do on undo).
 */
export class SemanticHistory {
  private readonly _undoStack: HistoryEntry[] = [];
  private readonly _redoStack: HistoryEntry[] = [];
  private readonly _maxEntries: number;

  constructor(maxEntries = 100) {
    this._maxEntries = maxEntries;
  }

  /**
   * Record a successfully applied operation with its reverse.
   * Clears the redo stack (new operations invalidate redo history).
   */
  push(forward: SemanticOperation, reverse: SemanticOperation): void {
    this._undoStack.push({ forward, reverse });

    // New operation invalidates all redo entries.
    this._redoStack.length = 0;

    // Enforce capacity — drop the oldest entry.
    if (this._undoStack.length > this._maxEntries) {
      this._undoStack.shift();
    }
  }

  /**
   * Get the operation to undo (returns the reverse op).
   * Moves the entry to the redo stack.
   * Returns undefined if nothing to undo.
   */
  undo(): SemanticOperation | undefined {
    const entry = this._undoStack.pop();
    if (!entry) return undefined;
    this._redoStack.push(entry);
    return entry.reverse;
  }

  /**
   * Get the operation to redo (returns the forward op).
   * Moves the entry back to the undo stack.
   * Returns undefined if nothing to redo.
   */
  redo(): SemanticOperation | undefined {
    const entry = this._redoStack.pop();
    if (!entry) return undefined;
    this._undoStack.push(entry);
    return entry.forward;
  }

  /** Whether undo is available. */
  canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  /** Whether redo is available. */
  canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /** Number of operations that can be undone. */
  undoDepth(): number {
    return this._undoStack.length;
  }

  /** Number of operations that can be redone. */
  redoDepth(): number {
    return this._redoStack.length;
  }

  /** Clear all history. */
  clear(): void {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
  }
}

// ---- Reverse operation computation ------------------------------------------

/**
 * Snapshot of pre-operation state needed to compute accurate reverse ops.
 *
 * Callers capture this BEFORE the operation is applied so the reverse
 * operation can restore the original state (e.g., the old styleId for
 * setParagraphStyle, the old bold value for toggleBold).
 */
export type PreOpSnapshot = {
  /** Previous styleId for setParagraphStyle. */
  oldStyleId?: string;
  /** Previous bold value for toggleBold. */
  oldBoldValue?: boolean;
  /** Run count and split position for mergeParagraphs undo. */
  firstParagraphRunCount?: number;
};

/** Post-apply facts needed to finalize an accurate reverse operation. */
export type PostOpSnapshot = {
  /** Paragraph created by splitParagraph or insertParagraph, resolved after rebuild. */
  createdParagraphRef?: import("../identity/types.js").EntityRef;
};

/**
 * Capture the pre-operation state snapshot needed for computing the reverse.
 *
 * Must be called BEFORE the operation is applied and the model is rebuilt.
 */
export function capturePreOpSnapshot(
  op: SemanticOperation,
  model: SemanticModel,
): PreOpSnapshot {
  const snapshot: PreOpSnapshot = {};

  switch (op.kind) {
    case "setParagraphStyle": {
      const entity = model.entity(op.target);
      if (entity?.kind === "paragraph") {
        const para = entity as Entity<"paragraph">;
        snapshot.oldStyleId = para.raw().styleId ?? "";
      }
      break;
    }
    case "toggleBold": {
      const entity = model.entity(op.target);
      if (entity?.kind === "run") {
        const run = entity as Entity<"run">;
        snapshot.oldBoldValue = run.raw().formatting.bold ?? false;
      }
      break;
    }
    case "mergeParagraphs": {
      const first = model.entity(op.first);
      if (first?.kind === "paragraph") {
        const runs = model.runs(op.first);
        snapshot.firstParagraphRunCount = runs.length;
      }
      break;
    }
  }

  return snapshot;
}

/**
 * Compute the reverse of a semantic operation.
 *
 * Used by the apply function to automatically build the undo entry.
 * Each operation kind has a natural inverse:
 * - insertText   -> insertText with original text restored at same position
 * - splitParagraph -> mergeParagraphs
 * - mergeParagraphs -> splitParagraph (with stored split position)
 * - insertParagraph -> removeParagraph (modeled as mergeParagraphs)
 * - setParagraphStyle -> setParagraphStyle with old styleId
 * - toggleBold -> toggleBold with opposite value
 */
export function computeReverse(
  op: SemanticOperation,
  snapshot: PreOpSnapshot,
  postApply?: PostOpSnapshot,
): SemanticOperation {
  const reverseId = `reverse:${op.id}`;
  const reverseLabel = `Undo: ${op.label}`;

  switch (op.kind) {
    case "insertText":
      // Reverse the splice by deleting the exact text that was inserted.
      return {
        id: reverseId,
        label: reverseLabel,
        kind: "insertText",
        target: op.target,
        text: "",
        deleteLength: op.text.length,
        position: op.position,
      };

    case "splitParagraph":
      // Reverse: merge the two paragraphs back together.
      return {
        id: reverseId,
        label: reverseLabel,
        kind: "mergeParagraphs",
        first: op.target,
        second: postApply?.createdParagraphRef ?? op.target,
      };

    case "mergeParagraphs":
      // Reverse: split the first paragraph at the boundary where the
      // second paragraph's content was appended.
      return {
        id: reverseId,
        label: reverseLabel,
        kind: "splitParagraph",
        target: op.first,
        at: {
          runIndex: snapshot.firstParagraphRunCount ?? 0,
          charOffset: 0,
        },
      };

    case "insertParagraph":
      // Reverse: remove the inserted paragraph by merging it away.
      // The exact ref of the created paragraph is filled in by the apply function
      // once it knows which paragraph was created.
      return {
        id: reverseId,
        label: reverseLabel,
        kind: "mergeParagraphs",
        first: op.relativeTo,
        second: postApply?.createdParagraphRef ?? op.relativeTo,
      };

    case "setParagraphStyle":
      return {
        id: reverseId,
        label: reverseLabel,
        kind: "setParagraphStyle",
        target: op.target,
        styleId: snapshot.oldStyleId ?? "",
      };

    case "toggleBold":
      return {
        id: reverseId,
        label: reverseLabel,
        kind: "toggleBold",
        target: op.target,
        value: snapshot.oldBoldValue ?? false,
      };
  }
}
