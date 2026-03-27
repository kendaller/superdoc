// ---------------------------------------------------------------------------
// Support Matrix Join
// ---------------------------------------------------------------------------
// Joins the corpus universe feature list against the hand-curated support
// input. Every universe feature gets a row. Missing entries default to
// "unknown" status. Partial statuses require an explanatory note.
// ---------------------------------------------------------------------------

import type { CorpusUniverse } from '../universe/types.js';
import type { SupportInput, SupportInputEntry, SupportMatrix, SupportMatrixRow, SupportStatus } from './types.js';

const VALID_STATUSES: ReadonlySet<string> = new Set(['yes', 'partial', 'no', 'unknown', 'not-applicable']);

const DEFAULT_STATUS: SupportStatus = 'unknown';

/**
 * Build the support matrix by joining universe features against support input.
 */
export function buildSupportMatrix(
  corpusUniverse: CorpusUniverse,
  supportInput: SupportInput,
): SupportMatrix {
  validateSupportInput(supportInput);

  // Index support input by featureKey, rejecting duplicates
  const inputMap = new Map<string, SupportInputEntry>();
  for (const entry of supportInput.entries) {
    if (inputMap.has(entry.featureKey)) {
      throw new Error(
        `Duplicate featureKey "${entry.featureKey}" in support-input.json. ` +
        `Each feature must appear exactly once.`,
      );
    }
    inputMap.set(entry.featureKey, entry);
  }

  // Track coverage
  const universeKeys = new Set(corpusUniverse.features.map((f) => f.featureKey));
  const inputKeys = new Set(inputMap.keys());

  const missingFromInput = [...universeKeys].filter((k) => !inputKeys.has(k)).sort();
  const extraInInput = [...inputKeys].filter((k) => !universeKeys.has(k)).sort();

  // Build rows — one per universe feature, sorted by featureKey
  const rows: SupportMatrixRow[] = corpusUniverse.features.map((feature) => {
    const input = inputMap.get(feature.featureKey);

    return {
      featureKey: feature.featureKey,
      tier: feature.tier,
      presentInCorpus: true as const,
      docCount: feature.docCount,
      occurrenceCount: feature.occurrenceCount,
      currentSuperDoc: {
        import: input?.import ?? DEFAULT_STATUS,
        layout: input?.layout ?? DEFAULT_STATUS,
        render: input?.render ?? DEFAULT_STATUS,
        ...(input?.importNote ? { importNote: input.importNote } : {}),
        ...(input?.layoutNote ? { layoutNote: input.layoutNote } : {}),
        ...(input?.renderNote ? { renderNote: input.renderNote } : {}),
      },
      v2Target: {
        semanticRead: input?.v2SemanticRead ?? DEFAULT_STATUS,
        semanticWrite: input?.v2SemanticWrite ?? DEFAULT_STATUS,
        ...(input?.v2SemanticReadNote ? { semanticReadNote: input.v2SemanticReadNote } : {}),
        ...(input?.v2SemanticWriteNote ? { semanticWriteNote: input.v2SemanticWriteNote } : {}),
      },
    };
  });

  return {
    schemaVersion: 1,
    rows,
    missingFromInput,
    extraInInput,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateSupportInput(input: SupportInput): void {
  if (input.schemaVersion !== 1) {
    throw new Error(`Unsupported support-input schemaVersion: ${input.schemaVersion}`);
  }

  for (const entry of input.entries) {
    // Validate current SuperDoc status fields
    for (const field of ['import', 'layout', 'render'] as const) {
      const value = entry[field];
      if (!VALID_STATUSES.has(value)) {
        throw new Error(
          `Invalid ${field} status "${value}" for feature "${entry.featureKey}". ` +
          `Must be one of: ${[...VALID_STATUSES].join(', ')}`,
        );
      }

      // Partial status requires a note
      if (value === 'partial') {
        const noteField = `${field}Note` as keyof SupportInputEntry;
        if (!entry[noteField]) {
          throw new Error(
            `Feature "${entry.featureKey}" has ${field}: "partial" but no ${String(noteField)}. ` +
            `Partial statuses require an explanatory note.`,
          );
        }
      }
    }

    // Validate optional v2 target fields
    for (const field of ['v2SemanticRead', 'v2SemanticWrite'] as const) {
      const value = entry[field];
      if (value !== undefined && !VALID_STATUSES.has(value)) {
        throw new Error(
          `Invalid ${field} status "${value}" for feature "${entry.featureKey}". ` +
          `Must be one of: ${[...VALID_STATUSES].join(', ')}`,
        );
      }
    }
  }
}
