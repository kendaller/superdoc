// ---------------------------------------------------------------------------
// Block ID generator for layout projection
//
// Produces sequential IDs like "v2-0-paragraph", "v2-1-table".
// Mirrors the pm-adapter's createBlockIdGenerator pattern.
// ---------------------------------------------------------------------------

import type { EntityRef } from "../../identity/types.js";

/** Function that generates a unique block ID given a block kind. */
export type BlockIdGenerator = (kind: string) => string;

/**
 * ID allocator used during layout projection.
 *
 * `nextId()` is for internal projection artifacts that are not part of the
 * source → entity → block trace chain (table rows, table cells).
 *
 * `nextBlockId()` is for real FlowBlocks and records the producing entity.
 */
export type ProjectionIdAllocator = {
  readonly blockToEntityRef: ReadonlyMap<string, EntityRef>;
  nextId(kind: string): string;
  nextBlockId(kind: string, entityRef: EntityRef): string;
};

/**
 * Create a block ID generator with an optional prefix.
 *
 * @example
 * ```ts
 * const nextId = createBlockIdGenerator("v2-");
 * nextId("paragraph"); // "v2-0-paragraph"
 * nextId("table");     // "v2-1-table"
 * nextId("paragraph"); // "v2-2-paragraph"
 * ```
 */
export function createBlockIdGenerator(prefix: string = "v2-"): BlockIdGenerator {
  let counter = 0;
  return (kind: string) => `${prefix}${counter++}-${kind}`;
}

/**
 * Create a projection-aware ID allocator that also records block ownership.
 */
export function createProjectionIdAllocator(
  prefix: string = "v2-",
): ProjectionIdAllocator {
  const nextId = createBlockIdGenerator(prefix);
  const blockToEntityRef = new Map<string, EntityRef>();

  return {
    blockToEntityRef,

    nextId,

    nextBlockId(kind: string, entityRef: EntityRef): string {
      const blockId = nextId(kind);
      blockToEntityRef.set(blockId, entityRef);
      return blockId;
    },
  };
}
