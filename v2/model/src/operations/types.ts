// ---------------------------------------------------------------------------
// Semantic operation type system
//
// Discriminated union of all semantic operations — the high-level editing
// intent vocabulary. Every operation is serializable (JSON-safe) for
// collaboration transport and worker messaging.
//
// Semantic operations are the ONLY path to mutation. No consumer should
// construct MutationStep[] directly — they must go through the compiler.
// ---------------------------------------------------------------------------

import type { EntityRef } from "../identity/types.js";

// ---- Operation base --------------------------------------------------------

/** Base shape shared by all semantic operations. */
type OpBase = {
  /** Unique operation ID for history tracking. */
  readonly id: string;
  /** Human-readable label for UI/debugging. */
  readonly label: string;
};

// ---- Concrete operation types -----------------------------------------------

export type InsertTextOp = OpBase & {
  readonly kind: "insertText";
  /** Run entity ref whose text content to modify. */
  readonly target: EntityRef;
  /** Text to insert at the target position. */
  readonly text: string;
  /**
   * Number of characters to delete starting at `position` before `text` is inserted.
   *
   * `0` means pure insertion. A positive value makes this a splice operation.
   * This keeps the public operation vocabulary small while giving semantic
   * history a precise way to express text undo.
   */
  readonly deleteLength?: number;
  /** Where within the run's text to insert. If omitted, appends to end. */
  readonly position?: { segmentIndex: number; charOffset: number };
};

export type SplitParagraphOp = OpBase & {
  readonly kind: "splitParagraph";
  /** Paragraph entity ref to split. */
  readonly target: EntityRef;
  /** Split point: which run and where within its text. */
  readonly at: { runIndex: number; charOffset: number };
};

export type MergeParagraphsOp = OpBase & {
  readonly kind: "mergeParagraphs";
  /** First paragraph — content is preserved in place. */
  readonly first: EntityRef;
  /** Second paragraph — its runs are appended to `first`, then it is removed. */
  readonly second: EntityRef;
};

export type InsertParagraphOp = OpBase & {
  readonly kind: "insertParagraph";
  /** Insert before or after the reference paragraph. */
  readonly position: "before" | "after";
  /** Existing paragraph to anchor the insertion against. */
  readonly relativeTo: EntityRef;
  /** Optional style reference for the new paragraph. */
  readonly styleId?: string;
};

export type SetParagraphStyleOp = OpBase & {
  readonly kind: "setParagraphStyle";
  /** Paragraph entity ref to restyle. */
  readonly target: EntityRef;
  /** Style ID to apply. Must reference an existing style in the document. */
  readonly styleId: string;
};

export type ToggleBoldOp = OpBase & {
  readonly kind: "toggleBold";
  /** Run entity ref to modify. */
  readonly target: EntityRef;
  /** true = bold, false = not bold. */
  readonly value: boolean;
};

// ---- Discriminated union ----------------------------------------------------

/** Discriminated union of all semantic operations. */
export type SemanticOperation =
  | InsertTextOp
  | SplitParagraphOp
  | MergeParagraphsOp
  | InsertParagraphOp
  | SetParagraphStyleOp
  | ToggleBoldOp;

/** All recognized operation kind strings. */
export type SemanticOperationKind = SemanticOperation["kind"];
