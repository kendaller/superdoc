// ---------------------------------------------------------------------------
// Feature Registry
// ---------------------------------------------------------------------------
// Declarative registry of all first-slice feature rules.
//
// Each rule maps raw-surface element facts to a stable feature key.
// The registry is the single source of truth for feature normalization.
//
// Registry version must be bumped when rules are added, removed, or changed.
// ---------------------------------------------------------------------------

import type { RawSurfaceFact } from '../raw-surface/types.js';
import type { FeatureTier, ClaimMode } from './types.js';

/** A single feature rule in the registry. */
export type FeatureRule = {
  /** Stable feature key (follows feature-key grammar). */
  featureKey: string;
  /** Human-readable label. */
  label: string;
  /** Controlled tier vocabulary. */
  tier: FeatureTier;
  /** How this rule claims facts. */
  claimMode: ClaimMode;
  /**
   * Predicate: returns true when a raw fact belongs to this feature.
   * Only called for element facts from content-bearing parts.
   */
  matchElement: (fact: RawSurfaceFact) => boolean;
  /** Description of the occurrence boundary for documentation. */
  boundaryDescription: string;
};

/**
 * Current registry version. Bump when rules are added, removed, or changed.
 * This makes universe diffs interpretable across versions.
 */
export const REGISTRY_VERSION = 1;

// ---------------------------------------------------------------------------
// Predicate helper
// ---------------------------------------------------------------------------

/**
 * Returns true if the fact is an element whose pathSignature ends with
 * the given qualified name segment (e.g., '/w:p').
 *
 * Safe because path segments are '/'-delimited: '/w:p' cannot match '/w:pPr'.
 */
function sigEnds(fact: RawSurfaceFact, qualifiedName: string): boolean {
  return fact.pathSignature.endsWith('/' + qualifiedName);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const FEATURE_REGISTRY: readonly FeatureRule[] = [
  // --- Structural blocks ---
  {
    featureKey: 'paragraph',
    label: 'Paragraph (w:p)',
    tier: 'structural',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:p'),
    boundaryDescription: 'One occurrence per w:p element.',
  },
  {
    featureKey: 'run',
    label: 'Run (w:r)',
    tier: 'structural',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:r'),
    boundaryDescription: 'One occurrence per w:r element.',
  },
  {
    featureKey: 'table',
    label: 'Table (w:tbl)',
    tier: 'structural',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:tbl'),
    boundaryDescription: 'One occurrence per w:tbl element.',
  },
  {
    featureKey: 'table.row',
    label: 'Table Row (w:tr)',
    tier: 'structural',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:tr'),
    boundaryDescription: 'One occurrence per w:tr element.',
  },
  {
    featureKey: 'table.cell',
    label: 'Table Cell (w:tc)',
    tier: 'structural',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:tc'),
    boundaryDescription: 'One occurrence per w:tc element.',
  },

  // --- Inline controls ---
  {
    featureKey: 'inline.tab',
    label: 'Tab (w:tab)',
    tier: 'content',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:tab'),
    boundaryDescription: 'One occurrence per w:tab element.',
  },
  {
    featureKey: 'inline.break',
    label: 'Break (w:br)',
    tier: 'content',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:br'),
    boundaryDescription: 'One occurrence per w:br element.',
  },

  // --- Direct formatting ---
  {
    featureKey: 'format.bold.direct',
    label: 'Bold Direct (w:b)',
    tier: 'formatting',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:b'),
    boundaryDescription: 'One occurrence per w:b element.',
  },
  {
    featureKey: 'format.italic.direct',
    label: 'Italic Direct (w:i)',
    tier: 'formatting',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:i'),
    boundaryDescription: 'One occurrence per w:i element.',
  },
  {
    featureKey: 'format.underline.direct',
    label: 'Underline Direct (w:u)',
    tier: 'formatting',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:u'),
    boundaryDescription: 'One occurrence per w:u element.',
  },
  {
    featureKey: 'format.font-size.direct',
    label: 'Font Size Direct (w:sz)',
    tier: 'formatting',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:sz'),
    boundaryDescription: 'One occurrence per w:sz element.',
  },
  {
    featureKey: 'format.color.direct',
    label: 'Color Direct (w:color)',
    tier: 'formatting',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:color'),
    boundaryDescription: 'One occurrence per w:color element.',
  },

  // --- Style references ---
  {
    featureKey: 'style-reference.paragraph',
    label: 'Paragraph Style Reference (w:pStyle)',
    tier: 'reference',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:pStyle'),
    boundaryDescription: 'One occurrence per w:pStyle element.',
  },
  {
    featureKey: 'style-reference.character',
    label: 'Character Style Reference (w:rStyle)',
    tier: 'reference',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:rStyle'),
    boundaryDescription: 'One occurrence per w:rStyle element.',
  },
  {
    featureKey: 'style-reference.table',
    label: 'Table Style Reference (w:tblStyle)',
    tier: 'reference',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:tblStyle'),
    boundaryDescription: 'One occurrence per w:tblStyle element.',
  },

  // --- Numbering ---
  {
    featureKey: 'numbering-reference',
    label: 'Numbering Reference (w:numPr)',
    tier: 'reference',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:numPr'),
    boundaryDescription: 'One occurrence per w:numPr element.',
  },

  // --- Footnotes / endnotes / comments ---
  {
    featureKey: 'footnote.reference',
    label: 'Footnote Reference (w:footnoteReference)',
    tier: 'reference',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:footnoteReference'),
    boundaryDescription: 'One occurrence per w:footnoteReference element.',
  },
  {
    featureKey: 'endnote.reference',
    label: 'Endnote Reference (w:endnoteReference)',
    tier: 'reference',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:endnoteReference'),
    boundaryDescription: 'One occurrence per w:endnoteReference element.',
  },
  {
    featureKey: 'comment.range-start',
    label: 'Comment Range Start (w:commentRangeStart)',
    tier: 'annotation',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:commentRangeStart'),
    boundaryDescription: 'One occurrence per w:commentRangeStart element.',
  },

  // --- Drawing ---
  {
    featureKey: 'drawing.inline',
    label: 'Inline Drawing (wp:inline)',
    tier: 'content',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'wp:inline'),
    boundaryDescription: 'One occurrence per wp:inline element.',
  },
  {
    featureKey: 'drawing.anchored',
    label: 'Anchored Drawing (wp:anchor)',
    tier: 'content',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'wp:anchor'),
    boundaryDescription: 'One occurrence per wp:anchor element.',
  },

  // --- VML ---
  {
    featureKey: 'vml.pict',
    label: 'VML Picture (w:pict)',
    tier: 'content',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'w:pict'),
    boundaryDescription: 'One occurrence per w:pict element.',
  },

  // --- Math ---
  {
    featureKey: 'math.omath',
    label: 'Math Formula (m:oMath)',
    tier: 'content',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'm:oMath'),
    boundaryDescription: 'One occurrence per m:oMath element.',
  },

  // --- Alternate content ---
  {
    featureKey: 'alternate-content',
    label: 'Alternate Content (mc:AlternateContent)',
    tier: 'structural',
    claimMode: 'absorbed',
    matchElement: (f) => sigEnds(f, 'mc:AlternateContent'),
    boundaryDescription: 'One occurrence per mc:AlternateContent element.',
  },
];

/** Build a Map<featureKey, FeatureRule> for fast lookup. */
export function getRegistryMap(): Map<string, FeatureRule> {
  const map = new Map<string, FeatureRule>();
  for (const rule of FEATURE_REGISTRY) {
    map.set(rule.featureKey, rule);
  }
  return map;
}
