// ---------------------------------------------------------------------------
// Mutation engine — the transaction apply pipeline
//
// All durable edits pass through applyTransaction(). The pipeline:
// 1. Validate transaction (base revision, non-empty)
// 2. Snapshot affected parts for rollback
// 3. Apply steps sequentially with pending-ref tracking
// 4. On success: transition parts to "mutated", update dirty state, advance revision
// 5. On failure: rollback all prior steps via snapshot restore
// ---------------------------------------------------------------------------

import type { PackageSession, SessionDiagnostic } from "../types/session.js";
import type {
  MutationTransaction,
  MutationApplyResult,
  MutationApplySuccess,
  MutationApplyFailure,
  MutationStep,
  XmlMutationStep,
  StepEffect,
  MutationRecord,
  SerializableRef,
} from "./types.js";
import { nextRevision } from "../session/revision.js";
import { MutationError } from "./ref-resolver.js";
import { ensureHydratedWithIndex } from "./engine-hydration.js";
import { capturePartSnapshot, restorePartSnapshot } from "./snapshot.js";
import type { PartSnapshot } from "./snapshot.js";
import { applyStep } from "./xml-steps.js";
import { applyPkgStep } from "./pkg-steps.js";

// ---- Session-scoped state (WeakMap to avoid polluting session type) --------

const nodeCounters = new WeakMap<PackageSession, number>();
const recentMutationsMap = new WeakMap<PackageSession, MutationRecord[]>();

const DEFAULT_JOURNAL_CAPACITY = 100;

// ---- Public API -----------------------------------------------------------

/**
 * Apply a mutation transaction to a session.
 *
 * Async because ref resolution may trigger on-demand hydration, which
 * may require async I/O for blob/range-reader sessions.
 */
export async function applyTransaction(
  session: PackageSession,
  transaction: MutationTransaction,
): Promise<MutationApplyResult> {
  // ---- Step 1: Transaction-level validation ----

  const validationError = validateTransaction(session, transaction);
  if (validationError) {
    appendToJournal(session, transaction, validationError);
    return validationError;
  }

  // ---- Step 2: Identify and snapshot affected parts ----

  const affectedUris = collectAffectedPartUris(transaction);
  const snapshots = new Map<string, PartSnapshot>();
  const diagnostics: SessionDiagnostic[] = [];

  try {
    for (const uri of affectedUris) {
      // Package-level steps may target parts that don't exist yet (e.g. pkg.addPart),
      // or parts that are binary. Only snapshot existing XML parts.
      const part = session.parts.get(uri);
      if (part && part.kind === "xml") {
        ensureHydratedWithIndex(part, session);
        snapshots.set(uri, capturePartSnapshot(part));
      }
    }
  } catch (e) {
    const result = errorToFailure(e, transaction);
    appendToJournal(session, transaction, result);
    return result;
  }

  // ---- Step 3: Apply steps sequentially ----

  const pendingRefs = new Map<string, string>();
  const allEffects: StepEffect[] = [];
  const createdRefs: SerializableRef[] = [];
  const invalidatedRefs: SerializableRef[] = [];

  // Capture package-level metadata for rollback
  const pkgSnapshot = capturePackageSnapshot(session);

  try {
    for (let i = 0; i < transaction.steps.length; i++) {
      const step = transaction.steps[i];
      try {
        if (isXmlStep(step)) {
          // ---- XML step dispatch ----
          const { effect, createdNodeId } = applyStep(step, {
            session,
            pendingRefs,
            nextNodeId: () => nextSessionNodeId(session),
          });

          // Register pending ref if step declares one
          if ("assignId" in step && step.assignId && createdNodeId) {
            const label = extractPendingLabel(step.assignId);
            pendingRefs.set(label, createdNodeId);
          }

          allEffects.push(effect);

          // Track created/invalidated refs for the result
          for (const id of effect.createdNodeIds) {
            createdRefs.push({
              kind: "node",
              partUri: step.part.uri,
              nodeId: id,
              stability: "session-generated",
            });
          }
          for (const id of effect.removedNodeIds) {
            invalidatedRefs.push({
              kind: "node",
              partUri: step.part.uri,
              nodeId: id,
              stability: inferStability(id),
            });
          }
        } else {
          // ---- Package step dispatch ----
          const { effect, allocatedRelId } = applyPkgStep(step, {
            session,
            nextNodeId: () => nextSessionNodeId(session),
          });

          // Register allocated relationship ID for intra-transaction reference
          if (
            step.kind === "pkg.addRelationship" &&
            step.assignRelId &&
            allocatedRelId
          ) {
            const label = extractPendingLabel(step.assignRelId);
            pendingRefs.set(label, allocatedRelId);
          }

          allEffects.push(effect);

          // Track relationship refs for pkg.addRelationship / pkg.removeRelationship
          if (step.kind === "pkg.addRelationship" && allocatedRelId) {
            createdRefs.push({
              kind: "relationship",
              ownerUri: step.ownerUri,
              relationshipId: allocatedRelId,
            });
          }
          if (step.kind === "pkg.removeRelationship") {
            invalidatedRefs.push({
              kind: "relationship",
              ownerUri: step.ownerUri,
              relationshipId: step.relationshipId,
            });
          }
        }
      } catch (e) {
        // Step failed — rollback all prior steps
        rollbackSnapshots(session, snapshots);
        restorePackageSnapshot(session, pkgSnapshot);
        const result = errorToFailure(e, transaction, i);
        appendToJournal(session, transaction, result);
        return result;
      }
    }
  } catch (e) {
    rollbackSnapshots(session, snapshots);
    restorePackageSnapshot(session, pkgSnapshot);
    const result = errorToFailure(e, transaction);
    appendToJournal(session, transaction, result);
    return result;
  }

  // ---- Step 4: Commit — transition parts, update dirty state, advance revision ----

  const touchedParts = commitTransaction(session, allEffects, diagnostics);
  const appliedRevision = nextRevision();
  session.currentRevision = appliedRevision;

  const result: MutationApplySuccess = {
    ok: true,
    transactionId: transaction.id,
    baseRevision: transaction.baseRevision,
    appliedRevision,
    diagnostics,
    touchedParts,
    createdRefs,
    invalidatedRefs,
  };

  appendToJournal(session, transaction, result);
  return result;
}

/** Get the recent mutation records for a session (for debugging). */
export function getRecentMutations(session: PackageSession): MutationRecord[] {
  return recentMutationsMap.get(session) ?? [];
}

/** Reset the session-scoped node counter (for testing). */
export function resetNodeCounter(session: PackageSession): void {
  nodeCounters.set(session, 0);
}

// ---- Transaction validation -----------------------------------------------

function validateTransaction(
  session: PackageSession,
  transaction: MutationTransaction,
): MutationApplyFailure | undefined {
  if (transaction.baseRevision !== session.currentRevision) {
    return {
      ok: false,
      transactionId: transaction.id,
      baseRevision: transaction.baseRevision,
      error: "stale-base",
      message: `Base revision "${transaction.baseRevision}" does not match current "${session.currentRevision}"`,
      diagnostics: [],
    };
  }

  if (transaction.steps.length === 0) {
    return {
      ok: false,
      transactionId: transaction.id,
      baseRevision: transaction.baseRevision,
      error: "structural-violation",
      message: "Transaction has no steps",
      diagnostics: [],
    };
  }

  return undefined;
}

// ---- Part collection and commit -------------------------------------------

function collectAffectedPartUris(transaction: MutationTransaction): Set<string> {
  const uris = new Set<string>();
  for (const step of transaction.steps) {
    if (isXmlStep(step)) {
      uris.add(step.part.uri);
    } else {
      // Package-level steps use uri or ownerUri depending on kind
      const uri = getStepTargetUri(step);
      if (uri) uris.add(uri);
    }
  }
  return uris;
}

/** Check if a step is an XML-level step (has a `part` field). */
function isXmlStep(step: MutationStep): step is XmlMutationStep {
  return "part" in step;
}

/** Extract the target URI from a package-level step, if applicable. */
function getStepTargetUri(step: MutationStep): string | undefined {
  switch (step.kind) {
    case "pkg.addPart":
    case "pkg.removePart":
    case "pkg.setPartBytes":
      return step.uri;
    case "pkg.addContentTypeOverride":
    case "pkg.removeContentTypeOverride":
      return step.partUri;
    case "pkg.addRelationship":
    case "pkg.removeRelationship":
      // Relationship steps don't target an XML part for snapshotting;
      // ownerUri "/" is package-level and other ownerUris are rels metadata.
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Commit the transaction by transitioning all touched parts to "mutated" state.
 * Returns the list of touched part URIs.
 */
function commitTransaction(
  session: PackageSession,
  effects: StepEffect[],
  diagnostics: SessionDiagnostic[],
): string[] {
  const touchedPartUris = new Set<string>();
  for (const effect of effects) {
    for (const uri of effect.touchedPartUris) {
      touchedPartUris.add(uri);
    }
  }

  for (const uri of touchedPartUris) {
    const part = session.parts.get(uri);
    if (!part || part.kind !== "xml") continue;

    // Transition to "mutated" state
    if (part.treeState.kind === "fully-hydrated") {
      part.treeState = { kind: "mutated", tree: part.treeState.tree };
      diagnostics.push({
        code: "mutation.full-part-rewrite",
        severity: "warning",
        stage: "structure",
        message: `Part ${uri} transitioned to "mutated" — will be fully serialized on save`,
        partUri: uri,
      });
    }
    // Already mutated stays mutated

    part.dirty = true;
  }

  return [...touchedPartUris];
}

// ---- Rollback -------------------------------------------------------------

function rollbackSnapshots(
  session: PackageSession,
  snapshots: Map<string, PartSnapshot>,
): void {
  for (const [uri, snapshot] of snapshots) {
    const part = session.parts.get(uri);
    if (part && part.kind === "xml") {
      restorePartSnapshot(part, snapshot);
    }
  }
}

// ---- Package-level snapshot/rollback --------------------------------------

/**
 * Captured package-level metadata for rollback.
 * Includes parts map keys, relationships, and content types — enough to
 * undo any package-level step effects on failure.
 */
type PackageSnapshot = {
  partUris: Set<string>;
  packageRelationships: Map<string, import("../types/package.js").RelationshipRecord>;
  partRelationships: Map<string, Map<string, import("../types/package.js").RelationshipRecord>>;
  contentTypeOverrides: Map<string, string>;
};

function capturePackageSnapshot(session: PackageSession): PackageSnapshot {
  return {
    partUris: new Set(session.parts.keys()),
    packageRelationships: new Map(
      [...session.relationships.packageRelationships].map(([k, v]) => [k, { ...v }]),
    ),
    partRelationships: new Map(
      [...session.relationships.partRelationships].map(([partUri, rels]) => [
        partUri,
        new Map([...rels].map(([k, v]) => [k, { ...v }])),
      ]),
    ),
    contentTypeOverrides: new Map(session.contentTypes.overrides),
  };
}

function restorePackageSnapshot(
  session: PackageSession,
  snapshot: PackageSnapshot,
): void {
  // Restore parts: remove any parts added during the transaction
  for (const uri of session.parts.keys()) {
    if (!snapshot.partUris.has(uri)) {
      session.parts.delete(uri);
    }
  }

  // Restore relationships
  session.relationships.packageRelationships = snapshot.packageRelationships;
  session.relationships.partRelationships = snapshot.partRelationships;

  // Restore content type overrides
  session.contentTypes.overrides = snapshot.contentTypeOverrides;
}

// ---- Session-scoped node ID generator -------------------------------------

const SESSION_ID_PREFIX = "s:";

function nextSessionNodeId(session: PackageSession): string {
  const current = nodeCounters.get(session) ?? 0;
  nodeCounters.set(session, current + 1);
  return `${SESSION_ID_PREFIX}${current}`;
}

/** Derive stability from the node ID format. Session-generated IDs start with "s:". */
function inferStability(nodeId: string): "source-anchored" | "session-generated" {
  return nodeId.startsWith(SESSION_ID_PREFIX) ? "session-generated" : "source-anchored";
}

// ---- Pending ref helpers --------------------------------------------------

const PENDING_PREFIX = "pending:";

function extractPendingLabel(assignId: string): string {
  if (assignId.startsWith(PENDING_PREFIX)) {
    return assignId.slice(PENDING_PREFIX.length);
  }
  return assignId;
}

// ---- Journal --------------------------------------------------------------

function appendToJournal(
  session: PackageSession,
  transaction: MutationTransaction,
  result: MutationApplyResult,
): void {
  let journal = recentMutationsMap.get(session);
  if (!journal) {
    journal = [];
    recentMutationsMap.set(session, journal);
  }

  journal.push({
    transaction,
    result,
    committedAt: new Date().toISOString(),
  });

  // Ring buffer: trim to capacity
  if (journal.length > DEFAULT_JOURNAL_CAPACITY) {
    journal.splice(0, journal.length - DEFAULT_JOURNAL_CAPACITY);
  }
}

// ---- Error conversion -----------------------------------------------------

function errorToFailure(
  error: unknown,
  transaction: MutationTransaction,
  stepIndex?: number,
): MutationApplyFailure {
  if (error instanceof MutationError) {
    return {
      ok: false,
      transactionId: transaction.id,
      baseRevision: transaction.baseRevision,
      error: error.errorKind,
      message: error.message,
      failedStepIndex: stepIndex,
      diagnostics: [],
    };
  }

  return {
    ok: false,
    transactionId: transaction.id,
    baseRevision: transaction.baseRevision,
    error: "internal-error",
    message: error instanceof Error ? error.message : String(error),
    failedStepIndex: stepIndex,
    diagnostics: [],
  };
}
