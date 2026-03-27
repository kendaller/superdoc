// ---------------------------------------------------------------------------
// Claim Engine
// ---------------------------------------------------------------------------
// Per-document claim logic: iterates eligible raw facts, applies feature
// registry predicates, resolves claim modes, and partitions all facts into
// claimed / ignored / unmapped buckets.
//
// This is the core of the universe builder. The honesty invariant
// (claimed + ignored + unmapped === total) is enforced by the caller.
// ---------------------------------------------------------------------------

import type { RawSurfaceFact } from '../raw-surface/types.js';
import type { FeatureOccurrence, FeatureTier } from './types.js';
import type { FeatureRule } from './feature-registry.js';
import { isContentBearing, ignoredByRuleKey } from './part-scope.js';
import { buildOccurrenceId } from './occurrence-id.js';
import { increment } from '../shared/sort-helpers.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ClaimResult = {
  /** Feature occurrences found in this document. */
  occurrences: FeatureOccurrence[];
  /** Set of rawFactIds that were claimed. */
  claimedFactIds: Set<string>;
  /** Total claimed fact count (elements + absorbed attributes). */
  claimedFactCount: number;
  /** Total facts from non-content-bearing parts. */
  ignoredFactCount: number;
  /** Ignored-by-rule summary (e.g., "part-scope:styles": 1234). */
  ignoredByRuleSummary: Record<string, number>;
  /** Facts from content-bearing parts that no rule claimed. */
  unmappedFacts: RawSurfaceFact[];
  /** Diagnostics from claim mode conflicts. */
  diagnostics: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the parent element's unique indexed xpath from an attribute fact's
 * xpathLikePath by stripping the trailing /@attrName segment.
 *
 * Example:
 *   "word/document.xml::/w:document[1]/w:body[1]/w:p[1]/@w:rsidR"
 *   → "word/document.xml::/w:document[1]/w:body[1]/w:p[1]"
 */
function deriveParentXpath(attrXpathLikePath: string): string | undefined {
  const attrSepIndex = attrXpathLikePath.lastIndexOf('/@');
  if (attrSepIndex === -1) return undefined;
  return attrXpathLikePath.slice(0, attrSepIndex);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run the feature registry against all facts from a single document.
 *
 * Algorithm:
 * 1. Partition facts: content-bearing parts → eligible; others → ignored.
 * 2. Index attribute facts by their parent element's UNIQUE indexed xpath
 *    (derived from the attribute's xpathLikePath, not from pathSignature).
 * 3. For each eligible element fact, test registry rules in order.
 *    - exclusive: first match claims; conflict with another exclusive = diagnostic.
 *    - absorbed: first match claims element + child attributes from indexed xpath.
 *    - shared: all matching shared rules claim the fact.
 * 4. Remaining eligible facts → unmapped.
 */
export function claimFacts(
  allFacts: readonly RawSurfaceFact[],
  registry: readonly FeatureRule[],
  docId: string,
): ClaimResult {
  const diagnostics: string[] = [];

  // --- Step 1: Partition into eligible vs ignored ---
  const eligibleFacts: RawSurfaceFact[] = [];
  const ignoredByRuleSummary: Record<string, number> = {};
  let ignoredFactCount = 0;

  for (const fact of allFacts) {
    if (isContentBearing(fact.partKind)) {
      eligibleFacts.push(fact);
    } else {
      ignoredFactCount++;
      increment(ignoredByRuleSummary, ignoredByRuleKey(fact.partKind));
    }
  }

  // --- Step 2: Index attribute facts by parent's unique indexed xpath ---
  const attrsByParentXpath = new Map<string, RawSurfaceFact[]>();
  for (const fact of eligibleFacts) {
    if (fact.factKind === 'attribute') {
      const parentXpath = deriveParentXpath(fact.xpathLikePath);
      if (parentXpath) {
        let list = attrsByParentXpath.get(parentXpath);
        if (!list) {
          list = [];
          attrsByParentXpath.set(parentXpath, list);
        }
        list.push(fact);
      }
    }
  }

  // --- Step 3: Match element facts against registry ---
  const claimedFactIds = new Set<string>();
  // Track which element facts are claimed by which rule (for conflict detection)
  const elementClaimMap = new Map<string, string>(); // rawFactId → featureKey
  const occurrences: FeatureOccurrence[] = [];

  for (const fact of eligibleFacts) {
    if (fact.factKind !== 'element') continue;

    const matchingRules: FeatureRule[] = [];
    for (const rule of registry) {
      if (rule.matchElement(fact)) {
        matchingRules.push(rule);
      }
    }

    if (matchingRules.length === 0) continue;

    // Resolve claim modes
    const exclusiveRules = matchingRules.filter((r) => r.claimMode === 'exclusive' || r.claimMode === 'absorbed');
    const sharedRules = matchingRules.filter((r) => r.claimMode === 'shared');

    // Conflict: multiple exclusive/absorbed rules match the same fact → build failure
    if (exclusiveRules.length > 1) {
      throw new Error(
        `Claim conflict (build failure): element fact ${fact.rawFactId} ` +
        `(${fact.pathSignature}) matched by exclusive rules: ` +
        `${exclusiveRules.map((r) => r.featureKey).join(', ')}. ` +
        `Fix the registry so only one exclusive rule matches this fact.`,
      );
    }

    // Process the single exclusive/absorbed rule
    if (exclusiveRules.length === 1) {
      claimElement(fact, exclusiveRules[0], docId, claimedFactIds, elementClaimMap, attrsByParentXpath, occurrences);
    }

    // Process all shared rules
    for (const rule of sharedRules) {
      claimElement(fact, rule, docId, claimedFactIds, elementClaimMap, attrsByParentXpath, occurrences);
    }
  }

  // --- Step 4: Identify unmapped facts ---
  const unmappedFacts: RawSurfaceFact[] = [];
  for (const fact of eligibleFacts) {
    if (!claimedFactIds.has(fact.rawFactId)) {
      unmappedFacts.push(fact);
    }
  }

  // Sort ignored summary keys for deterministic output
  const sortedIgnored: Record<string, number> = {};
  for (const key of Object.keys(ignoredByRuleSummary).sort()) {
    sortedIgnored[key] = ignoredByRuleSummary[key];
  }

  return {
    occurrences,
    claimedFactIds,
    claimedFactCount: claimedFactIds.size,
    ignoredFactCount,
    ignoredByRuleSummary: sortedIgnored,
    unmappedFacts,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Claim a single element by a single rule
// ---------------------------------------------------------------------------

function claimElement(
  fact: RawSurfaceFact,
  rule: FeatureRule,
  docId: string,
  claimedFactIds: Set<string>,
  elementClaimMap: Map<string, string>,
  attrsByParentXpath: Map<string, RawSurfaceFact[]>,
  occurrences: FeatureOccurrence[],
): void {
  const claimedIds = [fact.rawFactId];
  claimedFactIds.add(fact.rawFactId);
  elementClaimMap.set(fact.rawFactId, rule.featureKey);

  // For absorbed mode: also claim attribute facts keyed by the element's
  // unique indexed xpath (xpathLikePath), NOT the non-unique pathSignature.
  if (rule.claimMode === 'absorbed') {
    const childAttrs = attrsByParentXpath.get(fact.xpathLikePath);
    if (childAttrs) {
      for (const attr of childAttrs) {
        if (!claimedFactIds.has(attr.rawFactId)) {
          claimedIds.push(attr.rawFactId);
          claimedFactIds.add(attr.rawFactId);
        }
      }
    }
  }

  occurrences.push({
    occurrenceId: buildOccurrenceId(docId, rule.featureKey, fact.xpathLikePath),
    docId,
    featureKey: rule.featureKey,
    tier: rule.tier as FeatureTier,
    rawFactIds: claimedIds,
    sourceRefs: [fact.sourceRef],
  });
}
