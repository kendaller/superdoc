/**
 * Host-level tracked-change index service.
 *
 * Owns every aspect of tracked-change discovery across revision-capable
 * stories:
 *
 * - Discovery: walks body + headers + footers + footnotes + endnotes.
 * - Caching:   per-story snapshot array keyed by `storyKey`.
 * - Invalidation: targeted — `mutatePart` commits only invalidate the one
 *   part they touched; body edits only refresh the body cache.
 * - Broadcast: emits `tracked-changes-changed` on the host editor so
 *   comments-store, navigation, and review surfaces can resync.
 *
 * Consumers (document-api wrappers, comments-store, sidebar) NEVER walk
 * tracked marks themselves. They subscribe to the index or query it.
 *
 * ## Performance contract
 *
 * Typing a character in the body of a 50-page doc with tracked changes in
 * 3 headers and 2 footnotes MUST NOT rebuild non-body caches. The hot path
 * for each keystroke is:
 *
 *   body mutation → invalidate('body') → rebuild body snapshot only
 *
 * All other caches remain untouched until their own stories mutate.
 */

import type { StoryLocator } from '@superdoc/document-api';
import type { Editor } from '../../core/Editor.js';
import type { PartChangedEvent } from '../../core/parts/types.js';
import {
  buildStoryKey,
  BODY_STORY_KEY,
  parseStoryKeyType,
} from '../story-runtime/story-key.js';
import { resolveStoryRuntime } from '../story-runtime/resolve-story-runtime.js';
import {
  groupTrackedChanges,
  resolveTrackedChangeType,
  type GroupedTrackedChange,
} from '../helpers/tracked-change-resolver.js';
import {
  makeTrackedChangeAnchorKey,
  toTrackedChangeAddress,
  type TrackedChangeRuntimeRef,
} from '../helpers/tracked-change-runtime-ref.js';
import { normalizeExcerpt, toNonEmptyString } from '../helpers/value-utils.js';
import { enumerateRevisionCapableStories } from './enumerate-stories.js';
import { classifyStoryKind, describeStoryLocation } from './story-labels.js';
import type { TrackedChangeSnapshot } from './tracked-change-snapshot.js';
import { isHeaderFooterPartId } from '../../core/parts/adapters/header-footer-part-descriptor.js';
import { resolveRIdFromRelsData } from '../../core/parts/adapters/header-footer-sync.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subscriber callback — invoked with the up-to-date aggregated snapshot list. */
export type TrackedChangeIndexListener = (snapshots: ReadonlyArray<TrackedChangeSnapshot>) => void;

/**
 * Public contract.
 *
 * One instance exists per host editor. Callers never construct this class
 * directly — use {@link getTrackedChangeIndex} to obtain it.
 */
export interface TrackedChangeIndex {
  /** Returns snapshots for a single story. Uses cache when fresh. */
  get(locator: StoryLocator): ReadonlyArray<TrackedChangeSnapshot>;

  /** Returns a flat snapshot list across every revision-capable story. */
  getAll(): ReadonlyArray<TrackedChangeSnapshot>;

  /** Targeted invalidation. Used on edits and part commits. Cheap. */
  invalidate(locator: StoryLocator): void;

  /** Wholesale invalidation. Used only on import / undo / reload. */
  invalidateAll(): void;

  /** Subscribe to aggregate snapshot changes. Returns an unsubscribe fn. */
  subscribe(listener: TrackedChangeIndexListener): () => void;

  /** Stop responding to editor events and clear all caches. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Per-host storage
// ---------------------------------------------------------------------------

const indexByHost = new WeakMap<Editor, TrackedChangeIndexImpl>();

/**
 * Returns the shared index instance for a host editor, creating it on
 * first access.
 */
export function getTrackedChangeIndex(hostEditor: Editor): TrackedChangeIndex {
  let index = indexByHost.get(hostEditor);
  if (!index) {
    index = new TrackedChangeIndexImpl(hostEditor);
    indexByHost.set(hostEditor, index);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TrackedChangeIndexImpl implements TrackedChangeIndex {
  readonly #hostEditor: Editor;

  /** Per-story cache. Absence of a key means "not yet computed." */
  readonly #snapshots = new Map<string, TrackedChangeSnapshot[]>();

  /** Aggregated snapshot array — rebuilt lazily whenever a story is invalidated. */
  #aggregated: TrackedChangeSnapshot[] | null = null;

  /** Keys into {@link #snapshots} that need recomputation on next read. */
  readonly #dirtyStoryKeys = new Set<string>();

  /** Subscribers for aggregate changes. */
  readonly #listeners = new Set<TrackedChangeIndexListener>();

  /** Unsubscribe callbacks for editor-event listeners. */
  readonly #teardowns: Array<() => void> = [];

  /** Coalescing microtask handle — prevents spamming subscribers. */
  #broadcastScheduled = false;

  /** Set when the host body editor's document has mutated since last compute. */
  #bodyDirty = true;

  constructor(hostEditor: Editor) {
    this.#hostEditor = hostEditor;
    this.#attachHostListeners();
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  get(locator: StoryLocator): ReadonlyArray<TrackedChangeSnapshot> {
    const storyKey = buildStoryKey(locator);
    return this.#getByKey(storyKey, locator);
  }

  getAll(): ReadonlyArray<TrackedChangeSnapshot> {
    if (this.#aggregated && this.#dirtyStoryKeys.size === 0) {
      return this.#aggregated;
    }

    const stories = enumerateRevisionCapableStories(this.#hostEditor);
    const flat: TrackedChangeSnapshot[] = [];
    for (const story of stories) {
      const storyKey = buildStoryKey(story);
      const snapshots = this.#getByKey(storyKey, story);
      flat.push(...snapshots);
    }

    this.#aggregated = flat;
    return flat;
  }

  invalidate(locator: StoryLocator): void {
    const storyKey = buildStoryKey(locator);
    this.#invalidateKey(storyKey);
    this.#scheduleBroadcast([locator], 'invalidate');
  }

  invalidateAll(): void {
    this.#snapshots.clear();
    this.#dirtyStoryKeys.clear();
    this.#aggregated = null;
    this.#bodyDirty = true;
    this.#scheduleBroadcast(undefined, 'invalidateAll');
  }

  subscribe(listener: TrackedChangeIndexListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    for (const teardown of this.#teardowns) {
      try {
        teardown();
      } catch {
        // Swallow — teardown errors during host tear-down are non-fatal.
      }
    }
    this.#teardowns.length = 0;
    this.#listeners.clear();
    this.#snapshots.clear();
    this.#dirtyStoryKeys.clear();
    this.#aggregated = null;
    indexByHost.delete(this.#hostEditor);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  #getByKey(storyKey: string, locator: StoryLocator): TrackedChangeSnapshot[] {
    // Body uses a dedicated fast path — we don't want to force a story
    // runtime allocation on every keystroke just to compute body tracked
    // changes, and `bodyDirty` is maintained by the transaction listener.
    if (storyKey === BODY_STORY_KEY) {
      if (this.#bodyDirty || !this.#snapshots.has(storyKey)) {
        const bodySnapshots = this.#buildSnapshotsFromEditor(
          this.#hostEditor,
          storyKey,
          locator,
        );
        this.#snapshots.set(storyKey, bodySnapshots);
        this.#bodyDirty = false;
        this.#dirtyStoryKeys.delete(storyKey);
        this.#aggregated = null;
      }
      return this.#snapshots.get(storyKey) ?? [];
    }

    if (this.#dirtyStoryKeys.has(storyKey) || !this.#snapshots.has(storyKey)) {
      const snapshots = this.#computeStorySnapshots(locator, storyKey);
      this.#snapshots.set(storyKey, snapshots);
      this.#dirtyStoryKeys.delete(storyKey);
      this.#aggregated = null;
    }

    return this.#snapshots.get(storyKey) ?? [];
  }

  /**
   * Resolves the story runtime, extracts tracked marks, and returns
   * materialized snapshots. Never touches other stories' caches.
   */
  #computeStorySnapshots(locator: StoryLocator, storyKey: string): TrackedChangeSnapshot[] {
    let runtime;
    try {
      runtime = resolveStoryRuntime(this.#hostEditor, locator);
    } catch {
      // Story enumeration can produce stale locators (e.g., a footnote ID
      // that was deleted between enumerate and resolve). Treat as empty.
      return [];
    }

    try {
      return this.#buildSnapshotsFromEditor(runtime.editor, storyKey, locator);
    } finally {
      // Cacheable story runtimes are managed by the story runtime cache.
      // Ephemeral runtimes (cacheable === false) would leak editors if we
      // didn't dispose them — but the index is a READ operation, and
      // ephemeral runtimes only exist for write intents. Safe to skip.
    }
  }

  #buildSnapshotsFromEditor(editor: Editor, storyKey: string, locator: StoryLocator): TrackedChangeSnapshot[] {
    const grouped = groupTrackedChanges(editor);
    if (grouped.length === 0) return [];

    const storyKind = classifyStoryKind(locator);
    const storyLabel = describeStoryLocation(locator);
    const snapshots: TrackedChangeSnapshot[] = [];

    for (const change of grouped) {
      const snapshot = this.#buildSnapshot(editor, change, storyKey, locator, storyKind, storyLabel);
      snapshots.push(snapshot);
    }

    return snapshots;
  }

  #buildSnapshot(
    editor: Editor,
    change: GroupedTrackedChange,
    storyKey: string,
    locator: StoryLocator,
    storyKind: TrackedChangeSnapshot['storyKind'],
    storyLabel: string,
  ): TrackedChangeSnapshot {
    const runtimeRef: TrackedChangeRuntimeRef = { storyKey, rawId: change.rawId };
    const address = toTrackedChangeAddress(runtimeRef);
    const type = resolveTrackedChangeType(change);
    const excerpt = normalizeExcerpt(editor.state.doc.textBetween(change.from, change.to, ' ', '\ufffc'));

    return {
      address,
      runtimeRef,
      story: locator,
      type,
      author: toNonEmptyString(change.attrs.author),
      authorEmail: toNonEmptyString(change.attrs.authorEmail),
      authorImage: toNonEmptyString(change.attrs.authorImage),
      date: toNonEmptyString(change.attrs.date),
      excerpt,
      wordRevisionIds: change.wordRevisionIds ? { ...change.wordRevisionIds } : undefined,
      storyLabel,
      storyKind,
      anchorKey: makeTrackedChangeAnchorKey(runtimeRef),
      range: { from: change.from, to: change.to },
    };
  }

  // ---------------------------------------------------------------------
  // Editor-event wiring
  // ---------------------------------------------------------------------

  #attachHostListeners(): void {
    const editor = this.#hostEditor;

    if (typeof editor.on === 'function') {
      const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
        if (!transaction.docChanged) return;
        // Only the body's snapshot list is dirty; non-body caches remain
        // untouched until their own parts commit.
        this.#bodyDirty = true;
        this.#aggregated = null;
        this.#scheduleBroadcast([{ kind: 'story', storyType: 'body' }], 'body-edit');
      };
      editor.on('transaction', onTransaction);
      this.#teardowns.push(() => editor.off?.('transaction', onTransaction));

      const onPartChanged = (event: PartChangedEvent): void => {
        const invalidatedStories = this.#storiesFromPartChange(event);
        if (invalidatedStories.length === 0) return;
        for (const story of invalidatedStories) {
          this.#invalidateKey(buildStoryKey(story));
        }
        this.#scheduleBroadcast(invalidatedStories, 'partChanged');
      };
      editor.on('partChanged', onPartChanged);
      this.#teardowns.push(() => editor.off?.('partChanged', onPartChanged));

      const onNotesChanged = (): void => {
        // A single notes-part change can affect every footnote/endnote.
        // Invalidate all note caches. This is still cheap because we only
        // wipe entries for note stories, not headers/footers.
        const wiped: StoryLocator[] = [];
        for (const key of Array.from(this.#snapshots.keys())) {
          if (key.startsWith('fn:') || key.startsWith('en:')) {
            this.#invalidateKey(key);
            const storyType: 'footnote' | 'endnote' = key.startsWith('fn:') ? 'footnote' : 'endnote';
            const noteId = key.slice(storyType === 'footnote' ? 'fn:'.length : 'en:'.length);
            wiped.push({ kind: 'story', storyType, noteId });
          }
        }
        if (wiped.length > 0) {
          this.#scheduleBroadcast(wiped, 'notes-part-changed');
        } else {
          // Even with no existing caches, notes import may have introduced
          // fresh stories — rebuild aggregated view next time.
          this.#aggregated = null;
          this.#scheduleBroadcast(undefined, 'notes-part-changed');
        }
      };
      editor.on('notes-part-changed', onNotesChanged);
      this.#teardowns.push(() => editor.off?.('notes-part-changed', onNotesChanged));

      const onDestroy = (): void => {
        this.dispose();
      };
      editor.on('destroy', onDestroy);
      this.#teardowns.push(() => editor.off?.('destroy', onDestroy));
    }
  }

  /**
   * Maps a part-changed event to the stories whose caches should be invalidated.
   *
   * Only header/footer parts can map back to a story identity in Phase 1.
   * Other parts (settings, styles, numbering, etc.) are not revision-capable
   * for tracked-change purposes.
   */
  #storiesFromPartChange(event: PartChangedEvent): StoryLocator[] {
    const stories: StoryLocator[] = [];
    const converter = (this.#hostEditor as unknown as { converter?: { convertedXml?: Record<string, unknown> } })
      .converter;
    const relsData = converter?.convertedXml?.['word/_rels/document.xml.rels'];

    for (const part of event.parts) {
      if (!isHeaderFooterPartId(part.partId)) continue;
      const refId = resolveRIdFromRelsData(relsData, part.partId);
      if (!refId) continue;
      stories.push({ kind: 'story', storyType: 'headerFooterPart', refId });
    }

    return stories;
  }

  #invalidateKey(storyKey: string): void {
    if (storyKey === BODY_STORY_KEY) {
      this.#bodyDirty = true;
    } else {
      this.#dirtyStoryKeys.add(storyKey);
      this.#snapshots.delete(storyKey);
    }
    this.#aggregated = null;
  }

  // ---------------------------------------------------------------------
  // Broadcast
  // ---------------------------------------------------------------------

  #scheduleBroadcast(stories: StoryLocator[] | undefined, source: string): void {
    // Coalesce to one microtask so a burst of invalidations (e.g., a
    // compound mutation that touches three parts) only notifies once.
    if (this.#broadcastScheduled) return;
    this.#broadcastScheduled = true;
    void Promise.resolve().then(() => {
      this.#broadcastScheduled = false;
      this.#emitHostEvent(stories, source);
      this.#notifySubscribers();
    });
  }

  #emitHostEvent(stories: StoryLocator[] | undefined, source: string): void {
    const editor = this.#hostEditor;
    if (typeof editor.emit !== 'function') return;
    editor.emit('tracked-changes-changed', {
      editor,
      stories,
      source,
    });
  }

  #notifySubscribers(): void {
    if (this.#listeners.size === 0) return;
    const snapshot = this.getAll();
    for (const listener of Array.from(this.#listeners)) {
      try {
        listener(snapshot);
      } catch (err) {
        // Don't let one broken subscriber break the others.
        // eslint-disable-next-line no-console
        console.error('[TrackedChangeIndex] subscriber threw', err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Optional story-kind helper re-exports for callers that don't want to pull
// the story-labels module directly.
// ---------------------------------------------------------------------------

export { classifyStoryKind, describeStoryLocation } from './story-labels.js';
export type { TrackedChangeSnapshot } from './tracked-change-snapshot.js';
export { parseStoryKeyType as parseStoryKind };
