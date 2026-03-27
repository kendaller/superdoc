// ---------------------------------------------------------------------------
// Raw Surface Fact Model
// ---------------------------------------------------------------------------
// The core data structures for Layer 0 raw OOXML surface analysis.
// Every type here is intentionally low-interpretation: we record what the XML
// says, not what it means semantically.
// ---------------------------------------------------------------------------

/** Qualified XML name with optional namespace information. */
export type QualifiedName = {
  prefix?: string;
  localName: string;
  namespaceUri?: string;
};

/** Exact source evidence for a raw fact. */
export type SourceRef = {
  partUri: string;
  xpathLikePath: string;
  line?: number;
  column?: number;
};

/** Structural value category — intentionally non-semantic. */
export type ValueKind = 'boolean' | 'integer' | 'decimal' | 'string' | 'empty' | 'unknown';

/** Normalized attribute value with raw evidence preserved. */
export type NormalizedValue = {
  raw: string;
  normalized: string;
  kind: ValueKind;
  truncated: boolean;
};

/** Markup compatibility context for facts inside mc:AlternateContent. */
export type MarkupCompatibilityContext = {
  branch: 'choice' | 'fallback' | null;
  alternateContentDepth: number;
};

/** The kinds of raw syntax facts we emit. */
export type FactKind = 'element' | 'attribute' | 'processing-instruction' | 'comment';

/** A single raw syntax fact — the core unit of Layer 0 analysis. */
export type RawSurfaceFact = {
  rawFactId: string;
  docId: string;
  docFingerprint: string;
  partUri: string;
  partKind: PartKind;
  factKind: FactKind;
  pathSignature: string;
  xpathLikePath: string;
  sourceRef: SourceRef;
  qname?: QualifiedName;
  attributeName?: QualifiedName;
  value?: NormalizedValue;
  markupCompatibilityContext?: MarkupCompatibilityContext;
  parentPathSignature?: string;
};

// ---------------------------------------------------------------------------
// Part Classification
// ---------------------------------------------------------------------------

export type PartKind =
  | 'main-document'
  | 'header'
  | 'footer'
  | 'footnotes'
  | 'endnotes'
  | 'comments'
  | 'comments-extended'
  | 'styles'
  | 'numbering'
  | 'settings'
  | 'theme'
  | 'font-table'
  | 'glossary-document'
  | 'relationships'
  | 'content-types'
  | 'custom-xml'
  | 'doc-props'
  | 'unknown-xml-part';

/** Classification of a package entry: XML (scannable) or binary. */
export type PackageEntryKind = 'xml' | 'binary';

/** A single entry in the package index. */
export type PackageEntry = {
  path: string;
  entryKind: PackageEntryKind;
  partKind: PartKind;
  sizeBytes: number;
  parseStatus: 'success' | 'partial' | 'failed' | 'skipped';
};

/** OPC relationship triple extracted from .rels files. */
export type RelationshipRecord = {
  sourcePartUri: string;
  relationshipPartUri: string;
  id: string;
  type: string;
  target: string;
  targetMode?: string;
};

// ---------------------------------------------------------------------------
// Scan Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning';

export type DiagnosticCode = 'xml-parse-error' | 'invalid-utf8' | 'truncated-entry' | 'not-xml' | 'unknown-error';

export type ScanDiagnostic = {
  partUri: string;
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  offset?: number;
  line?: number;
  column?: number;
};

// ---------------------------------------------------------------------------
// Per-Document Artifacts
// ---------------------------------------------------------------------------

/** Output of package-index.json. */
export type PackageIndex = {
  docId: string;
  docFingerprint: string;
  entries: PackageEntry[];
  relationships: RelationshipRecord[];
  scanDiagnostics: ScanDiagnostic[];
};

/** Signature count entry used in summaries. */
export type SignatureCount = {
  pathSignature: string;
  count: number;
};

/** Per-document raw summary. */
export type RawDocSummary = {
  docId: string;
  docFingerprint: string;
  totalFacts: number;
  countsByPartKind: Record<string, number>;
  countsByFactKind: Record<string, number>;
  countsByPathSignature: Record<string, number>;
  countsByQName: Record<string, number>;
  countsByAttributeSignature: Record<string, number>;
  countsByRelationshipType: Record<string, number>;
  topSignatures: SignatureCount[];
  scanDiagnostics: ScanDiagnostic[];
};

/** Document metadata for output layout. */
export type DocMetadata = {
  docId: string;
  docFingerprint: string;
  sourceRelativePath?: string;
};

// ---------------------------------------------------------------------------
// Corpus Artifacts
// ---------------------------------------------------------------------------

/** Corpus-wide raw summary. */
export type CorpusRawSummary = {
  totalDocuments: number;
  totalFacts: number;
  countsByPartKind: Record<string, number>;
  countsByFactKind: Record<string, number>;
  countsByPathSignature: Record<string, number>;
  countsByRelationshipType: Record<string, number>;
  topSignatures: SignatureCount[];
  diagnosticCounts: Record<string, number>;
};

/** Signature matrix: which signatures appear in which documents. */
export type SignatureMatrixEntry = {
  pathSignature: string;
  documentCount: number;
  totalCount: number;
  docIds: string[];
};

/** Example fact for a given signature. */
export type SignatureExample = {
  pathSignature: string;
  examples: Array<{
    docId: string;
    xpathLikePath: string;
    value?: NormalizedValue;
  }>;
};

// ---------------------------------------------------------------------------
// Public API Types
// ---------------------------------------------------------------------------

export type RawSurfaceDocumentResult = {
  metadata: DocMetadata;
  packageIndex: PackageIndex;
  facts: RawSurfaceFact[];
  summary: RawDocSummary;
};

export type ScanCorpusOptions = {
  /** Maximum examples to keep per signature. */
  maxExamplesPerSignature?: number;
};

export type RawSurfaceCorpusResult = {
  documents: RawSurfaceDocumentResult[];
  corpusSummary: CorpusRawSummary;
  signatureMatrix: SignatureMatrixEntry[];
  examplesBySignature: SignatureExample[];
};
