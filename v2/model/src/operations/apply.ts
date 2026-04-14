// ---------------------------------------------------------------------------
// Semantic operation apply function
//
// The single entry point for executing semantic operations. All document
// mutations flow through this pipeline:
//
//   1. Capture pre-op state (for reverse computation)
//   2. Compile to primitive mutation steps
//   3. Validate intent-preservation rules
//   4. Apply the primitive transaction via the mutation engine
//   5. Record in semantic history (if provided)
//   6. Rebuild the model from the mutated session state
//
// No consumer should bypass this function to apply primitive steps directly.
// ---------------------------------------------------------------------------

import type { SemanticOperation } from './types.js';
import type { SemanticModel } from '../model.js';
import type { PackageSession } from '../types/session.js';
import type { MutationApplyResult, NodeRef } from '../mutations/types.js';
import type { IntentViolation } from './validate.js';
import type { EntityRef } from '../identity/types.js';
import { compileOperation } from './compile.js';
import { validateIntentPreservation } from './validate.js';
import { SemanticHistory, capturePreOpSnapshot, computeReverse } from './history.js';
import { applyTransaction } from '../mutations/engine.js';
import { createSourceRef } from '../identity/types.js';

// ---- Result type ------------------------------------------------------------

/** Outcome of applying a semantic operation. */
export type SemanticOperationResult = {
  /** Whether the operation was applied successfully. */
  readonly ok: boolean;
  /** The operation that was attempted. */
  readonly op: SemanticOperation;
  /** Primitive transaction result (present when the transaction was submitted). */
  readonly primitiveResult?: MutationApplyResult;
  /** Intent-preservation violations (present when validation fails). */
  readonly violations?: readonly IntentViolation[];
  /** Error message (present when ok is false). */
  readonly error?: string;
};

// ---- Transaction ID generator -----------------------------------------------

let operationCounter = 0;

/** Generate a unique transaction ID for semantic operations. */
function nextTransactionId(): string {
  return `sem-tx-${++operationCounter}`;
}

/** Reset the transaction ID counter (for testing). */
export function resetOperationCounter(): void {
  operationCounter = 0;
}

// ---- Public API -------------------------------------------------------------

/**
 * Apply a semantic operation to the model.
 *
 * This is the canonical mutation entry point. The pipeline:
 * 1. Capture pre-op state for history (before the model changes)
 * 2. Compile to primitive mutation steps
 * 3. Validate intent-preservation rules (abort on violations)
 * 4. Apply the primitive transaction via the mutation engine
 * 5. Record in semantic history (forward + reverse ops)
 * 6. Rebuild the model from the mutated session state
 *
 * @param op - The semantic operation to apply.
 * @param model - The current semantic model (will be rebuilt on success).
 * @param session - The package session to mutate.
 * @param history - Optional semantic history for undo/redo tracking.
 * @returns A result indicating success/failure with diagnostics.
 */
export async function applySemanticOperation(
  op: SemanticOperation,
  model: SemanticModel,
  session: PackageSession,
  history?: SemanticHistory,
  options?: { replayExpandedEntities?: boolean },
): Promise<SemanticOperationResult> {
  // ---- Step 1: Capture pre-op state ----
  const preOpSnapshot = capturePreOpSnapshot(op, model);

  // ---- Step 2: Compile to primitive steps ----
  let steps;
  try {
    steps = compileOperation(op, model);
  } catch (e) {
    return {
      ok: false,
      op,
      error: `Compilation failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (steps.length === 0) {
    return {
      ok: false,
      op,
      error: 'Compilation produced zero steps — nothing to apply',
    };
  }

  // ---- Step 3: Validate intent preservation ----
  const violations = validateIntentPreservation(op, steps);
  if (violations.length > 0) {
    return {
      ok: false,
      op,
      violations,
      error: `Intent-preservation violated: ${violations.map((v) => v.rule).join(', ')}`,
    };
  }

  // ---- Step 4: Apply primitive transaction ----
  const txResult = await applyTransaction(session, {
    id: nextTransactionId(),
    baseRevision: session.currentRevision,
    origin: { kind: 'local', source: 'semantic-operation' },
    metadata: {
      label: op.label,
      userFacing: true,
      mergeGroup: op.kind,
    },
    steps,
  });

  if (!txResult.ok) {
    return {
      ok: false,
      op,
      primitiveResult: txResult,
      error: `Transaction failed: ${txResult.message}`,
    };
  }

  // ---- Step 5: Rebuild the model ----
  model.rebuild({
    replayExpandedEntities: options?.replayExpandedEntities,
  });

  // ---- Step 6: Record in history ----
  if (history) {
    const reverse = computeReverse(op, preOpSnapshot, {
      createdParagraphRef: resolveCreatedParagraphRef(op, txResult, model),
    });
    history.push(op, reverse);
  }

  return {
    ok: true,
    op,
    primitiveResult: txResult,
  };
}

function resolveCreatedParagraphRef(
  op: SemanticOperation,
  txResult: Extract<MutationApplyResult, { ok: true }>,
  model: SemanticModel,
): EntityRef | undefined {
  if (op.kind !== 'insertParagraph' && op.kind !== 'splitParagraph') {
    return undefined;
  }

  for (const createdRef of txResult.createdRefs) {
    if (createdRef.kind !== 'node') {
      continue;
    }

    const paragraph = resolveParagraphEntityFromCreatedNode(createdRef, model);
    if (paragraph) {
      return paragraph.ref;
    }
  }

  return undefined;
}

function resolveParagraphEntityFromCreatedNode(createdNode: NodeRef, model: SemanticModel) {
  const entity = model.entityBySourceRef(createSourceRef(createdNode.partUri, createdNode.nodeId));
  return entity?.kind === 'paragraph' ? entity : undefined;
}
