// ---------------------------------------------------------------------------
// Annotations enrichment executor — footnotes, endnotes, comments
//
// Projects annotation content from their XML parts to FlowBlock[],
// reusing the render-shell feeder and projector infrastructure.
// ---------------------------------------------------------------------------

import type { DocumentHandle } from '../../types/session.js';
import type { AnnotationCollectionView, AnnotationDescriptor } from '../../word/annotations-view.js';
import type {
  FootnoteEnrichmentResult,
  EndnoteEnrichmentResult,
  CommentEnrichmentResult,
  AnnotationItem,
  CommentItem,
} from '../enrichment-results.js';
import { createRenderShellFeeder } from '../../projections/layout/render-shell-feeder.js';
import { createStableIdAllocator } from '../../projections/layout/stable-id.js';
import { projectBlockChildren } from './headers-footers-executor.js';
import { getAttr } from '../../word/tree-helpers.js';

/** System footnotes/endnotes (separators) that should not be enriched. */
const SYSTEM_NOTE_IDS = new Set(['0', '1', '-1']);

// ---- Footnotes --------------------------------------------------------------

export async function executeFootnotesEnrichment(
  handle: DocumentHandle,
  filterIds?: string[],
  signal?: AbortSignal,
): Promise<FootnoteEnrichmentResult> {
  await handle.materializeParts(new Set(['/word/footnotes.xml']), signal);

  const view = handle.views().footnotes;
  const items = projectAnnotations(view, '/word/footnotes.xml', filterIds, signal);

  return { target: 'footnotes', mergePolicy: 'layout-affecting', items };
}

// ---- Endnotes ---------------------------------------------------------------

export async function executeEndnotesEnrichment(
  handle: DocumentHandle,
  filterIds?: string[],
  signal?: AbortSignal,
): Promise<EndnoteEnrichmentResult> {
  await handle.materializeParts(new Set(['/word/endnotes.xml']), signal);

  const view = handle.views().endnotes;
  const items = projectAnnotations(view, '/word/endnotes.xml', filterIds, signal);

  return { target: 'endnotes', mergePolicy: 'decoration', items };
}

// ---- Comments ---------------------------------------------------------------

export async function executeCommentsEnrichment(
  handle: DocumentHandle,
  filterIds?: string[],
  signal?: AbortSignal,
): Promise<CommentEnrichmentResult> {
  await handle.materializeParts(new Set(['/word/comments.xml']), signal);

  const view = handle.views().comments;
  if (!view) {
    return { target: 'comments', mergePolicy: 'overlay-only', items: [] };
  }

  const ids = createStableIdAllocator();
  const feeder = createRenderShellFeeder('/word/comments.xml');
  const items: CommentItem[] = [];

  const descriptors = selectDescriptors(view, filterIds);
  for (const desc of descriptors) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const blocks = projectBlockChildren(desc.element, '/word/comments.xml', feeder, ids);

    items.push({
      commentId: desc.wordId,
      author: getAttr(desc.element, 'author', 'w') ?? undefined,
      date: getAttr(desc.element, 'date', 'w') ?? undefined,
      initials: getAttr(desc.element, 'initials', 'w') ?? undefined,
      blocks,
    });
  }

  return { target: 'comments', mergePolicy: 'overlay-only', items };
}

// ---- Shared helpers ---------------------------------------------------------

function projectAnnotations(
  view: AnnotationCollectionView | undefined,
  partUri: string,
  filterIds?: string[],
  signal?: AbortSignal,
): AnnotationItem[] {
  if (!view) return [];

  const ids = createStableIdAllocator();
  const feeder = createRenderShellFeeder(partUri);
  const items: AnnotationItem[] = [];

  const descriptors = selectDescriptors(view, filterIds);
  for (const desc of descriptors) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Skip system footnotes/endnotes (separators)
    if (SYSTEM_NOTE_IDS.has(desc.wordId)) continue;

    const blocks = projectBlockChildren(desc.element, partUri, feeder, ids);
    items.push({ wordId: desc.wordId, blocks });
  }

  return items;
}

function selectDescriptors(view: AnnotationCollectionView, filterIds?: string[]): AnnotationDescriptor[] {
  if (filterIds) {
    return filterIds.map((id) => view.byId(id)).filter((d): d is AnnotationDescriptor => d !== undefined);
  }
  return view.list();
}
