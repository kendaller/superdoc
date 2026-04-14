// ---------------------------------------------------------------------------
// V2 Paragraph Edit Compiler
//
// Converts the diff between original and edited paragraph text into
// semantic operations. Uses a practical longest-common-prefix/suffix
// strategy to derive the minimal edit.
//
// Fallback ladder:
//   1. Simple insertion/deletion inside a single region → insertText
//   2. Pure newline insertion → splitParagraph
//   3. Unrepresentable edit → explicit rejection
//
// This compiler is intentionally conservative. It only handles the
// safe paragraph class (single editable run, no inline objects).
// ---------------------------------------------------------------------------

import type { SemanticOperation, EntityRef } from '@superdoc/v2-model';

// ---- Public types -----------------------------------------------------------

/** The compiler's output: either a sequence of ops or a rejection. */
export type CompileResult =
  | { readonly ok: true; readonly operations: SemanticOperation[] }
  | { readonly ok: false; readonly reason: string };

/** Input context for the compiler. */
export type CompileInput = {
  /** The entity ref of the paragraph being edited. */
  readonly paragraphRef: EntityRef;
  /** The entity ref of the first (and only) run in the paragraph. */
  readonly runRef: EntityRef;
  /** The original visible text before the edit. */
  readonly originalText: string;
  /** The edited text from the overlay. */
  readonly editedText: string;
};

// ---- ID generation ----------------------------------------------------------

let compilerOpCounter = 0;

function nextOpId(): string {
  return `overlay-edit:${++compilerOpCounter}`;
}

/** Reset the counter (for testing). */
export function resetCompilerOpCounter(): void {
  compilerOpCounter = 0;
}

// ---- Compiler ---------------------------------------------------------------

/**
 * Compile an overlay text edit into semantic operations.
 *
 * The input is a before/after text pair for a single paragraph.
 * The output is a sequence of semantic operations or a rejection.
 */
export function compileParagraphEdit(input: CompileInput): CompileResult {
  const { paragraphRef, runRef, originalText, editedText } = input;

  // No change
  if (originalText === editedText) {
    return { ok: true, operations: [] };
  }

  // Check for paragraph split (newline introduced)
  const newlineIndex = editedText.indexOf('\n');
  if (newlineIndex !== -1) {
    return compileSplit(paragraphRef, originalText, editedText, newlineIndex);
  }

  // Simple text diff — use prefix/suffix matching
  return compileSplice(runRef, originalText, editedText);
}

// ---- Split ------------------------------------------------------------------

function compileSplit(
  paragraphRef: EntityRef,
  originalText: string,
  editedText: string,
  newlineIndex: number,
): CompileResult {
  // Only support a single newline for the MVP
  const secondNewline = editedText.indexOf('\n', newlineIndex + 1);
  if (secondNewline !== -1) {
    return { ok: false, reason: 'Multiple paragraph splits in a single edit are not supported' };
  }

  const textWithoutNewline = `${editedText.substring(0, newlineIndex)}${editedText.substring(newlineIndex + 1)}`;
  if (textWithoutNewline !== originalText) {
    return {
      ok: false,
      reason: 'Paragraph splits with additional text changes are not supported yet',
    };
  }

  return {
    ok: true,
    operations: [
      {
        id: nextOpId(),
        label: 'Split paragraph',
        kind: 'splitParagraph',
        target: paragraphRef,
        at: { runIndex: 0, charOffset: newlineIndex },
      },
    ],
  };
}

// ---- Splice -----------------------------------------------------------------

function compileSplice(runRef: EntityRef, originalText: string, editedText: string): CompileResult {
  const { prefixLength, suffixLength } = findCommonAffixes(originalText, editedText);

  const deleteLength = originalText.length - prefixLength - suffixLength;
  const insertedText = editedText.substring(prefixLength, editedText.length - suffixLength);

  if (deleteLength < 0) {
    return { ok: false, reason: 'Text diff produced an invalid splice range' };
  }

  // Pure insertion
  if (deleteLength === 0 && insertedText.length > 0) {
    return {
      ok: true,
      operations: [
        {
          id: nextOpId(),
          label: 'Insert text',
          kind: 'insertText',
          target: runRef,
          text: insertedText,
          position: { segmentIndex: 0, charOffset: prefixLength },
        },
      ],
    };
  }

  // Pure deletion
  if (insertedText.length === 0 && deleteLength > 0) {
    return {
      ok: true,
      operations: [
        {
          id: nextOpId(),
          label: 'Delete text',
          kind: 'insertText',
          target: runRef,
          text: '',
          deleteLength,
          position: { segmentIndex: 0, charOffset: prefixLength },
        },
      ],
    };
  }

  // Replace (delete + insert as a single splice)
  if (insertedText.length > 0 && deleteLength > 0) {
    return {
      ok: true,
      operations: [
        {
          id: nextOpId(),
          label: 'Replace text',
          kind: 'insertText',
          target: runRef,
          text: insertedText,
          deleteLength,
          position: { segmentIndex: 0, charOffset: prefixLength },
        },
      ],
    };
  }

  return { ok: false, reason: 'Text diff produced no actionable change' };
}

// ---- Common affix detection -------------------------------------------------

/**
 * Find the longest common prefix and suffix between two strings.
 * Ensures they don't overlap (suffix stops where prefix ends).
 */
function findCommonAffixes(a: string, b: string): { prefixLength: number; suffixLength: number } {
  const minLength = Math.min(a.length, b.length);

  // Common prefix
  let prefixLength = 0;
  while (prefixLength < minLength && a[prefixLength] === b[prefixLength]) {
    prefixLength++;
  }

  // Common suffix (must not overlap with prefix)
  let suffixLength = 0;
  const maxSuffix = minLength - prefixLength;
  while (suffixLength < maxSuffix && a[a.length - 1 - suffixLength] === b[b.length - 1 - suffixLength]) {
    suffixLength++;
  }

  return { prefixLength, suffixLength };
}
