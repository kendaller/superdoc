// ---------------------------------------------------------------------------
// Headers/footers enrichment executor
//
// Projects header and footer content from their XML parts to FlowBlock[],
// reusing the render-shell feeder and projector infrastructure.
// ---------------------------------------------------------------------------

import type { DocumentHandle } from '../../types/session.js';
import type { HeaderFooterDescriptor } from '../../word/headers-footers-view.js';
import type { FlowBlock } from '../../projections/layout/types.js';
import type { HeaderFooterEnrichmentResult, HeaderFooterItem } from '../enrichment-results.js';
import { createRenderShellFeeder, bodyChildToFeederNode } from '../../projections/layout/render-shell-feeder.js';
import { createStableIdAllocator } from '../../projections/layout/stable-id.js';
import { projectParagraphFromFeeder } from '../../projections/layout/paragraph-projector.js';
import { projectTableFromFeeder } from '../../projections/layout/table-projector.js';

/**
 * Extract and project header/footer content to FlowBlocks.
 *
 * @param handle - The document handle (must be at render-shell stage or later)
 * @param filterIds - Optional: only enrich these relationship IDs
 * @param signal - Cooperative cancellation
 */
export async function executeHeadersFootersEnrichment(
  handle: DocumentHandle,
  filterIds?: string[],
  signal?: AbortSignal,
): Promise<HeaderFooterEnrichmentResult> {
  const views = handle.views();
  const hfView = views.headersFooters;

  if (!hfView) {
    return { target: 'headers-footers', mergePolicy: 'layout-affecting', items: [] };
  }

  // Determine which headers/footers to enrich
  let descriptors: HeaderFooterDescriptor[];
  if (filterIds) {
    descriptors = filterIds
      .map((rId) => hfView.byRelationshipId(rId))
      .filter((d): d is HeaderFooterDescriptor => d !== undefined);
  } else {
    descriptors = hfView.list();
  }

  // Materialize the header/footer part URIs for lazy sessions
  const partUris = new Set(descriptors.map((d) => d.partUri));
  if (partUris.size > 0) {
    await handle.materializeParts(partUris, signal);
  }

  const items: HeaderFooterItem[] = [];
  const ids = createStableIdAllocator();

  for (const desc of descriptors) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const root = desc.element();
    if (!root) continue;

    const feeder = createRenderShellFeeder(desc.partUri);
    const blocks = projectBlockChildren(root, desc.partUri, feeder, ids);

    items.push({
      relationshipId: desc.relationshipId,
      type: desc.type,
      partUri: desc.partUri,
      blocks,
    });
  }

  return { target: 'headers-footers', mergePolicy: 'layout-affecting', items };
}

/**
 * Project block-level children (w:p, w:tbl) of a container element to FlowBlocks.
 * Used for header, footer, footnote, endnote, and comment content.
 */
export function projectBlockChildren(
  container: import('../../types/xml.js').XmlElementNode,
  partUri: string,
  feeder: import('../../projections/layout/feeder.js').ProjectionFeeder,
  ids: import('../../projections/layout/stable-id.js').StableIdAllocator,
): FlowBlock[] {
  const blocks: FlowBlock[] = [];

  for (const child of container.children) {
    if (child.kind !== 'element') continue;

    const node = bodyChildToFeederNode(child, partUri);
    if (!node) continue;

    if (node.kind === 'paragraph') {
      blocks.push(projectParagraphFromFeeder(node, feeder, ids));
    } else if (node.kind === 'table') {
      blocks.push(projectTableFromFeeder(node, feeder, ids));
    }
  }

  return blocks;
}
