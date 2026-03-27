// ---------------------------------------------------------------------------
// Structured diagnostics for the semantic model
//
// Diagnostics are not ad-hoc strings — they are structured records with
// machine-readable codes that corpus tooling can aggregate. Every malformation,
// broken reference, or unsupported feature is surfaced through this system.
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef } from "../identity/types.js";

// ---- Diagnostic codes -------------------------------------------------------

/** Machine-readable diagnostic code families. */
export type DiagnosticCode =
  // Malformed OOXML
  | "MALFORMED_RANGE_UNMATCHED"
  | "MALFORMED_RANGE_OVERLAPPING"
  | "MALFORMED_DUPLICATE_ID"
  // Missing references
  | "MISSING_RELATIONSHIP_TARGET"
  | "MISSING_NOTE_BODY"
  | "MISSING_STYLE_REFERENCE"
  | "MISSING_NUMBERING_REFERENCE"
  // Broken persisted references
  | "BROKEN_PERSISTED_REF"
  // Preservation / unsupported features
  | "UNSUPPORTED_ELEMENT_PRESERVED"
  | "UNSUPPORTED_PART_PRESERVED"
  | "UNSUPPORTED_RELATIONSHIP_PRESERVED"
  // Structural issues
  | "INVALID_NESTING"
  | "EMPTY_BODY"
  // Graph construction
  | "GRAPH_CONSTRUCTION_ERROR"
  // Extraction
  | "EXTRACTION_ERROR"
  // Generic
  | "INTERNAL_ERROR";

export type DiagnosticSeverity = "error" | "warning" | "info";

// ---- Diagnostic scopes ------------------------------------------------------

export type DiagnosticScope =
  | { kind: "session" }
  | { kind: "part"; partUri: string }
  | { kind: "entity"; entityRef: EntityRef }
  | { kind: "source"; sourceRef: SourceRef }
  | { kind: "projection"; projectionId: string };

// ---- Diagnostic record ------------------------------------------------------

export type Diagnostic = {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly scope: DiagnosticScope;
  readonly message: string;
  readonly payload?: Record<string, unknown>;
};

// ---- Scope constructors -----------------------------------------------------

export function sessionScope(): DiagnosticScope {
  return { kind: "session" };
}

export function partScope(partUri: string): DiagnosticScope {
  return { kind: "part", partUri };
}

export function entityScope(entityRef: EntityRef): DiagnosticScope {
  return { kind: "entity", entityRef };
}

export function sourceScope(sourceRef: SourceRef): DiagnosticScope {
  return { kind: "source", sourceRef };
}
