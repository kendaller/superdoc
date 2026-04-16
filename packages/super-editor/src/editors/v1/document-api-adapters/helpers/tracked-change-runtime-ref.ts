/**
 * Internal helpers for bridging the public {@link TrackedChangeAddress}
 * (story-aware, `StoryLocator`-based) with the internal runtime ref form
 * (`{ storyKey, rawId }`).
 *
 * **Layering rule:**
 * - The public document-api boundary speaks {@link TrackedChangeAddress}.
 * - The super-editor runtime speaks {@link TrackedChangeRuntimeRef}.
 * - Conversion ONLY happens here and in tracked-change-resolver / index code.
 *
 * No document-api type may import from this module; no consumer outside
 * super-editor should ever see a `TrackedChangeRuntimeRef` or a bare
 * `storyKey`.
 */

import type { StoryLocator, TrackedChangeAddress } from '@superdoc/document-api';
import { isStoryLocator } from '@superdoc/document-api';
import { DocumentApiAdapterError } from '../errors.js';
import {
  BODY_STORY_KEY,
  buildStoryKey,
  parseStoryKey,
} from '../story-runtime/story-key.js';

// ---------------------------------------------------------------------------
// Internal runtime ref shape
// ---------------------------------------------------------------------------

/**
 * Internal runtime form of a tracked-change identity.
 *
 * - `storyKey` — compact, cache-friendly story identity (see `story-key.ts`).
 * - `rawId` — the raw tracked-change mark ID local to the owning story editor.
 *
 * Story runtimes are editor-scoped and revision-tracking is per-editor, so
 * `rawId` is story-local by construction. This ref captures that scoping
 * explicitly so sidebar position maps, accept/reject routers, and the
 * TrackedChangeIndex can key on the full (storyKey, rawId) tuple without
 * ambiguity.
 */
export interface TrackedChangeRuntimeRef {
  storyKey: string;
  rawId: string;
}

// ---------------------------------------------------------------------------
// Address <-> RuntimeRef conversion
// ---------------------------------------------------------------------------

/**
 * Converts a public {@link TrackedChangeAddress} into an internal
 * {@link TrackedChangeRuntimeRef}.
 *
 * - When `address.story` is omitted, the ref targets the body story.
 * - When present, the story locator is validated and then encoded via
 *   {@link buildStoryKey}. Unknown story shapes throw `INVALID_INPUT`.
 *
 * @throws {DocumentApiAdapterError} INVALID_INPUT when the story locator is malformed.
 */
export function toTrackedChangeRuntimeRef(address: TrackedChangeAddress): TrackedChangeRuntimeRef {
  if (!address || address.kind !== 'entity' || address.entityType !== 'trackedChange') {
    throw new DocumentApiAdapterError(
      'INVALID_INPUT',
      'Expected a TrackedChangeAddress ({ kind: "entity", entityType: "trackedChange", entityId }).',
    );
  }

  const rawId = address.entityId;
  if (typeof rawId !== 'string' || rawId.length === 0) {
    throw new DocumentApiAdapterError('INVALID_INPUT', 'TrackedChangeAddress.entityId must be a non-empty string.');
  }

  if (address.story === undefined) {
    return { storyKey: BODY_STORY_KEY, rawId };
  }

  if (!isStoryLocator(address.story)) {
    throw new DocumentApiAdapterError('INVALID_INPUT', 'TrackedChangeAddress.story is not a valid StoryLocator.', {
      story: address.story,
    });
  }

  return { storyKey: buildStoryKey(address.story), rawId };
}

/**
 * Converts an internal {@link TrackedChangeRuntimeRef} back into a public
 * {@link TrackedChangeAddress}.
 *
 * Body refs are returned without a `story` field (backward compatible).
 * Non-body refs decode `storyKey` back into its public {@link StoryLocator}.
 *
 * @throws {DocumentApiAdapterError} INVALID_INPUT when the storyKey is unparseable.
 */
export function toTrackedChangeAddress(ref: TrackedChangeRuntimeRef): TrackedChangeAddress {
  if (!ref || typeof ref.storyKey !== 'string' || typeof ref.rawId !== 'string') {
    throw new DocumentApiAdapterError('INVALID_INPUT', 'Expected a TrackedChangeRuntimeRef ({ storyKey, rawId }).');
  }

  if (ref.storyKey === BODY_STORY_KEY) {
    return { kind: 'entity', entityType: 'trackedChange', entityId: ref.rawId };
  }

  let story: StoryLocator;
  try {
    story = parseStoryKey(ref.storyKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentApiAdapterError('INVALID_INPUT', `Unparseable storyKey "${ref.storyKey}": ${message}`, {
      storyKey: ref.storyKey,
    });
  }

  return { kind: 'entity', entityType: 'trackedChange', entityId: ref.rawId, story };
}

// ---------------------------------------------------------------------------
// Anchor keys for shared position maps
// ---------------------------------------------------------------------------

/** Prefix for tracked-change anchor keys in shared position maps. */
export const TRACKED_CHANGE_ANCHOR_KEY_PREFIX = 'tc::';

/** Prefix for comment anchor keys in shared position maps. */
export const COMMENT_ANCHOR_KEY_PREFIX = 'comment::';

/**
 * Builds the canonical shared-map anchor key for a tracked-change runtime ref.
 *
 * Format: `tc::<storyKey>::<rawId>` — matches `editorCommentPositions`
 * namespacing rule from Phase 3/4 of the "tracked changes in parts" plan.
 *
 * @example
 * makeTrackedChangeAnchorKey({ storyKey: 'body', rawId: 'rev-123' })
 * // => 'tc::body::rev-123'
 *
 * makeTrackedChangeAnchorKey({ storyKey: 'hf:part:rId4', rawId: 'r7' })
 * // => 'tc::hf:part:rId4::r7'
 */
export function makeTrackedChangeAnchorKey(ref: TrackedChangeRuntimeRef): string {
  return `${TRACKED_CHANGE_ANCHOR_KEY_PREFIX}${ref.storyKey}::${ref.rawId}`;
}

/**
 * Builds the canonical shared-map anchor key for a comment id.
 *
 * Format: `comment::<id>`. Comments remain body-scoped in Phase 1 (see plan
 * non-goals) so the key does not namespace by story; a future "comments in
 * parts" effort can widen this without breaking existing keys.
 */
export function makeCommentAnchorKey(commentId: string): string {
  return `${COMMENT_ANCHOR_KEY_PREFIX}${commentId}`;
}

/**
 * Returns true when the given key is a canonical tracked-change anchor key.
 */
export function isTrackedChangeAnchorKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(TRACKED_CHANGE_ANCHOR_KEY_PREFIX);
}

/**
 * Returns true when the given key is a canonical comment anchor key.
 */
export function isCommentAnchorKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(COMMENT_ANCHOR_KEY_PREFIX);
}

/**
 * Parses a canonical tracked-change anchor key back into a {@link TrackedChangeRuntimeRef}.
 *
 * Returns `null` when the key is not a tracked-change anchor key or when
 * the format is malformed.
 */
export function parseTrackedChangeAnchorKey(key: string): TrackedChangeRuntimeRef | null {
  if (!isTrackedChangeAnchorKey(key)) return null;

  const body = key.slice(TRACKED_CHANGE_ANCHOR_KEY_PREFIX.length);
  const separatorIndex = body.lastIndexOf('::');
  if (separatorIndex <= 0 || separatorIndex >= body.length - 2) return null;

  const storyKey = body.slice(0, separatorIndex);
  const rawId = body.slice(separatorIndex + 2);
  if (!storyKey || !rawId) return null;

  return { storyKey, rawId };
}
