/**
 * Track-changes convenience wrappers — bridge track-change operations to
 * the plan engine's revision management and execution path.
 *
 * Discovery (list / get) is a thin passthrough over the host-level
 * {@link getTrackedChangeIndex} service, so there is a single owner for
 * tracked-change enumeration across every revision-capable story (body,
 * headers, footers, footnotes, endnotes).
 *
 * Mutating operations (accept, reject, acceptAll, rejectAll) route through
 * the story runtime resolver so that non-body tracked changes execute in
 * the owning story editor and commit back through `mutatePart(...)`.
 */

import type { Editor } from '../../core/Editor.js';
import type {
  Receipt,
  RevisionGuardOptions,
  TrackChangeInfo,
  TrackChangeWordRevisionIds,
  TrackChangesAcceptAllInput,
  TrackChangesAcceptInput,
  TrackChangesGetInput,
  TrackChangesListInput,
  TrackChangesRejectAllInput,
  TrackChangesRejectInput,
  TrackChangeType,
  TrackChangesListResult,
  StoryLocator,
} from '@superdoc/document-api';
import { buildResolvedHandle, buildDiscoveryItem, buildDiscoveryResult } from '@superdoc/document-api';
import { DocumentApiAdapterError } from '../errors.js';
import { executeDomainCommand } from './plan-wrappers.js';
import { paginate, validatePaginationInput } from '../helpers/adapter-utils.js';
import { getRevision } from './revision-tracker.js';
import { resolveTrackedChangeInStory } from '../helpers/tracked-change-resolver.js';
import { getTrackedChangeIndex } from '../tracked-changes/tracked-change-index.js';
import type { TrackedChangeSnapshot } from '../tracked-changes/tracked-change-snapshot.js';
import { resolveStoryRuntime } from '../story-runtime/resolve-story-runtime.js';
import { BODY_STORY_KEY, buildStoryKey } from '../story-runtime/story-key.js';
import { makeTrackedChangeAnchorKey } from '../helpers/tracked-change-runtime-ref.js';
import { normalizeExcerpt, toNonEmptyString } from '../helpers/value-utils.js';

function normalizeWordRevisionIds(
  wordRevisionIds: TrackChangeWordRevisionIds | undefined,
): TrackChangeWordRevisionIds | undefined {
  if (!wordRevisionIds) return undefined;

  const normalized: TrackChangeWordRevisionIds = {};
  if (wordRevisionIds.insert) normalized.insert = wordRevisionIds.insert;
  if (wordRevisionIds.delete) normalized.delete = wordRevisionIds.delete;
  if (wordRevisionIds.format) normalized.format = wordRevisionIds.format;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function snapshotToInfo(snapshot: TrackedChangeSnapshot): TrackChangeInfo {
  return {
    address: snapshot.address,
    id: snapshot.address.entityId,
    type: snapshot.type,
    wordRevisionIds: normalizeWordRevisionIds(snapshot.wordRevisionIds),
    author: snapshot.author,
    authorEmail: snapshot.authorEmail,
    authorImage: snapshot.authorImage,
    date: snapshot.date,
    excerpt: snapshot.excerpt,
  };
}

function filterByType(
  snapshots: ReadonlyArray<TrackedChangeSnapshot>,
  requestedType?: TrackChangeType,
): TrackedChangeSnapshot[] {
  if (!requestedType) return [...snapshots];
  return snapshots.filter((snapshot) => snapshot.type === requestedType);
}

function toNoOpReceipt(message: string, details?: unknown): Receipt {
  return {
    success: false,
    failure: {
      code: 'NO_OP',
      message,
      details,
    },
  };
}

/**
 * Narrow the `in` field from a list query into one of:
 * - `undefined`  → body only (back-compat)
 * - `'all'`      → every revision-capable story
 * - `StoryLocator` → a single explicit story
 */
function resolveListScope(input: TrackChangesListInput | undefined): 'body' | 'all' | { story: StoryLocator } {
  if (!input || input.in === undefined) return 'body';
  if (input.in === 'all') return 'all';
  return { story: input.in };
}

// ---------------------------------------------------------------------------
// Read operations (queries)
// ---------------------------------------------------------------------------

export function trackChangesListWrapper(editor: Editor, input?: TrackChangesListInput): TrackChangesListResult {
  validatePaginationInput(input?.offset, input?.limit);

  const index = getTrackedChangeIndex(editor);
  const scope = resolveListScope(input);

  let rawSnapshots: ReadonlyArray<TrackedChangeSnapshot>;
  if (scope === 'all') {
    rawSnapshots = index.getAll();
  } else if (scope === 'body') {
    rawSnapshots = index.get({ kind: 'story', storyType: 'body' });
  } else {
    rawSnapshots = index.get(scope.story);
  }

  const filtered = filterByType(rawSnapshots, input?.type);
  const paged = paginate(filtered, input?.offset, input?.limit);
  const evaluatedRevision = getRevision(editor);

  const items = paged.items.map((snapshot) => {
    const info = snapshotToInfo(snapshot);
    const handle = buildResolvedHandle(snapshot.anchorKey, 'stable', 'trackedChange');
    const { address, type, wordRevisionIds, author, authorEmail, authorImage, date, excerpt } = info;
    return buildDiscoveryItem(info.id, handle, {
      address,
      type,
      wordRevisionIds,
      author,
      authorEmail,
      authorImage,
      date,
      excerpt,
    });
  });

  return buildDiscoveryResult({
    evaluatedRevision,
    total: paged.total,
    items,
    page: { limit: input?.limit ?? paged.total, offset: input?.offset ?? 0, returned: items.length },
  });
}

export function trackChangesGetWrapper(editor: Editor, input: TrackChangesGetInput): TrackChangeInfo {
  const { id, story } = input;
  const resolved = resolveTrackedChangeInStory(editor, {
    kind: 'entity',
    entityType: 'trackedChange',
    entityId: id,
    ...(story ? { story } : {}),
  });
  if (!resolved) {
    throw new DocumentApiAdapterError('TARGET_NOT_FOUND', `Tracked change "${id}" was not found.`, { id });
  }

  const index = getTrackedChangeIndex(editor);
  const storyKey = buildStoryKey(resolved.story);
  const anchorKey = makeTrackedChangeAnchorKey(resolved.runtimeRef);

  // Prefer the indexed snapshot so the contract stays consistent with list().
  // Falls back to a synthesized info when the index has not yet materialized
  // this story's snapshot (e.g., during a hot path before the next microtask).
  const snapshot = (storyKey === BODY_STORY_KEY ? index.get({ kind: 'story', storyType: 'body' }) : index.get(resolved.story))
    .find((s) => s.anchorKey === anchorKey);

  if (snapshot) return snapshotToInfo(snapshot);

  return {
    address: {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: resolved.change.id,
      ...(storyKey === BODY_STORY_KEY ? {} : { story: resolved.story }),
    },
    id: resolved.change.id,
    type:
      resolved.change.hasFormat
        ? 'format'
        : resolved.change.hasDelete && !resolved.change.hasInsert
          ? 'delete'
          : 'insert',
    wordRevisionIds: normalizeWordRevisionIds(resolved.change.wordRevisionIds),
    author: toNonEmptyString(resolved.change.attrs.author),
    authorEmail: toNonEmptyString(resolved.change.attrs.authorEmail),
    authorImage: toNonEmptyString(resolved.change.attrs.authorImage),
    date: toNonEmptyString(resolved.change.attrs.date),
    excerpt: normalizeExcerpt(
      resolved.editor.state.doc.textBetween(resolved.change.from, resolved.change.to, ' ', '\ufffc'),
    ),
  };
}

// ---------------------------------------------------------------------------
// Mutating operations (wrappers)
// ---------------------------------------------------------------------------

type ReviewDecision = 'accept' | 'reject';

/**
 * Story-aware accept/reject pipeline.
 *
 * Resolves the tracked-change into its owning story editor, executes the
 * matching editor command in that editor, commits non-body runtimes through
 * `mutatePart(...)`, and notifies the index so downstream consumers resync.
 */
function decideSingle(
  hostEditor: Editor,
  decision: ReviewDecision,
  id: string,
  story: StoryLocator | undefined,
  options: RevisionGuardOptions | undefined,
): Receipt {
  const resolved = resolveTrackedChangeInStory(hostEditor, {
    kind: 'entity',
    entityType: 'trackedChange',
    entityId: id,
    ...(story ? { story } : {}),
  });

  if (!resolved) {
    throw new DocumentApiAdapterError(
      'TARGET_NOT_FOUND',
      `Tracked change "${id}" was not found.`,
      { id, story },
    );
  }

  const commandName = decision === 'accept' ? 'acceptTrackedChangeById' : 'rejectTrackedChangeById';
  const command = (resolved.editor.commands as Record<string, ((rawId: string) => boolean) | undefined>)[commandName];
  if (typeof command !== 'function') {
    throw new DocumentApiAdapterError(
      'CAPABILITY_UNAVAILABLE',
      `${decision === 'accept' ? 'Accept' : 'Reject'} tracked change command is not available on the story editor.`,
      { reason: 'missing_command' },
    );
  }

  const receipt = executeDomainCommand(resolved.editor, () => Boolean(command(resolved.change.rawId)), {
    expectedRevision: options?.expectedRevision,
  });

  if (receipt.steps[0]?.effect !== 'changed') {
    return toNoOpReceipt(
      `${decision === 'accept' ? 'Accept' : 'Reject'} tracked change "${id}" produced no change.`,
      { id, story },
    );
  }

  // Persist non-body stories through the parts pipeline.
  if (resolved.commit) {
    resolved.commit(hostEditor);
  }

  // Targeted invalidation — only the story that changed.
  getTrackedChangeIndex(hostEditor).invalidate(resolved.story);

  return { success: true };
}

export function trackChangesAcceptWrapper(
  editor: Editor,
  input: TrackChangesAcceptInput,
  options?: RevisionGuardOptions,
): Receipt {
  return decideSingle(editor, 'accept', input.id, input.story, options);
}

export function trackChangesRejectWrapper(
  editor: Editor,
  input: TrackChangesRejectInput,
  options?: RevisionGuardOptions,
): Receipt {
  return decideSingle(editor, 'reject', input.id, input.story, options);
}

/**
 * Accept every tracked change across every revision-capable story.
 *
 * Executes per-story: resolves the story runtime, runs the story's
 * `acceptAllTrackedChanges` command, commits if applicable. Stories that
 * contain no tracked changes are skipped without any runtime allocation.
 */
function decideAll(
  editor: Editor,
  decision: ReviewDecision,
  options: RevisionGuardOptions | undefined,
): Receipt {
  const index = getTrackedChangeIndex(editor);
  const allSnapshots = index.getAll();
  if (allSnapshots.length === 0) {
    return toNoOpReceipt(
      `${decision === 'accept' ? 'Accept' : 'Reject'} all tracked changes produced no change.`,
    );
  }

  // Group snapshots by storyKey so we only resolve each story runtime once.
  const byStoryKey = new Map<string, { story: StoryLocator; snapshots: TrackedChangeSnapshot[] }>();
  for (const snapshot of allSnapshots) {
    const key = snapshot.runtimeRef.storyKey;
    const entry = byStoryKey.get(key);
    if (entry) {
      entry.snapshots.push(snapshot);
    } else {
      byStoryKey.set(key, { story: snapshot.story, snapshots: [snapshot] });
    }
  }

  let anyApplied = false;

  for (const { story, snapshots } of byStoryKey.values()) {
    const runtime = resolveStoryRuntime(editor, story);
    const commandName = decision === 'accept' ? 'acceptAllTrackedChanges' : 'rejectAllTrackedChanges';
    const bulk = (runtime.editor.commands as Record<string, (() => boolean) | undefined>)[commandName];

    const receipt = executeDomainCommand(
      runtime.editor,
      (): boolean => {
        if (typeof bulk === 'function') return Boolean(bulk());
        // Fallback: iterate individual commands.
        const perChange = (runtime.editor.commands as Record<string, ((rawId: string) => boolean) | undefined>)[
          decision === 'accept' ? 'acceptTrackedChangeById' : 'rejectTrackedChangeById'
        ];
        if (typeof perChange !== 'function') return false;
        let applied = false;
        for (const snapshot of snapshots) {
          if (perChange(snapshot.runtimeRef.rawId)) applied = true;
        }
        return applied;
      },
      { expectedRevision: options?.expectedRevision },
    );

    const changed = receipt.steps[0]?.effect === 'changed';
    if (!changed) continue;
    anyApplied = true;
    if (runtime.commit) runtime.commit(editor);
    index.invalidate(story);
  }

  if (!anyApplied) {
    return toNoOpReceipt(
      `${decision === 'accept' ? 'Accept' : 'Reject'} all tracked changes produced no change.`,
    );
  }

  return { success: true };
}

export function trackChangesAcceptAllWrapper(
  editor: Editor,
  _input: TrackChangesAcceptAllInput,
  options?: RevisionGuardOptions,
): Receipt {
  return decideAll(editor, 'accept', options);
}

export function trackChangesRejectAllWrapper(
  editor: Editor,
  _input: TrackChangesRejectAllInput,
  options?: RevisionGuardOptions,
): Receipt {
  return decideAll(editor, 'reject', options);
}
