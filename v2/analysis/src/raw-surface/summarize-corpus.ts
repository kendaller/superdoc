// ---------------------------------------------------------------------------
// Summarize Corpus
// ---------------------------------------------------------------------------
// Aggregates per-document results into corpus-wide summaries, signature
// matrices, and examples-by-signature collections.
// ---------------------------------------------------------------------------

import type {
  RawSurfaceDocumentResult,
  CorpusRawSummary,
  SignatureMatrixEntry,
  SignatureExample,
  ScanCorpusOptions,
} from './types.js';
import { mergeRecordCounts, buildTopSignatures, sortRecord } from './summary-helpers.js';

const DEFAULT_MAX_EXAMPLES = 5;
const TOP_SIGNATURES_LIMIT = 200;

/** Build corpus-wide summary from an array of per-document results. */
export function summarizeCorpus(
  documents: RawSurfaceDocumentResult[],
  options?: ScanCorpusOptions,
): {
  corpusSummary: CorpusRawSummary;
  signatureMatrix: SignatureMatrixEntry[];
  examplesBySignature: SignatureExample[];
} {
  const maxExamples = options?.maxExamplesPerSignature ?? DEFAULT_MAX_EXAMPLES;

  const countsByPartKind: Record<string, number> = {};
  const countsByFactKind: Record<string, number> = {};
  const countsByPathSignature: Record<string, number> = {};
  const countsByRelationshipType: Record<string, number> = {};
  const diagnosticCounts: Record<string, number> = {};

  // Signature → set of docIds that contain it
  const signatureDocMap = new Map<string, Set<string>>();
  // Signature → total count across all docs
  const signatureTotalCount = new Map<string, number>();
  // Signature → collected examples
  const signatureExamples = new Map<string, SignatureExample['examples']>();

  let totalFacts = 0;

  for (const doc of documents) {
    const { summary } = doc;
    totalFacts += summary.totalFacts;

    mergeRecordCounts(countsByPartKind, summary.countsByPartKind);
    mergeRecordCounts(countsByFactKind, summary.countsByFactKind);
    mergeRecordCounts(countsByPathSignature, summary.countsByPathSignature);
    mergeRecordCounts(countsByRelationshipType, summary.countsByRelationshipType);

    for (const diag of summary.scanDiagnostics) {
      diagnosticCounts[diag.code] = (diagnosticCounts[diag.code] ?? 0) + 1;
    }

    // Build signature matrix and collect examples
    for (const fact of doc.facts) {
      const sig = fact.pathSignature;

      // Track which docs contain this signature
      let docSet = signatureDocMap.get(sig);
      if (!docSet) {
        docSet = new Set();
        signatureDocMap.set(sig, docSet);
      }
      docSet.add(doc.metadata.docId);

      // Track total count
      signatureTotalCount.set(sig, (signatureTotalCount.get(sig) ?? 0) + 1);

      // Collect examples (up to limit)
      let examples = signatureExamples.get(sig);
      if (!examples) {
        examples = [];
        signatureExamples.set(sig, examples);
      }
      if (examples.length < maxExamples) {
        examples.push({
          docId: doc.metadata.docId,
          xpathLikePath: fact.xpathLikePath,
          value: fact.value,
        });
      }
    }
  }

  const topSignatures = buildTopSignatures(countsByPathSignature, TOP_SIGNATURES_LIMIT);

  const corpusSummary: CorpusRawSummary = {
    totalDocuments: documents.length,
    totalFacts,
    countsByPartKind: sortRecord(countsByPartKind),
    countsByFactKind: sortRecord(countsByFactKind),
    countsByPathSignature: sortRecord(countsByPathSignature),
    countsByRelationshipType: sortRecord(countsByRelationshipType),
    topSignatures,
    diagnosticCounts: sortRecord(diagnosticCounts),
  };

  // Build signature matrix sorted by document count descending
  const signatureMatrix: SignatureMatrixEntry[] = Array.from(signatureDocMap.entries())
    .map(([pathSignature, docIds]) => ({
      pathSignature,
      documentCount: docIds.size,
      totalCount: signatureTotalCount.get(pathSignature) ?? 0,
      docIds: Array.from(docIds).sort(),
    }))
    .sort((a, b) => b.documentCount - a.documentCount || a.pathSignature.localeCompare(b.pathSignature));

  // Build examples-by-signature sorted by signature
  const examplesBySignature: SignatureExample[] = Array.from(signatureExamples.entries())
    .map(([pathSignature, examples]) => ({ pathSignature, examples }))
    .sort((a, b) => a.pathSignature.localeCompare(b.pathSignature));

  return { corpusSummary, signatureMatrix, examplesBySignature };
}
