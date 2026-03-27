// ---------------------------------------------------------------------------
// Example Selection
// ---------------------------------------------------------------------------
// Doc-diversity-first algorithm for selecting stable, deterministic examples.
//
// Rules:
//   1. Max 5 examples per feature (default).
//   2. Prefer doc diversity: one example per document before repeating.
//   3. Within a document: select first occurrence by occurrenceId sort order.
//   4. Across documents: process in docId sort order.
//   5. Tie-breaking: prefer documents whose docId sorts first.
// ---------------------------------------------------------------------------

import type { DocumentUniverse, FeatureExamples, ExampleSelection } from './types.js';

const DEFAULT_MAX_EXAMPLES = 5;

/**
 * Select diverse, deterministic examples for each feature across documents.
 */
export function selectFeatureExamples(
  documentUniverses: readonly DocumentUniverse[],
  maxExamples = DEFAULT_MAX_EXAMPLES,
): FeatureExamples {
  // Collect all occurrences grouped by featureKey, sorted by (docId, occurrenceId)
  const byFeature = new Map<string, Array<{ docId: string; occurrenceId: string; sourceRef: DocumentUniverse['occurrences'][0]['sourceRefs'][0] }>>();

  // Process documents in docId sort order
  const sortedDocs = [...documentUniverses]
    .filter((du) => du.status !== 'excluded')
    .sort((a, b) => a.docId.localeCompare(b.docId));

  for (const du of sortedDocs) {
    // Sort occurrences by occurrenceId within each doc
    const sortedOccs = [...du.occurrences].sort((a, b) => a.occurrenceId.localeCompare(b.occurrenceId));

    for (const occ of sortedOccs) {
      let list = byFeature.get(occ.featureKey);
      if (!list) {
        list = [];
        byFeature.set(occ.featureKey, list);
      }
      list.push({
        docId: occ.docId,
        occurrenceId: occ.occurrenceId,
        sourceRef: occ.sourceRefs[0],
      });
    }
  }

  // Select examples with doc-diversity-first
  const examples: FeatureExamples['examples'] = [];

  for (const [featureKey, candidates] of [...byFeature.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const selections = selectDiverseExamples(candidates, maxExamples);
    examples.push({ featureKey, selections });
  }

  return { schemaVersion: 1, examples };
}

/**
 * Round-robin across distinct docIds, then fill remaining slots.
 */
function selectDiverseExamples(
  candidates: Array<{ docId: string; occurrenceId: string; sourceRef: ExampleSelection['sourceRef'] }>,
  max: number,
): ExampleSelection[] {
  if (candidates.length <= max) {
    return candidates.map(({ docId, occurrenceId, sourceRef }) => ({ docId, occurrenceId, sourceRef }));
  }

  // Group by docId, preserving order (first occurrence per doc)
  const byDoc = new Map<string, typeof candidates>();
  for (const c of candidates) {
    let list = byDoc.get(c.docId);
    if (!list) {
      list = [];
      byDoc.set(c.docId, list);
    }
    list.push(c);
  }

  // Round-robin: take one from each doc, then repeat
  const selected: ExampleSelection[] = [];
  const docQueues = [...byDoc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, items]) => [...items]);

  let round = 0;
  while (selected.length < max) {
    let added = false;
    for (const queue of docQueues) {
      if (selected.length >= max) break;
      if (round < queue.length) {
        const c = queue[round];
        selected.push({ docId: c.docId, occurrenceId: c.occurrenceId, sourceRef: c.sourceRef });
        added = true;
      }
    }
    if (!added) break;
    round++;
  }

  return selected;
}
