/**
 * Unit tests for the host-level TrackedChangeIndex service.
 *
 * These tests rely on vitest hoisted mocks to stub out story runtime
 * resolution and mark grouping, so we can exercise the index's caching,
 * invalidation, and broadcast contract without a live editor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Editor } from '../../../core/Editor.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  resolveStoryRuntime: vi.fn(),
  groupTrackedChanges: vi.fn(),
  enumerateRevisionCapableStories: vi.fn(),
  isHeaderFooterPartId: vi.fn(() => false),
  resolveRIdFromRelsData: vi.fn(() => null),
}));

vi.mock('../../story-runtime/resolve-story-runtime.js', () => ({
  resolveStoryRuntime: mocks.resolveStoryRuntime,
}));

vi.mock('../../helpers/tracked-change-resolver.js', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    groupTrackedChanges: mocks.groupTrackedChanges,
  };
});

vi.mock('../enumerate-stories.js', () => ({
  enumerateRevisionCapableStories: mocks.enumerateRevisionCapableStories,
}));

vi.mock('../../../core/parts/adapters/header-footer-part-descriptor.js', () => ({
  isHeaderFooterPartId: mocks.isHeaderFooterPartId,
}));

vi.mock('../../../core/parts/adapters/header-footer-sync.js', () => ({
  resolveRIdFromRelsData: mocks.resolveRIdFromRelsData,
}));

import { getTrackedChangeIndex } from '../tracked-change-index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => void;

interface FakeEditor extends Editor {
  _emit: (event: string, payload?: unknown) => void;
}

function makeEditor(): FakeEditor {
  const listeners = new Map<string, EventHandler[]>();
  const editor = {
    state: { doc: { textBetween: () => '' } },
    commands: {},
    on(event: string, handler: EventHandler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    },
    off(event: string, handler: EventHandler) {
      const list = listeners.get(event);
      if (!list) return;
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    },
    emit: vi.fn(),
    _emit(event: string, payload?: unknown) {
      for (const handler of listeners.get(event) ?? []) {
        handler(payload);
      }
    },
  } as unknown as FakeEditor;
  return editor;
}

function makeGroupedChange(rawId: string, from = 0, to = 5, overrides: Record<string, unknown> = {}) {
  return {
    rawId,
    id: `canon-${rawId}`,
    from,
    to,
    hasInsert: true,
    hasDelete: false,
    hasFormat: false,
    attrs: { author: 'Ada', date: '2026-01-01', ...overrides },
    wordRevisionIds: undefined,
  };
}

function makeStoryRuntime(editor: Editor, locator: { storyType: string; [k: string]: unknown }, storyKey: string) {
  return {
    locator: { kind: 'story', ...locator } as any,
    storyKey,
    editor,
    kind: locator.storyType === 'body' ? 'body' : locator.storyType.startsWith('headerFooter') ? 'headerFooter' : 'note',
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enumerateRevisionCapableStories.mockReturnValue([{ kind: 'story', storyType: 'body' }]);
  mocks.groupTrackedChanges.mockReturnValue([]);
  mocks.resolveStoryRuntime.mockImplementation((host: Editor, locator: any) => {
    if (!locator || locator.storyType === 'body') {
      return makeStoryRuntime(host, { storyType: 'body' }, 'body');
    }
    if (locator.storyType === 'footnote') {
      const storyEditor = makeEditor();
      return makeStoryRuntime(storyEditor, locator, `fn:${locator.noteId}`);
    }
    if (locator.storyType === 'endnote') {
      return makeStoryRuntime(makeEditor(), locator, `en:${locator.noteId}`);
    }
    if (locator.storyType === 'headerFooterPart') {
      return makeStoryRuntime(makeEditor(), locator, `hf:part:${locator.refId}`);
    }
    throw new Error(`Unexpected locator: ${JSON.stringify(locator)}`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrackedChangeIndex — per-story cache', () => {
  it('returns body-only snapshots when no non-body stories exist', () => {
    const editor = makeEditor();
    mocks.groupTrackedChanges.mockReturnValueOnce([makeGroupedChange('rev-1')]);

    const index = getTrackedChangeIndex(editor);
    const snapshots = index.get({ kind: 'story', storyType: 'body' });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.anchorKey).toBe('tc::body::rev-1');
    expect(snapshots[0]?.storyKind).toBe('body');
    expect(snapshots[0]?.address).toEqual({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'rev-1',
    });
  });

  it('returns story-scoped anchor keys for footnote stories', () => {
    const editor = makeEditor();
    mocks.enumerateRevisionCapableStories.mockReturnValue([
      { kind: 'story', storyType: 'body' },
      { kind: 'story', storyType: 'footnote', noteId: '5' },
    ]);
    mocks.groupTrackedChanges
      .mockReturnValueOnce([]) // body
      .mockReturnValueOnce([makeGroupedChange('rev-7')]); // footnote

    const index = getTrackedChangeIndex(editor);
    const all = index.getAll();

    expect(all).toHaveLength(1);
    expect(all[0]?.anchorKey).toBe('tc::fn:5::rev-7');
    expect(all[0]?.storyLabel).toBe('Footnote 5');
    expect(all[0]?.address.story).toEqual({ kind: 'story', storyType: 'footnote', noteId: '5' });
  });

  it('produces distinct snapshots when body and non-body share a rawId', () => {
    const editor = makeEditor();
    mocks.enumerateRevisionCapableStories.mockReturnValue([
      { kind: 'story', storyType: 'body' },
      { kind: 'story', storyType: 'footnote', noteId: '1' },
    ]);
    mocks.groupTrackedChanges
      .mockReturnValueOnce([makeGroupedChange('shared')])
      .mockReturnValueOnce([makeGroupedChange('shared')]);

    const index = getTrackedChangeIndex(editor);
    const all = index.getAll();

    expect(all).toHaveLength(2);
    const keys = all.map((s) => s.anchorKey);
    expect(keys).toContain('tc::body::shared');
    expect(keys).toContain('tc::fn:1::shared');
  });
});

describe('TrackedChangeIndex — invalidation', () => {
  it('body edits only dirty the body cache', () => {
    const editor = makeEditor();
    mocks.enumerateRevisionCapableStories.mockReturnValue([
      { kind: 'story', storyType: 'body' },
      { kind: 'story', storyType: 'footnote', noteId: '1' },
    ]);
    mocks.groupTrackedChanges
      .mockReturnValueOnce([]) // body initial
      .mockReturnValueOnce([makeGroupedChange('fn-1')]); // footnote initial

    const index = getTrackedChangeIndex(editor);
    index.getAll();
    expect(mocks.groupTrackedChanges).toHaveBeenCalledTimes(2);

    // Simulate a body edit.
    editor._emit('transaction', { transaction: { docChanged: true } });

    mocks.groupTrackedChanges
      .mockReturnValueOnce([makeGroupedChange('body-1')]) // rebuilt body
      .mockReturnValue([makeGroupedChange('fn-1')]); // footnote reused (should not be called again)

    index.getAll();
    // Body was rebuilt exactly once more; footnote should NOT have recomputed.
    expect(mocks.groupTrackedChanges).toHaveBeenCalledTimes(3);
  });

  it('invalidateAll wipes every cache', () => {
    const editor = makeEditor();
    mocks.enumerateRevisionCapableStories.mockReturnValue([{ kind: 'story', storyType: 'body' }]);
    mocks.groupTrackedChanges.mockReturnValue([makeGroupedChange('x')]);

    const index = getTrackedChangeIndex(editor);
    index.getAll();
    index.invalidateAll();
    index.getAll();

    // getAll was called twice, each triggering groupTrackedChanges once.
    expect(mocks.groupTrackedChanges).toHaveBeenCalledTimes(2);
  });
});

describe('TrackedChangeIndex — broadcast', () => {
  it('emits a coalesced tracked-changes-changed event after invalidation', async () => {
    const editor = makeEditor();
    const index = getTrackedChangeIndex(editor);

    index.invalidate({ kind: 'story', storyType: 'body' });
    index.invalidate({ kind: 'story', storyType: 'body' });
    index.invalidate({ kind: 'story', storyType: 'body' });

    await Promise.resolve();

    expect(editor.emit).toHaveBeenCalledTimes(1);
    expect(editor.emit).toHaveBeenCalledWith(
      'tracked-changes-changed',
      expect.objectContaining({ editor, source: 'invalidate' }),
    );
  });

  it('notifies subscribers with the aggregated snapshot list', async () => {
    const editor = makeEditor();
    mocks.groupTrackedChanges.mockReturnValue([makeGroupedChange('r1')]);

    const index = getTrackedChangeIndex(editor);
    const listener = vi.fn();
    const unsubscribe = index.subscribe(listener);

    index.invalidate({ kind: 'story', storyType: 'body' });
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    const arg = listener.mock.calls[0][0];
    expect(arg).toHaveLength(1);
    expect(arg[0].anchorKey).toBe('tc::body::r1');

    unsubscribe();
    index.invalidate({ kind: 'story', storyType: 'body' });
    await Promise.resolve();
    // Still just one call after unsubscribe.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
