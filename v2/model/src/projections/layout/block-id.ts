// ---------------------------------------------------------------------------
// Block ID generator for layout projection
//
// Produces sequential IDs like "v2-0-paragraph", "v2-1-table".
// Mirrors the pm-adapter's createBlockIdGenerator pattern.
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef } from '../../identity/types.js';
import { sourceRefToSourceAnchor } from './source-anchor.js';
import { makeStableBlockId } from './stable-id.js';

/** Function that generates a unique block ID given a block kind. */
export type BlockIdGenerator = (kind: string) => string;

const DEFAULT_INTERNAL_ID_PREFIX = 'v2-';

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
  nextBlockId(kind: string, entityRef: EntityRef, sourceRef?: SourceRef): string;
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
export function createBlockIdGenerator(prefix: string = 'v2-'): BlockIdGenerator {
  let counter = 0;
  return (kind: string) => `${prefix}${counter++}-${kind}`;
}

/**
 * Create a projection-aware ID allocator that also records block ownership.
 */
export function createProjectionIdAllocator(prefix?: string): ProjectionIdAllocator {
  const internalIdPrefix = prefix ?? DEFAULT_INTERNAL_ID_PREFIX;
  const stableBlockPrefix = normalizeStableBlockPrefix(prefix);
  const nextId = createBlockIdGenerator(internalIdPrefix);
  const blockToEntityRef = new Map<string, EntityRef>();

  return {
    blockToEntityRef,

    nextId,

    nextBlockId(kind: string, entityRef: EntityRef, sourceRef?: SourceRef): string {
      const blockId = sourceRef
        ? makeStableBlockId(kind, sourceRefToSourceAnchor(sourceRef), stableBlockPrefix)
        : nextId(kind);
      blockToEntityRef.set(blockId, entityRef);
      return blockId;
    },
  };
}

function normalizeStableBlockPrefix(prefix?: string): string {
  if (!prefix || prefix === DEFAULT_INTERNAL_ID_PREFIX) {
    return '';
  }

  return prefix;
}
