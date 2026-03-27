// ---------------------------------------------------------------------------
// Universe Join
// ---------------------------------------------------------------------------
// Joins V1ResolvedProvenance source anchors against DocumentUniverse
// occurrences by xpathLikePath. This is the core bridge between what the
// importer processed and what the universe claims.
//
// The join produces:
//   - matched: anchors that link to universe occurrences
//   - provenance-no-universe: anchors with no matching occurrence
//   - universe-no-provenance: occurrences with no matching anchor
// ---------------------------------------------------------------------------

import type { FeatureOccurrence, DocumentUniverse } from '../../universe/types.js';
import type { V1SourceAnchor } from './types.js';

/** A matched join between a provenance anchor and a universe occurrence. */
export type JoinMatch = {
  anchor: V1SourceAnchor;
  occurrence: FeatureOccurrence;
};

/** Result of joining provenance anchors against the document universe. */
export type UniverseJoinResult = {
  /** Anchors that matched universe occurrences (may be many-to-one). */
  matched: JoinMatch[];
  /** Provenance anchors with no matching universe occurrence. */
  provenanceOnly: V1SourceAnchor[];
  /** Universe occurrences with no matching provenance anchor. */
  universeOnly: FeatureOccurrence[];
};

/**
 * Join provenance source anchors against DocumentUniverse occurrences.
 *
 * The join key is `xpathLikePath`. Each universe occurrence carries
 * `sourceRefs[].xpathLikePath`; each provenance anchor carries `xpathLikePath`.
 *
 * A single provenance anchor can match multiple occurrences (if the universe
 * claims multiple features from the same element, e.g., via shared rules).
 * A single occurrence can match at most one anchor (because `xpathLikePath`
 * is unique per source element).
 */
export function joinUniverseProvenance(
  anchors: readonly V1SourceAnchor[],
  universe: DocumentUniverse,
): UniverseJoinResult {
  // Index occurrences by their source part + xpathLikePath for fast lookup.
  const occsBySourceRef = new Map<string, FeatureOccurrence[]>();
  for (const occ of universe.occurrences) {
    for (const ref of occ.sourceRefs) {
      const key = buildSourceRefKey(ref.partUri, ref.xpathLikePath);
      let list = occsBySourceRef.get(key);
      if (!list) {
        list = [];
        occsBySourceRef.set(key, list);
      }
      list.push(occ);
    }
  }

  // Track which occurrences got matched
  const matchedOccIds = new Set<string>();
  const matched: JoinMatch[] = [];
  const provenanceOnly: V1SourceAnchor[] = [];

  for (const anchor of anchors) {
    const occurrences = occsBySourceRef.get(buildSourceRefKey(anchor.partUri, anchor.xpathLikePath));
    if (occurrences && occurrences.length > 0) {
      for (const occ of occurrences) {
        matched.push({ anchor, occurrence: occ });
        matchedOccIds.add(occ.occurrenceId);
      }
    } else {
      provenanceOnly.push(anchor);
    }
  }

  // Find universe occurrences with no matching provenance anchor
  const universeOnly: FeatureOccurrence[] = [];
  for (const occ of universe.occurrences) {
    if (!matchedOccIds.has(occ.occurrenceId)) {
      universeOnly.push(occ);
    }
  }

  return { matched, provenanceOnly, universeOnly };
}

function buildSourceRefKey(partUri: string, xpathLikePath: string): string {
  return `${partUri}\n${xpathLikePath}`;
}
