// ---------------------------------------------------------------------------
// Stable block ID allocator for layout projection
//
// Produces deterministic IDs derived from source-backed anchors (partUri +
// nodeId) rather than sequential counters. This guarantees that the same
// source element always produces the same block ID regardless of:
//   - which projection path is used (render-shell vs semantic-model)
//   - which window the element falls in (first-window vs append-window)
//   - whether the projection is partial or whole-document
// ---------------------------------------------------------------------------

import type { SourceAnchor } from './source-anchor.js';
import { stableSourceToken } from './source-anchor.js';

/**
 * Stable block ID allocator.
 *
 * - `blockId()` — for top-level FlowBlocks. Records the source anchor in
 *   the trace map (`blockToSourceRef`).
 * - `subBlockId()` — for internal artifacts (table rows, table cells).
 *   Same deterministic formula, no trace recording.
 */
export type StableIdAllocator = {
  /** Generate a stable block ID and record it in the trace map. */
  blockId(kind: string, anchor: SourceAnchor): string;

  /** Generate a stable sub-block ID (no trace recording). */
  subBlockId(kind: string, anchor: SourceAnchor): string;

  /** Accumulated block-to-source-anchor map for the projection result. */
  readonly blockToSourceRef: ReadonlyMap<string, SourceAnchor>;
};

/**
 * Build a deterministic block ID from a source anchor.
 *
 * The default output is `b-${stableSourceToken(anchor)}-${kind}`. Callers may
 * optionally prepend a custom prefix when they need to namespace a projection.
 */
export function makeStableBlockId(kind: string, anchor: SourceAnchor, prefix: string = ''): string {
  return `${prefix}b-${stableSourceToken(anchor)}-${kind}`;
}

/**
 * Create a stable ID allocator.
 *
 * The formula is `b-${stableSourceToken(anchor)}-${kind}`. The token is
 * derived from the canonical source anchor, so the same XML element produces
 * the same ID regardless of whether it is projected from the render-shell or
 * from the full semantic model.
 *
 * @example
 * ```ts
 * const ids = createStableIdAllocator();
 * ids.blockId("paragraph", {
 *   partUri: "/word/document.xml",
 *   nodeId: "/word/document.xml:element:42-84",
 * });
 * // → "b-word_document_xml_42_84-paragraph"
 * ```
 */
export function createStableIdAllocator(): StableIdAllocator {
  const blockToSourceRef = new Map<string, SourceAnchor>();

  return {
    blockId(kind: string, anchor: SourceAnchor): string {
      const id = makeStableBlockId(kind, anchor);
      blockToSourceRef.set(id, anchor);
      return id;
    },

    subBlockId(kind: string, anchor: SourceAnchor): string {
      return makeStableBlockId(kind, anchor);
    },

    blockToSourceRef,
  };
}
