// ---------------------------------------------------------------------------
// Enrichment executor dispatch — top-level entry point
// ---------------------------------------------------------------------------

import type { DocumentHandle } from '../../types/session.js';
import type { EnrichmentTarget } from '../../runtime/worker-protocol.js';
import type { DependencyManifest } from '../../projections/layout/dependency-manifest.js';
import type { EnrichmentResult } from '../enrichment-results.js';
import { executeHeadersFootersEnrichment } from './headers-footers-executor.js';
import {
  executeFootnotesEnrichment,
  executeEndnotesEnrichment,
  executeCommentsEnrichment,
} from './annotations-executor.js';
import { executeImagesEnrichment } from './images-executor.js';

/**
 * Execute enrichment for a given target.
 *
 * Dispatches to the target-specific executor. The handle must be at
 * render-shell stage or later.
 *
 * @param handle - The document handle
 * @param target - Which enrichment category to execute
 * @param ids - Optional: only enrich specific IDs (from a dependency manifest)
 * @param manifest - Optional: full manifest for image resolution (provides partUri mapping)
 * @param signal - Cooperative cancellation
 */
export async function executeEnrichment(
  handle: DocumentHandle,
  target: EnrichmentTarget,
  ids?: string[],
  manifest?: DependencyManifest,
  signal?: AbortSignal,
): Promise<EnrichmentResult> {
  switch (target) {
    case 'headers-footers':
      return executeHeadersFootersEnrichment(handle, ids, signal);
    case 'footnotes':
      return executeFootnotesEnrichment(handle, ids, signal);
    case 'endnotes':
      return executeEndnotesEnrichment(handle, ids, signal);
    case 'comments':
      return executeCommentsEnrichment(handle, ids, signal);
    case 'images':
      return executeImagesEnrichment(handle, manifest, ids, signal);
  }
}
