// ---------------------------------------------------------------------------
// Benchmark corpus manifest — fixed matrix of document classes.
//
// The corpus is not one synthetic sample. It defines a structured matrix
// of document sizes and content profiles used for repeatable benchmarking.
// ---------------------------------------------------------------------------

/** Document size class per the master plan. */
export type DocumentClass = "A" | "B" | "C" | "D";

/** Content profile tags describing document characteristics. */
export type ContentProfile =
  | "text-only"
  | "tables"
  | "images"
  | "mixed"
  | "comments"
  | "headers-footers"
  | "notes"
  | "lists"
  | "sections";

/** A single entry in the benchmark corpus manifest. */
export type CorpusEntry = {
  readonly id: string;
  readonly class: DocumentClass;
  readonly label: string;
  readonly description: string;
  readonly profiles: readonly ContentProfile[];
  readonly bytes: number;
  readonly estimatedPages: number;
  readonly path: string;
};

/** The full corpus manifest with metadata. */
export type CorpusManifest = {
  readonly version: 1;
  readonly description: string;
  readonly entries: readonly CorpusEntry[];
};

// ---- Class metadata --------------------------------------------------------

type ClassMetadata = {
  readonly name: string;
  readonly purpose: string;
  readonly pageRange: string;
};

export const DOCUMENT_CLASSES: Record<DocumentClass, ClassMetadata> = {
  A: {
    name: "Small",
    purpose: "Establish baseline overhead; ensure fast path doesn't regress small docs",
    pageRange: "1-10 pages",
  },
  B: {
    name: "Medium",
    purpose: "Represent common interactive editing documents",
    pageRange: "10-30 pages",
  },
  C: {
    name: "Large",
    purpose: "Primary TTFP target for enterprise documents",
    pageRange: "100-300 pages",
  },
  D: {
    name: "Extreme",
    purpose: "Force architectural decisions around memory, cancellation, streaming",
    pageRange: "500+ pages",
  },
};

// ---- Default manifest (placeholder entries, populated after corpus upload) --

/**
 * Default corpus manifest with placeholder entries.
 *
 * These entries define the target matrix. `path` and `bytes` are filled in
 * after actual benchmark documents are uploaded to the corpus.
 * Use `updateManifestEntry()` to fill in real values after upload.
 */
export const DEFAULT_CORPUS_MANIFEST: CorpusManifest = {
  version: 1,
  description: "V2 fast-first-paint benchmark corpus",
  entries: [
    // ---- Class A: Small ----------------------------------------------------
    {
      id: "a-simple-business",
      class: "A",
      label: "Simple business doc",
      description: "Single-section business document with basic formatting",
      profiles: ["text-only"],
      bytes: 0,
      estimatedPages: 3,
      path: "",
    },
    {
      id: "a-table-heavy",
      class: "A",
      label: "Short table-heavy doc",
      description: "Small document dominated by tables",
      profiles: ["tables"],
      bytes: 0,
      estimatedPages: 5,
      path: "",
    },
    {
      id: "a-with-images",
      class: "A",
      label: "Short image-containing doc",
      description: "Small document with embedded images",
      profiles: ["images"],
      bytes: 0,
      estimatedPages: 4,
      path: "",
    },

    // ---- Class B: Medium ---------------------------------------------------
    {
      id: "b-mixed-format",
      class: "B",
      label: "Mixed-format (10-30p)",
      description: "Medium doc with paragraphs, tables, lists, and basic formatting",
      profiles: ["mixed", "tables", "lists"],
      bytes: 0,
      estimatedPages: 20,
      path: "",
    },
    {
      id: "b-with-comments",
      class: "B",
      label: "Commented doc (10-30p)",
      description: "Medium doc with review comments present",
      profiles: ["mixed", "comments"],
      bytes: 0,
      estimatedPages: 15,
      path: "",
    },

    // ---- Class C: Large ----------------------------------------------------
    {
      id: "c-enterprise-mixed",
      class: "C",
      label: "Enterprise mixed (100-300p)",
      description: "Large enterprise document with mixed sections, tables, headers/footers",
      profiles: ["mixed", "tables", "headers-footers", "sections"],
      bytes: 0,
      estimatedPages: 150,
      path: "",
    },
    {
      id: "c-table-heavy",
      class: "C",
      label: "Table-heavy enterprise (100-300p)",
      description: "Large document dominated by complex tables",
      profiles: ["tables", "headers-footers"],
      bytes: 0,
      estimatedPages: 200,
      path: "",
    },
    {
      id: "c-with-notes",
      class: "C",
      label: "Enterprise with notes (100-300p)",
      description: "Large document with footnotes, endnotes, and comments",
      profiles: ["mixed", "notes", "comments", "headers-footers"],
      bytes: 0,
      estimatedPages: 120,
      path: "",
    },

    // ---- Class D: Extreme --------------------------------------------------
    {
      id: "d-policy-manual",
      class: "D",
      label: "Policy manual (500+ p)",
      description: "Very large policy/compliance manual",
      profiles: ["mixed", "tables", "headers-footers", "sections"],
      bytes: 0,
      estimatedPages: 600,
      path: "",
    },
    {
      id: "d-image-heavy",
      class: "D",
      label: "Image-heavy (500+ p)",
      description: "Very large document with many embedded images",
      profiles: ["images", "mixed"],
      bytes: 0,
      estimatedPages: 500,
      path: "",
    },
    {
      id: "d-comment-heavy",
      class: "D",
      label: "Comment-heavy (500+ p)",
      description: "Very large document with extensive review comments and notes",
      profiles: ["mixed", "comments", "notes"],
      bytes: 0,
      estimatedPages: 700,
      path: "",
    },
  ],
};

// ---- Utilities -------------------------------------------------------------

/** Filter corpus entries by document class. */
export function entriesByClass(
  manifest: CorpusManifest,
  docClass: DocumentClass,
): readonly CorpusEntry[] {
  return manifest.entries.filter((e) => e.class === docClass);
}

/** Filter corpus entries by content profile. */
export function entriesByProfile(
  manifest: CorpusManifest,
  profile: ContentProfile,
): readonly CorpusEntry[] {
  return manifest.entries.filter((e) => e.profiles.includes(profile));
}

/** Get a single entry by ID, or undefined. */
export function getEntry(
  manifest: CorpusManifest,
  id: string,
): CorpusEntry | undefined {
  return manifest.entries.find((e) => e.id === id);
}

/** Check whether a manifest has any entries with real paths (ready to benchmark). */
export function isManifestPopulated(manifest: CorpusManifest): boolean {
  return manifest.entries.some((e) => e.path !== "" && e.bytes > 0);
}
