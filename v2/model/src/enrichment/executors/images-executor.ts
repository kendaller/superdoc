// ---------------------------------------------------------------------------
// Images enrichment executor
//
// Resolves image binary data from the package for enrichment. Unlike other
// executors, this doesn't project to FlowBlocks — it returns raw bytes.
// ---------------------------------------------------------------------------

import type { DocumentHandle } from '../../types/session.js';
import type { ImageEnrichmentResult, ImageItem } from '../enrichment-results.js';
import type { DependencyManifest } from '../../projections/layout/dependency-manifest.js';
import { REL_TYPES, resolveRelationshipTarget } from '../../opc/relationships.js';

/**
 * Resolve image binary data for the requested images.
 *
 * @param handle - The document handle
 * @param manifest - The dependency manifest containing image refs
 * @param filterIds - Optional: only resolve these relationship IDs
 * @param signal - Cooperative cancellation
 */
export async function executeImagesEnrichment(
  handle: DocumentHandle,
  manifest?: DependencyManifest,
  filterIds?: string[],
  signal?: AbortSignal,
): Promise<ImageEnrichmentResult> {
  const items: ImageItem[] = [];

  // Get image references to resolve
  let imageRefs: ReadonlyArray<{ relationshipId: string; sourcePartUri: string }>;
  if (manifest) {
    imageRefs = manifest.imageRefs;
    if (filterIds) {
      const filterSet = new Set(filterIds);
      imageRefs = imageRefs.filter((ref) => filterSet.has(ref.relationshipId));
    }
  } else {
    // Without a manifest, nothing to do — image refs come from projection
    return { target: 'images', mergePolicy: 'decoration', items: [] };
  }

  for (const ref of imageRefs) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const binaryPartUri = resolveImagePartUri(handle, ref.sourcePartUri, ref.relationshipId);
    if (!binaryPartUri) {
      continue;
    }

    const resolved = await handle.resolveBinaryPart(binaryPartUri);
    if (!resolved) continue;

    items.push({
      relationshipId: ref.relationshipId,
      partUri: binaryPartUri,
      mimeType: resolved.contentType,
      data: copyToArrayBuffer(resolved.bytes),
    });
  }

  return { target: 'images', mergePolicy: 'decoration', items };
}

function resolveImagePartUri(
  handle: DocumentHandle,
  sourcePartUri: string,
  relationshipId: string,
): string | undefined {
  const relationships = handle.views().relationships.partRelationships(sourcePartUri);
  const relationship = relationships?.get(relationshipId);
  if (!relationship || relationship.type !== REL_TYPES.image || relationship.targetMode === 'External') {
    return undefined;
  }

  return resolveRelationshipTarget(sourcePartUri, relationship.target);
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
