import { describe, it, expect } from 'vitest';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import {
  collectCommentPositions,
  makeCommentKey,
  makeTrackedChangeKey,
  COMMENT_ANCHOR_KEY_PREFIX,
  TRACKED_CHANGE_ANCHOR_KEY_PREFIX,
} from './CommentPositionCollection.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface FakeMark {
  type: { name: string };
  attrs: Record<string, unknown>;
}

interface FakeNode {
  marks: FakeMark[];
  nodeSize: number;
}

function makeMark(typeName: string, attrs: Record<string, unknown>): FakeMark {
  return { type: { name: typeName }, attrs };
}

function makeDoc(nodes: Array<{ node: FakeNode; pos: number }>): ProseMirrorNode {
  return {
    descendants(callback: (node: unknown, pos: number) => void) {
      for (const entry of nodes) {
        callback(entry.node, entry.pos);
      }
    },
  } as unknown as ProseMirrorNode;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('makeTrackedChangeKey / makeCommentKey', () => {
  it('builds `tc::<storyKey>::<rawId>` for tracked changes', () => {
    expect(makeTrackedChangeKey('body', 'rev-1')).toBe('tc::body::rev-1');
    expect(makeTrackedChangeKey('fn:5', 'r1')).toBe('tc::fn:5::r1');
    expect(makeTrackedChangeKey('hf:part:rId4', 'x')).toBe('tc::hf:part:rId4::x');
    expect(makeTrackedChangeKey('body', 'r1').startsWith(TRACKED_CHANGE_ANCHOR_KEY_PREFIX)).toBe(true);
  });

  it('builds `comment::<id>` for comments', () => {
    expect(makeCommentKey('c-1')).toBe('comment::c-1');
    expect(makeCommentKey('abc').startsWith(COMMENT_ANCHOR_KEY_PREFIX)).toBe(true);
  });
});

describe('collectCommentPositions', () => {
  const commentMarkName = 'commentMark';
  const trackChangeMarkNames = ['trackInsert', 'trackDelete', 'trackFormat'];

  it('returns an empty map for a null doc', () => {
    const result = collectCommentPositions(null, { commentMarkName, trackChangeMarkNames });
    expect(result).toEqual({});
  });

  it('keys tracked changes by canonical anchor key and comments by raw id', () => {
    const doc = makeDoc([
      { node: { marks: [makeMark('trackInsert', { id: 'rev-1' }) as unknown as Mark], nodeSize: 5 }, pos: 10 },
      { node: { marks: [makeMark(commentMarkName, { commentId: 'c-7' }) as unknown as Mark], nodeSize: 3 }, pos: 20 },
    ]);

    const result = collectCommentPositions(doc, { commentMarkName, trackChangeMarkNames });

    expect(Object.keys(result).sort()).toEqual(['c-7', 'tc::body::rev-1']);
    expect(result['tc::body::rev-1']).toMatchObject({
      threadId: 'rev-1',
      key: 'tc::body::rev-1',
      storyKey: 'body',
      kind: 'trackedChange',
      start: 10,
      end: 15,
    });
    expect(result['c-7']).toMatchObject({
      threadId: 'c-7',
      key: 'comment::c-7',
      kind: 'comment',
    });
  });

  it('uses the provided storyKey when building tracked-change canonical keys', () => {
    const doc = makeDoc([
      { node: { marks: [makeMark('trackInsert', { id: 'r1' }) as unknown as Mark], nodeSize: 3 }, pos: 1 },
    ]);

    const result = collectCommentPositions(doc, {
      commentMarkName,
      trackChangeMarkNames,
      storyKey: 'fn:12',
    });

    expect(result['tc::fn:12::r1']?.key).toBe('tc::fn:12::r1');
    expect(result['tc::fn:12::r1']?.storyKey).toBe('fn:12');
  });

  it('merges overlapping positions for the same raw id', () => {
    const doc = makeDoc([
      { node: { marks: [makeMark('trackInsert', { id: 'r1' }) as unknown as Mark], nodeSize: 3 }, pos: 0 },
      { node: { marks: [makeMark('trackInsert', { id: 'r1' }) as unknown as Mark], nodeSize: 4 }, pos: 10 },
    ]);

    const result = collectCommentPositions(doc, { commentMarkName, trackChangeMarkNames });
    expect(result['tc::body::r1']).toMatchObject({ start: 0, end: 14 });
  });

  it('falls back to comment importedId when commentId is absent', () => {
    const doc = makeDoc([
      {
        node: { marks: [makeMark(commentMarkName, { importedId: 'imp-1' }) as unknown as Mark], nodeSize: 2 },
        pos: 0,
      },
    ]);
    const result = collectCommentPositions(doc, { commentMarkName, trackChangeMarkNames });
    expect(result['imp-1']?.key).toBe('comment::imp-1');
  });

  it('ignores marks with no id', () => {
    const doc = makeDoc([
      { node: { marks: [makeMark('trackInsert', {}) as unknown as Mark], nodeSize: 2 }, pos: 0 },
      { node: { marks: [makeMark(commentMarkName, {}) as unknown as Mark], nodeSize: 2 }, pos: 3 },
    ]);
    const result = collectCommentPositions(doc, { commentMarkName, trackChangeMarkNames });
    expect(result).toEqual({});
  });
});
