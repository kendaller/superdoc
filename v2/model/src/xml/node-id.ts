// ---------------------------------------------------------------------------
// Deterministic node ID generation
//
// Imported nodes get IDs derived from: part URI + node kind + source span.
// This ensures stable IDs for untouched content across re-imports.
// ---------------------------------------------------------------------------

import type { SourceSpan } from "../types/xml.js";

/** Generate a deterministic node ID from part URI and source position. */
export function makeNodeId(
  partUri: string,
  kind: string,
  span: SourceSpan,
): string {
  return `${partUri}:${kind}:${span.startByte}-${span.endByte}`;
}

/** Generate a node ID for attributes and namespace declarations. */
export function makeSubNodeId(
  parentId: string,
  kind: string,
  index: number,
): string {
  return `${parentId}:${kind}:${index}`;
}

let syntheticCounter = 0;

/** Generate a session-unique ID for newly created or synthesized nodes. */
export function makeSyntheticId(kind: string): string {
  return `synth:${kind}:${syntheticCounter++}`;
}

/** Reset synthetic counter (for testing). */
export function resetSyntheticCounter(): void {
  syntheticCounter = 0;
}
