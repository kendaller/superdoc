import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';

/**
 * Shared anchor key prefixes used by the comments / tracked-change position
 * map. Namespacing is required so that a body tracked change with the same
 * raw id as a comment (or a non-body tracked change) cannot collide.
 *
 * Keep in sync with the helpers in
 * `document-api-adapters/helpers/tracked-change-runtime-ref.ts`.
 */
export const TRACKED_CHANGE_ANCHOR_KEY_PREFIX = 'tc::';
export const COMMENT_ANCHOR_KEY_PREFIX = 'comment::';

export type CommentPosition = {
  /**
   * Raw mark identifier (tracked-change mark `id` or comment `commentId` /
   * `importedId`).
   */
  threadId: string;
  /** Canonical namespaced anchor key (`tc::<storyKey>::<rawId>` or `comment::<id>`). */
  key: string;
  /** Internal story key. Body positions use `'body'`. */
  storyKey: string;
  /** Distinguishes tracked changes from comments in shared maps. */
  kind: 'trackedChange' | 'comment';
  start: number;
  end: number;
};

export interface CollectCommentPositionsOptions {
  commentMarkName: string;
  trackChangeMarkNames: string[];
  /**
   * Story key the collected positions belong to. Defaults to `'body'` so
   * body-only callers continue to work unchanged.
   */
  storyKey?: string;
}

/**
 * Build the canonical shared-map anchor key for a tracked-change mark.
 */
export function makeTrackedChangeKey(storyKey: string, rawId: string): string {
  return `${TRACKED_CHANGE_ANCHOR_KEY_PREFIX}${storyKey}::${rawId}`;
}

/**
 * Build the canonical shared-map anchor key for a comment.
 */
export function makeCommentKey(commentId: string): string {
  return `${COMMENT_ANCHOR_KEY_PREFIX}${commentId}`;
}

export function collectCommentPositions(
  doc: ProseMirrorNode | null,
  options: CollectCommentPositionsOptions,
): Record<string, CommentPosition> {
  if (!doc) {
    return {};
  }

  const storyKey = options.storyKey ?? 'body';
  const pmPositions: Record<string, CommentPosition> = {};

  doc.descendants((node, pos) => {
    const marks = node.marks || [];

    for (const mark of marks) {
      const descriptor = describeThreadMark(mark, options);
      if (!descriptor) continue;

      const canonicalKey =
        descriptor.kind === 'trackedChange'
          ? makeTrackedChangeKey(storyKey, descriptor.rawId)
          : makeCommentKey(descriptor.rawId);
      const storageKey = descriptor.kind === 'trackedChange' ? canonicalKey : descriptor.rawId;

      const nodeEnd = pos + node.nodeSize;

      const existing = pmPositions[storageKey];
      if (!existing) {
        pmPositions[storageKey] = {
          threadId: descriptor.rawId,
          key: canonicalKey,
          storyKey,
          kind: descriptor.kind,
          start: pos,
          end: nodeEnd,
        };
      } else {
        existing.start = Math.min(existing.start, pos);
        existing.end = Math.max(existing.end, nodeEnd);
      }
    }
  });

  return pmPositions;
}

interface ThreadMarkDescriptor {
  rawId: string;
  kind: 'trackedChange' | 'comment';
}

function describeThreadMark(
  mark: Mark,
  options: CollectCommentPositionsOptions,
): ThreadMarkDescriptor | undefined {
  if (mark.type.name === options.commentMarkName) {
    const commentId = (mark.attrs.commentId as string | undefined) ?? (mark.attrs.importedId as string | undefined);
    if (!commentId) return undefined;
    return { rawId: commentId, kind: 'comment' };
  }

  if (options.trackChangeMarkNames.includes(mark.type.name)) {
    const rawId = mark.attrs.id as string | undefined;
    if (!rawId) return undefined;
    return { rawId, kind: 'trackedChange' };
  }

  return undefined;
}
