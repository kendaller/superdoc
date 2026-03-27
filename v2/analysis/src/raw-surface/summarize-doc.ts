// ---------------------------------------------------------------------------
// Summarize Document
// ---------------------------------------------------------------------------
// Builds per-document rollups from raw facts. Produces counts by part kind,
// fact kind, path signature, qname, attribute signature, and relationship
// type. Top signatures are sorted by count descending.
// ---------------------------------------------------------------------------

import type { RawSurfaceFact, RawDocSummary, RelationshipRecord, ScanDiagnostic } from './types.js';
import { formatQName } from './namespace-format.js';
import { increment, buildTopSignatures, sortRecord } from './summary-helpers.js';

const TOP_SIGNATURES_LIMIT = 100;

/** Build a per-document summary from raw facts and metadata. */
export function summarizeDocument(
  docId: string,
  docFingerprint: string,
  facts: RawSurfaceFact[],
  relationships: RelationshipRecord[],
  diagnostics: ScanDiagnostic[],
): RawDocSummary {
  const countsByPartKind: Record<string, number> = {};
  const countsByFactKind: Record<string, number> = {};
  const countsByPathSignature: Record<string, number> = {};
  const countsByQName: Record<string, number> = {};
  const countsByAttributeSignature: Record<string, number> = {};

  for (const fact of facts) {
    increment(countsByPartKind, fact.partKind);
    increment(countsByFactKind, fact.factKind);
    increment(countsByPathSignature, fact.pathSignature);

    if (fact.factKind === 'element' && fact.qname) {
      increment(countsByQName, formatQName(fact.qname));
    }

    if (fact.factKind === 'attribute' && fact.attributeName) {
      increment(countsByAttributeSignature, fact.pathSignature);
    }
  }

  const countsByRelationshipType: Record<string, number> = {};
  for (const rel of relationships) {
    increment(countsByRelationshipType, rel.type);
  }

  const topSignatures = buildTopSignatures(countsByPathSignature, TOP_SIGNATURES_LIMIT);

  return {
    docId,
    docFingerprint,
    totalFacts: facts.length,
    countsByPartKind: sortRecord(countsByPartKind),
    countsByFactKind: sortRecord(countsByFactKind),
    countsByPathSignature: sortRecord(countsByPathSignature),
    countsByQName: sortRecord(countsByQName),
    countsByAttributeSignature: sortRecord(countsByAttributeSignature),
    countsByRelationshipType: sortRecord(countsByRelationshipType),
    topSignatures,
    scanDiagnostics: diagnostics,
  };
}
