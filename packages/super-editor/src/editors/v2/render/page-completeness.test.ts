import { describe, it, expect, beforeEach } from 'vitest';
import { PageCompletenessTracker } from './page-completeness.js';
import type { Layout } from '@superdoc/contracts';

function makeLayout(pageNumbers: number[]): Layout {
  return {
    pageSize: { w: 612, h: 792 },
    pages: pageNumbers.map((n) => ({
      number: n,
      fragments: [],
    })),
  };
}

describe('PageCompletenessTracker', () => {
  let tracker: PageCompletenessTracker;

  beforeEach(() => {
    tracker = new PageCompletenessTracker();
  });

  it('returns default incomplete for untracked pages', () => {
    const c = tracker.getCompleteness(1);
    expect(c.bodyComplete).toBe(false);
    expect(c.headerFooterComplete).toBe(false);
    expect(c.notesComplete).toBe(false);
    expect(c.imagesComplete).toBe(false);
    expect(c.commentsComplete).toBe(false);
    expect(c.isFullyComplete).toBe(false);
    expect(c.hasDeferredDependencies).toBe(false);
  });

  it('markBodyCompleteUpTo marks pages 1..N as body-complete', () => {
    tracker.syncWithLayout(makeLayout([1, 2, 3, 4, 5]));
    tracker.markBodyCompleteUpTo(3);

    expect(tracker.getCompleteness(1).bodyComplete).toBe(true);
    expect(tracker.getCompleteness(2).bodyComplete).toBe(true);
    expect(tracker.getCompleteness(3).bodyComplete).toBe(true);
    expect(tracker.getCompleteness(4).bodyComplete).toBe(false);
    expect(tracker.getCompleteness(5).bodyComplete).toBe(false);
  });

  it('markAllBodyComplete marks every tracked page as body-complete', () => {
    tracker.syncWithLayout(makeLayout([1, 2, 3]));
    tracker.markAllBodyComplete();

    expect(tracker.getCompleteness(1).bodyComplete).toBe(true);
    expect(tracker.getCompleteness(2).bodyComplete).toBe(true);
    expect(tracker.getCompleteness(3).bodyComplete).toBe(true);
  });

  it('markAllBodyComplete applies to pages added after the call', () => {
    tracker.markAllBodyComplete();
    tracker.syncWithLayout(makeLayout([1, 2, 3, 4]));

    expect(tracker.getCompleteness(4).bodyComplete).toBe(true);
  });

  it('setEnrichmentComplete updates the correct field', () => {
    tracker.syncWithLayout(makeLayout([1]));

    tracker.setEnrichmentComplete(1, 'comments');
    expect(tracker.getCompleteness(1).commentsComplete).toBe(true);
    expect(tracker.getCompleteness(1).headerFooterComplete).toBe(false);

    tracker.setEnrichmentComplete(1, 'headers-footers');
    expect(tracker.getCompleteness(1).headerFooterComplete).toBe(true);

    tracker.setEnrichmentComplete(1, 'footnotes');
    expect(tracker.getCompleteness(1).notesComplete).toBe(true);

    tracker.setEnrichmentComplete(1, 'images');
    expect(tracker.getCompleteness(1).imagesComplete).toBe(true);
  });

  it('setEnrichmentCompleteAll marks all tracked pages', () => {
    tracker.syncWithLayout(makeLayout([1, 2, 3]));
    tracker.setEnrichmentCompleteAll('comments');

    expect(tracker.getCompleteness(1).commentsComplete).toBe(true);
    expect(tracker.getCompleteness(2).commentsComplete).toBe(true);
    expect(tracker.getCompleteness(3).commentsComplete).toBe(true);
  });

  it('markAllEnrichmentComplete applies to pages added later', () => {
    tracker.markAllBodyComplete();
    tracker.markAllEnrichmentComplete();
    tracker.syncWithLayout(makeLayout([1, 2]));

    expect(tracker.getCompleteness(1).isFullyComplete).toBe(true);
    expect(tracker.getCompleteness(2).isFullyComplete).toBe(true);
  });

  it('isFullyComplete is derived correctly', () => {
    tracker.syncWithLayout(makeLayout([1]));

    tracker.markBodyCompleteUpTo(1);
    expect(tracker.getCompleteness(1).isFullyComplete).toBe(false);
    expect(tracker.getCompleteness(1).hasDeferredDependencies).toBe(true);

    tracker.setEnrichmentComplete(1, 'headers-footers');
    tracker.setEnrichmentComplete(1, 'footnotes');
    tracker.setEnrichmentComplete(1, 'images');
    tracker.setEnrichmentComplete(1, 'comments');

    expect(tracker.getCompleteness(1).isFullyComplete).toBe(true);
    expect(tracker.getCompleteness(1).hasDeferredDependencies).toBe(false);
  });

  it('isDocumentComplete returns true only when all pages are fully complete', () => {
    tracker.syncWithLayout(makeLayout([1, 2]));
    expect(tracker.isDocumentComplete()).toBe(false);

    tracker.markAllBodyComplete();
    expect(tracker.isDocumentComplete()).toBe(false);

    for (const target of ['headers-footers', 'footnotes', 'images', 'comments'] as const) {
      tracker.setEnrichmentCompleteAll(target);
    }
    expect(tracker.isDocumentComplete()).toBe(true);
  });

  it('isDocumentStreaming returns true when any page is incomplete', () => {
    tracker.syncWithLayout(makeLayout([1, 2]));
    expect(tracker.isDocumentStreaming()).toBe(true);

    tracker.markAllBodyComplete();
    for (const target of ['headers-footers', 'footnotes', 'images', 'comments'] as const) {
      tracker.setEnrichmentCompleteAll(target);
    }
    expect(tracker.isDocumentStreaming()).toBe(false);
  });

  it('isDocumentStreaming returns true for empty tracker', () => {
    expect(tracker.isDocumentStreaming()).toBe(true);
  });

  it('isDocumentComplete returns false for empty tracker', () => {
    expect(tracker.isDocumentComplete()).toBe(false);
  });

  it('syncWithLayout removes stale pages', () => {
    tracker.syncWithLayout(makeLayout([1, 2, 3]));
    tracker.markBodyCompleteUpTo(3);

    // Layout changes — page 3 is gone
    tracker.syncWithLayout(makeLayout([1, 2]));

    // Page 3 completeness should be default (untracked)
    const c = tracker.getCompleteness(3);
    expect(c.bodyComplete).toBe(false);
  });

  it('syncWithLayout adds new pages', () => {
    tracker.syncWithLayout(makeLayout([1, 2]));
    tracker.syncWithLayout(makeLayout([1, 2, 3, 4]));

    // Pages 3 and 4 should exist (default incomplete)
    expect(tracker.getCompleteness(3).bodyComplete).toBe(false);
    expect(tracker.getCompleteness(4).bodyComplete).toBe(false);
  });

  it('reset clears all state', () => {
    tracker.syncWithLayout(makeLayout([1, 2, 3]));
    tracker.markAllBodyComplete();
    tracker.reset();

    expect(tracker.getCompleteness(1).bodyComplete).toBe(false);
    expect(tracker.isDocumentComplete()).toBe(false);
  });
});
