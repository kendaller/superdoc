import type { Layout } from '@superdoc/contracts';
import type { EnrichmentTarget } from '@superdoc/v2-model';
import type { PageCompleteness } from './streaming-host-types.js';

function createDefaultCompleteness(): PageCompleteness {
  return {
    bodyComplete: false,
    headerFooterComplete: false,
    notesComplete: false,
    imagesComplete: false,
    commentsComplete: false,
    isFullyComplete: false,
    hasDeferredDependencies: false,
  };
}

function recomputeDerived(page: PageCompleteness): void {
  const allEnriched = page.headerFooterComplete && page.notesComplete && page.imagesComplete && page.commentsComplete;

  page.isFullyComplete = page.bodyComplete && allEnriched;
  page.hasDeferredDependencies = page.bodyComplete && !allEnriched;
}

const ENRICHMENT_KEY: Record<EnrichmentTarget, keyof PageCompleteness> = {
  'headers-footers': 'headerFooterComplete',
  footnotes: 'notesComplete',
  endnotes: 'notesComplete',
  images: 'imagesComplete',
  comments: 'commentsComplete',
};

const ENRICHMENT_TARGETS = Object.keys(ENRICHMENT_KEY) as EnrichmentTarget[];

/**
 * Tracks page-level completeness for the streaming paginated host.
 *
 * Pages are identified by their 1-indexed page number from the Layout.
 */
export class PageCompletenessTracker {
  #pages = new Map<number, PageCompleteness>();
  #allBodyComplete = false;
  #completeTargets = new Set<EnrichmentTarget>();

  /** Mark pages 1..pageNumber as body-complete (content before this page is finalized). */
  markBodyCompleteUpTo(pageNumber: number): void {
    for (let n = 1; n <= pageNumber; n++) {
      const page = this.#ensurePage(n);
      page.bodyComplete = true;
      recomputeDerived(page);
    }
  }

  /** Mark all tracked pages as body-complete (all projection windows consumed). */
  markAllBodyComplete(): void {
    this.#allBodyComplete = true;
    for (const page of this.#pages.values()) {
      page.bodyComplete = true;
      recomputeDerived(page);
    }
  }

  /** Mark a specific enrichment target as complete for a page. */
  setEnrichmentComplete(pageNumber: number, target: EnrichmentTarget): void {
    const key = ENRICHMENT_KEY[target];
    if (!key) return;

    const page = this.#ensurePage(pageNumber);
    (page as Record<string, boolean>)[key] = true;
    recomputeDerived(page);
  }

  /** Mark an enrichment target as complete for all tracked pages. */
  setEnrichmentCompleteAll(target: EnrichmentTarget): void {
    const key = ENRICHMENT_KEY[target];
    if (!key) return;

    this.#completeTargets.add(target);
    for (const page of this.#pages.values()) {
      (page as Record<string, boolean>)[key] = true;
      recomputeDerived(page);
    }
  }

  /** Mark every enrichment target as complete for all tracked and future pages. */
  markAllEnrichmentComplete(): void {
    for (const target of ENRICHMENT_TARGETS) {
      this.setEnrichmentCompleteAll(target);
    }
  }

  /** Get completeness for a specific page. Returns default incomplete if not tracked. */
  getCompleteness(pageNumber: number): PageCompleteness {
    return this.#pages.get(pageNumber) ?? createDefaultCompleteness();
  }

  /** True when all tracked pages are fully complete. */
  isDocumentComplete(): boolean {
    if (this.#pages.size === 0) return false;
    for (const page of this.#pages.values()) {
      if (!page.isFullyComplete) return false;
    }
    return true;
  }

  /** True when any tracked page has incomplete fields. */
  isDocumentStreaming(): boolean {
    if (this.#pages.size === 0) return true;
    for (const page of this.#pages.values()) {
      if (!page.isFullyComplete) return true;
    }
    return false;
  }

  /** Sync tracker with current layout — ensures entries exist for all pages. */
  syncWithLayout(layout: Layout): void {
    const pageNumbers = new Set<number>();
    for (const page of layout.pages) {
      pageNumbers.add(page.number);
      this.#ensurePage(page.number);
    }

    // Remove stale pages no longer in layout
    for (const n of this.#pages.keys()) {
      if (!pageNumbers.has(n)) {
        this.#pages.delete(n);
      }
    }
  }

  /** Reset all tracking state. */
  reset(): void {
    this.#pages.clear();
    this.#allBodyComplete = false;
    this.#completeTargets.clear();
  }

  #ensurePage(pageNumber: number): PageCompleteness {
    let page = this.#pages.get(pageNumber);
    if (!page) {
      page = createDefaultCompleteness();
      if (this.#allBodyComplete) {
        page.bodyComplete = true;
      }
      for (const target of this.#completeTargets) {
        const key = ENRICHMENT_KEY[target];
        (page as Record<string, boolean>)[key] = true;
      }
      recomputeDerived(page);
      this.#pages.set(pageNumber, page);
    }
    return page;
  }
}
