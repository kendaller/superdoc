// ---------------------------------------------------------------------------
// Support Matrix Types
// ---------------------------------------------------------------------------
// Type definitions for the Layer 2 support matrix: a join of the universe
// against current product support status and v2 target status.
// ---------------------------------------------------------------------------

/** Controlled status vocabulary for support assessment. */
export type SupportStatus = 'yes' | 'partial' | 'no' | 'unknown' | 'not-applicable';

/** A single entry in the hand-curated support-input.json. */
export type SupportInputEntry = {
  featureKey: string;
  import: SupportStatus;
  layout: SupportStatus;
  render: SupportStatus;
  importNote?: string;
  layoutNote?: string;
  renderNote?: string;
  v2SemanticRead?: SupportStatus;
  v2SemanticWrite?: SupportStatus;
  v2SemanticReadNote?: string;
  v2SemanticWriteNote?: string;
};

/** The full support input file shape. */
export type SupportInput = {
  schemaVersion: 1;
  entries: SupportInputEntry[];
};

/** A single row in the computed support matrix. */
export type SupportMatrixRow = {
  featureKey: string;
  tier: string;
  presentInCorpus: true;
  docCount: number;
  occurrenceCount: number;
  currentSuperDoc: {
    import: SupportStatus;
    layout: SupportStatus;
    render: SupportStatus;
    importNote?: string;
    layoutNote?: string;
    renderNote?: string;
  };
  v2Target: {
    semanticRead: SupportStatus;
    semanticWrite: SupportStatus;
    semanticReadNote?: string;
    semanticWriteNote?: string;
  };
};

/** The complete support matrix artifact. */
export type SupportMatrix = {
  schemaVersion: 1;
  rows: SupportMatrixRow[];
  /** Feature keys in the universe that are missing from support-input.json. */
  missingFromInput: string[];
  /** Feature keys in support-input.json that are not in the universe. */
  extraInInput: string[];
};
