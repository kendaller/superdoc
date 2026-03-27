// ---------------------------------------------------------------------------
// Corpus Manifest Types
// ---------------------------------------------------------------------------
// The corpus manifest is a checked-in JSON file that defines the agreed set
// of documents for analysis. It is the single source of truth for what is in
// the corpus.
// ---------------------------------------------------------------------------

/** A single document entry in the corpus manifest. */
export type CorpusManifestEntry = {
  /** Human-readable document identifier (usually the relative path). */
  docId: string;
  /** Path to the .docx file, relative to the manifest file's directory. */
  sourceRelativePath: string;
  /**
   * SHA-256 hex fingerprint of the .docx bytes at the time the manifest was
   * agreed. When present, the loader verifies the on-disk bytes match. This
   * prevents silent corpus drift when files change under stable paths.
   */
  docFingerprint?: string;
  /** Optional tags for filtering. */
  tags?: string[];
};

/** The corpus manifest: an explicit, checked-in list of documents for analysis. */
export type CorpusManifest = {
  /** Schema version for forward compatibility. Must be 1. */
  schemaVersion: 1;
  /** Optional human-readable description of this corpus. */
  description?: string;
  /** The document entries. Must be sorted by docId. */
  documents: CorpusManifestEntry[];
};
