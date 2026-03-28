// ---------------------------------------------------------------------------
// Dependency manifest for windowed projection
//
// Collects typed references to external resources encountered during
// projection of a window. The manifest tells downstream consumers
// (enrichment scheduler, streaming host) what needs to be fetched and
// at what priority.
// ---------------------------------------------------------------------------

// ---- Manifest types ---------------------------------------------------------

export type DependencyManifest = {
  readonly headerFooterRefs: ReadonlyArray<{
    relationshipId: string;
    type: 'header' | 'footer';
  }>;
  readonly footnoteRefs: ReadonlyArray<{ footnoteId: string }>;
  readonly endnoteRefs: ReadonlyArray<{ endnoteId: string }>;
  readonly commentRefs: ReadonlyArray<{ commentId: string }>;
  readonly imageRefs: ReadonlyArray<{
    relationshipId: string;
    sourcePartUri: string;
  }>;
  readonly hyperlinkRefs: ReadonlyArray<{ relationshipId: string }>;
};

// ---- Collector --------------------------------------------------------------

export type DependencyCollector = {
  addHeaderFooter(relationshipId: string, type: 'header' | 'footer'): void;
  addFootnote(footnoteId: string): void;
  addEndnote(endnoteId: string): void;
  addComment(commentId: string): void;
  addImage(relationshipId: string, sourcePartUri: string): void;
  addHyperlink(relationshipId: string): void;
  finalize(): DependencyManifest;
};

/**
 * Create a dependency collector that deduplicates references.
 */
export function createDependencyCollector(): DependencyCollector {
  const headerFooters = new Map<string, 'header' | 'footer'>();
  const footnotes = new Set<string>();
  const endnotes = new Set<string>();
  const comments = new Set<string>();
  const images = new Map<string, string>(); // relId → sourcePartUri
  const hyperlinks = new Set<string>();

  return {
    addHeaderFooter(relId, type) {
      headerFooters.set(relId, type);
    },
    addFootnote(id) {
      footnotes.add(id);
    },
    addEndnote(id) {
      endnotes.add(id);
    },
    addComment(id) {
      comments.add(id);
    },
    addImage(relId, sourcePartUri) {
      images.set(relId, sourcePartUri);
    },
    addHyperlink(relId) {
      hyperlinks.add(relId);
    },
    finalize(): DependencyManifest {
      return {
        headerFooterRefs: [...headerFooters.entries()].map(([relationshipId, type]) => ({ relationshipId, type })),
        footnoteRefs: [...footnotes].map((footnoteId) => ({ footnoteId })),
        endnoteRefs: [...endnotes].map((endnoteId) => ({ endnoteId })),
        commentRefs: [...comments].map((commentId) => ({ commentId })),
        imageRefs: [...images.entries()].map(([relationshipId, sourcePartUri]) => ({
          relationshipId,
          sourcePartUri,
        })),
        hyperlinkRefs: [...hyperlinks].map((relationshipId) => ({
          relationshipId,
        })),
      };
    },
  };
}
