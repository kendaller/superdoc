// ---------------------------------------------------------------------------
// Identity and addressing types for the semantic model
//
// These types form the addressing kernel shared by entities, projections,
// operations, and analysis. They are the bridge between the source kernel's
// raw node IDs and the semantic layer's stable entity identities.
// ---------------------------------------------------------------------------

// ---- Source-level references ------------------------------------------------

/**
 * Reference to a raw XML node within a package part.
 * Bridges the semantic layer back to the source kernel.
 *
 * - `nodeId` is session-local (derived from byte position or synthetic counter)
 * - `sourceNodePath` is a stable, persisted path from the part root to the
 *   element (e.g., "w:body/w:p[3]/w:r[2]") usable as a join key with the
 *   raw-surface analysis layer. Populated during graph construction.
 */
export type SourceRef = {
  readonly partUri: string;
  readonly nodeId: string;
  readonly sourceNodePath?: string;
};

// ---- Semantic entity identity -----------------------------------------------

/**
 * Stable identity for a semantic entity within a session.
 *
 * Entity refs are session-scoped — they do not survive save/reopen without
 * remapping through SourceRef-based persistence.
 */
export type EntityRef = {
  readonly id: string;
};

// ---- Story-local addressing -------------------------------------------------

/**
 * Anchor-relative position within a story.
 *
 * Uses the entity ref as anchor (Option C from the plan) for stability
 * across concurrent structural edits to unrelated entities.
 *
 * For block-level positions, only `storyId` and `entityRef` are set.
 * For inline positions within a run, `segmentIndex` and `charOffset` refine
 * the location within the run's inline segment sequence.
 */
export type StoryPosition = {
  readonly storyId: string;
  readonly entityRef: EntityRef;
  /** Index into the run's inline segment sequence. */
  readonly segmentIndex?: number;
  /** Character offset within a text segment. */
  readonly charOffset?: number;
};

/**
 * A range between two anchor-relative story positions.
 * Start and end may be anchored to different entities.
 */
export type StoryRange = {
  readonly start: StoryPosition;
  readonly end: StoryPosition;
};

// ---- Projection-level references --------------------------------------------

/**
 * Identity for layout fragments, render fragments, and analysis occurrences.
 * These are projection-only artifacts — never promoted into the entity graph.
 */
export type ProjectionRef = {
  readonly id: string;
  readonly sourceEntityRef: EntityRef;
};

// ---- Utilities --------------------------------------------------------------

export function createEntityRef(id: string): EntityRef {
  return { id };
}

export function createSourceRef(
  partUri: string,
  nodeId: string,
  sourceNodePath?: string,
): SourceRef {
  const ref: SourceRef = { partUri, nodeId };
  if (sourceNodePath !== undefined) {
    (ref as { sourceNodePath: string }).sourceNodePath = sourceNodePath;
  }
  return ref;
}

export function entityRefsEqual(a: EntityRef, b: EntityRef): boolean {
  return a.id === b.id;
}

export function sourceRefsEqual(a: SourceRef, b: SourceRef): boolean {
  return a.partUri === b.partUri && a.nodeId === b.nodeId;
}

export function createStoryPosition(
  storyId: string,
  entityRef: EntityRef,
  segmentIndex?: number,
  charOffset?: number,
): StoryPosition {
  const pos: StoryPosition = { storyId, entityRef };
  if (segmentIndex !== undefined) {
    (pos as { segmentIndex: number }).segmentIndex = segmentIndex;
  }
  if (charOffset !== undefined) {
    (pos as { charOffset: number }).charOffset = charOffset;
  }
  return pos;
}

export function createStoryRange(
  start: StoryPosition,
  end: StoryPosition,
): StoryRange {
  return { start, end };
}
