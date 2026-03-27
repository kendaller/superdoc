// ---------------------------------------------------------------------------
// Signature Examples
// ---------------------------------------------------------------------------
// Builds deterministic examples-by-signature collections from raw facts.
// Used for both per-document and corpus-level artifact generation.
// ---------------------------------------------------------------------------

import type { RawSurfaceFact, SignatureExample } from './types.js';

const DEFAULT_MAX_EXAMPLES = 5;

/** Build examples-by-signature for a single document. */
export function buildDocumentExamplesBySignature(
  facts: RawSurfaceFact[],
  maxExamplesPerSignature = DEFAULT_MAX_EXAMPLES,
): SignatureExample[] {
  const signatureExamples = new Map<string, SignatureExample['examples']>();

  for (const fact of facts) {
    let examples = signatureExamples.get(fact.pathSignature);
    if (!examples) {
      examples = [];
      signatureExamples.set(fact.pathSignature, examples);
    }

    if (examples.length < maxExamplesPerSignature) {
      examples.push({
        docId: fact.docId,
        xpathLikePath: fact.xpathLikePath,
        value: fact.value,
      });
    }
  }

  return Array.from(signatureExamples.entries())
    .map(([pathSignature, examples]) => ({ pathSignature, examples }))
    .sort((a, b) => a.pathSignature.localeCompare(b.pathSignature));
}
