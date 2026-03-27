// ---------------------------------------------------------------------------
// Analysis occurrence model — Phase 4B
//
// Structured occurrences emitted from the semantic entity graph. Each
// occurrence references an entity and includes a compact denormalized
// snapshot of key properties, support-status flags, and any diagnostics
// scoped to that entity.
//
// These types are projection-only artifacts — they live outside the entity
// graph and are recomputed on demand from the current model state.
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef, ProjectionRef } from "../../identity/types.js";
import type { EntityKind } from "../../entities/types.js";
import type { Diagnostic } from "../../diagnostics/types.js";

// ---- Occurrence types -------------------------------------------------------

/** A semantic occurrence — one entity's footprint in the analysis output. */
export type SemanticOccurrence = {
  readonly occurrenceId: string;
  readonly docId: string;
  readonly entityRef: EntityRef;
  readonly entityKind: EntityKind;
  readonly entitySubtype: string | undefined;
  readonly storyId: string | undefined;
  readonly partUri: string | undefined;
  /** Full source ref for join with raw-surface analysis (partUri + nodeId + path). */
  readonly sourceRef: SourceRef | undefined;
  readonly supportStatus: SupportStatus;
  readonly text: string | undefined;
  readonly parentOccurrenceId: string | undefined;
  readonly snapshot: Record<string, unknown>;
  readonly diagnostics: readonly Diagnostic[];
};

/**
 * Capability flags indicating the level of support for this entity kind
 * within the current pipeline.
 */
export type SupportStatus = {
  /** Whether the entity is preserved through round-trip (import/export). */
  readonly preserved: boolean;
  /** Whether the entity's semantic properties are read/extracted. */
  readonly semanticRead: boolean;
  /** Whether the entity participates in layout projection. */
  readonly layoutProjected: boolean;
};

// ---- Analysis result --------------------------------------------------------

/** The complete analysis output for a single document. */
export type AnalysisResult = {
  readonly docId: string;
  readonly occurrences: readonly SemanticOccurrence[];
  readonly entityCount: number;
  readonly diagnosticCount: number;
};

// ---- Trace chain entry ------------------------------------------------------

/**
 * A trace entry linking an entity to its source and (optionally) its
 * downstream projection fragment. Used to build end-to-end provenance
 * chains from source XML through to rendered output.
 */
export type TraceEntry = {
  readonly sourceRef: SourceRef;
  readonly entityRef: EntityRef;
  readonly projectionRef?: ProjectionRef;
};
