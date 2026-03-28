// ---------------------------------------------------------------------------
// Merge policy classification
//
// The streaming host reads the merge action to decide how to apply an
// enrichment result: overlay (sidebar), decoration (repaint), or relayout.
// ---------------------------------------------------------------------------

import type { EnrichmentResult } from './enrichment-results.js';

export type MergeAction =
  | { kind: 'overlay'; target: 'comments' }
  | { kind: 'decorate'; target: 'endnotes' | 'images' }
  | { kind: 'relayout'; target: 'headers-footers' | 'footnotes' };

/** Classify how the host should merge an enrichment result. */
export function classifyMergeAction(result: EnrichmentResult): MergeAction {
  switch (result.target) {
    case 'comments':
      return { kind: 'overlay', target: 'comments' };
    case 'endnotes':
      return { kind: 'decorate', target: 'endnotes' };
    case 'images':
      return { kind: 'decorate', target: 'images' };
    case 'headers-footers':
      return { kind: 'relayout', target: 'headers-footers' };
    case 'footnotes':
      return { kind: 'relayout', target: 'footnotes' };
  }
}
