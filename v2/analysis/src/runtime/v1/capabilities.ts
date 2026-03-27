// ---------------------------------------------------------------------------
// V1 Runtime Capabilities
// ---------------------------------------------------------------------------
// Declares the traceability capabilities of the v1 adapter per feature+stage.
// This is the v1 capability contract: what the adapter can observe and at
// what traceability level.
// ---------------------------------------------------------------------------

import type { RuntimeCapabilityEntry } from '../types.js';
import { FEATURE_REGISTRY } from '../../universe/feature-registry.js';

/** Current v1 bridge adapter version. Bump when provenance logic changes. */
export const V1_ADAPTER_VERSION = '0.2.0';

const OCCURRENCE_LEVEL_FEATURES = new Set([
  'paragraph',
  'run',
  'table',
  'table.row',
  'table.cell',
  'inline.tab',
  'inline.break',
  'footnote.reference',
  'endnote.reference',
  'comment.range-start',
  'drawing.inline',
  'drawing.anchored',
  'vml.pict',
]);

/**
 * Build the v1 runtime capability entries.
 *
 * The initial v1 contract declares:
 * - `feature` traceability for most features at `import` stage
 * - `occurrence` for structural features where provenance is captured
 * - No `layout` stage capabilities in first slice
 *
 * Formatting features (marks) are `feature`-level until mark-range resolution.
 */
export function buildV1Capabilities(): RuntimeCapabilityEntry[] {
  const capabilities: RuntimeCapabilityEntry[] = [];

  for (const rule of FEATURE_REGISTRY) {
    capabilities.push({
      runtime: 'v1',
      stage: 'import',
      featureKey: rule.featureKey,
      expectedTraceabilityLevel: OCCURRENCE_LEVEL_FEATURES.has(rule.featureKey) ? 'occurrence' : 'feature',
    });
  }

  return capabilities;
}
