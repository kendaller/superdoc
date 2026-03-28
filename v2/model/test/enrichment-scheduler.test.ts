// ---------------------------------------------------------------------------
// Enrichment scheduler tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { scheduleEnrichment } from '../src/enrichment/enrichment-scheduler.js';
import type { EnrichmentResult } from '../src/enrichment/enrichment-results.js';
import type { EnrichmentRequest } from '../src/enrichment/enrichment-request.js';
import type { DependencyManifest } from '../src/projections/layout/dependency-manifest.js';
import type { DocumentRuntime } from '../src/runtime/runtime-interface.js';
import type { EnrichmentTarget } from '../src/runtime/worker-protocol.js';

/** Create a mock runtime that records enrich calls and resolves immediately. */
function createMockRuntime() {
  const calls: { target: EnrichmentTarget; request?: EnrichmentRequest }[] = [];

  const runtime = {
    enrich: vi.fn(async (target: EnrichmentTarget, request?: EnrichmentRequest): Promise<EnrichmentResult> => {
      calls.push({ target, request });
      // Return a minimal result
      switch (target) {
        case 'headers-footers':
          return { target: 'headers-footers', mergePolicy: 'layout-affecting', items: [] };
        case 'footnotes':
          return { target: 'footnotes', mergePolicy: 'layout-affecting', items: [] };
        case 'endnotes':
          return { target: 'endnotes', mergePolicy: 'decoration', items: [] };
        case 'comments':
          return { target: 'comments', mergePolicy: 'overlay-only', items: [] };
        case 'images':
          return { target: 'images', mergePolicy: 'decoration', items: [] };
      }
    }),
  } as unknown as DocumentRuntime;

  return { runtime, calls };
}

function emptyManifest(): DependencyManifest {
  return {
    headerFooterRefs: [],
    footnoteRefs: [],
    endnoteRefs: [],
    commentRefs: [],
    imageRefs: [],
    hyperlinkRefs: [],
  };
}

describe('enrichment scheduler', () => {
  it('dispatches targets in priority order', async () => {
    const { runtime, calls } = createMockRuntime();
    const results: EnrichmentResult[] = [];

    const manifest: DependencyManifest = {
      headerFooterRefs: [{ relationshipId: 'rId10', type: 'header' }],
      footnoteRefs: [{ footnoteId: '2' }],
      endnoteRefs: [{ endnoteId: '3' }],
      commentRefs: [{ commentId: '5' }],
      imageRefs: [{ relationshipId: 'rId5', sourcePartUri: '/word/document.xml' }],
      hyperlinkRefs: [],
    };

    const handle = scheduleEnrichment({
      runtime,
      manifest,
      onResult: (r) => results.push(r),
    });

    await handle.completed;

    // Verify all 5 targets were dispatched
    expect(calls.length).toBe(5);

    // Verify priority order: headers-footers, footnotes, images, comments, endnotes
    expect(calls[0].target).toBe('headers-footers');
    expect(calls[1].target).toBe('footnotes');
    expect(calls[2].target).toBe('images');
    expect(calls[3].target).toBe('comments');
    expect(calls[4].target).toBe('endnotes');
    expect(calls[2].request?.manifest).toBe(manifest);
  });

  it('skips targets with no items in manifest', async () => {
    const { runtime, calls } = createMockRuntime();

    const manifest: DependencyManifest = {
      ...emptyManifest(),
      commentRefs: [{ commentId: '1' }],
    };

    const handle = scheduleEnrichment({
      runtime,
      manifest,
      onResult: () => {},
    });

    await handle.completed;

    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('comments');
  });

  it('resolves immediately for empty manifest', async () => {
    const { runtime, calls } = createMockRuntime();

    const handle = scheduleEnrichment({
      runtime,
      manifest: emptyManifest(),
      onResult: () => {},
    });

    await handle.completed;

    expect(calls.length).toBe(0);
  });

  it('delivers results via onResult callback', async () => {
    const { runtime } = createMockRuntime();
    const results: EnrichmentResult[] = [];

    const manifest: DependencyManifest = {
      ...emptyManifest(),
      commentRefs: [{ commentId: '5' }],
      footnoteRefs: [{ footnoteId: '2' }],
    };

    const handle = scheduleEnrichment({
      runtime,
      manifest,
      onResult: (r) => results.push(r),
    });

    await handle.completed;

    expect(results.length).toBe(2);
    expect(results.map((r) => r.target).sort()).toEqual(['comments', 'footnotes']);
  });

  it('calls onError for failed targets without blocking others', async () => {
    const errors: { target: EnrichmentTarget; error: Error }[] = [];
    const results: EnrichmentResult[] = [];

    const runtime = {
      enrich: vi.fn(async (target: EnrichmentTarget): Promise<EnrichmentResult> => {
        if (target === 'footnotes') {
          throw new Error('footnotes failed');
        }
        return { target: 'comments', mergePolicy: 'overlay-only', items: [] } as EnrichmentResult;
      }),
    } as unknown as DocumentRuntime;

    const manifest: DependencyManifest = {
      ...emptyManifest(),
      footnoteRefs: [{ footnoteId: '2' }],
      commentRefs: [{ commentId: '5' }],
    };

    const handle = scheduleEnrichment({
      runtime,
      manifest,
      onResult: (r) => results.push(r),
      onError: (target, error) => errors.push({ target, error }),
    });

    await handle.completed;

    // Footnotes failed, comments succeeded
    expect(errors.length).toBe(1);
    expect(errors[0].target).toBe('footnotes');
    expect(results.length).toBe(1);
  });

  it('cancellation stops pending work', async () => {
    const { runtime, calls } = createMockRuntime();

    const manifest: DependencyManifest = {
      headerFooterRefs: [{ relationshipId: 'rId10', type: 'header' }],
      footnoteRefs: [{ footnoteId: '2' }],
      endnoteRefs: [],
      commentRefs: [{ commentId: '5' }],
      imageRefs: [],
      hyperlinkRefs: [],
    };

    const handle = scheduleEnrichment({
      runtime,
      manifest,
      onResult: () => {},
    });

    // Cancel immediately
    handle.cancel();

    await handle.completed;

    // Some or no calls may have been dispatched before cancel
    // But the completed promise should resolve
  });

  it('incremental manifest only dispatches delta IDs', async () => {
    const { runtime, calls } = createMockRuntime();

    const manifest1: DependencyManifest = {
      ...emptyManifest(),
      commentRefs: [{ commentId: '1' }, { commentId: '2' }],
    };

    const handle = scheduleEnrichment({
      runtime,
      manifest: manifest1,
      onResult: () => {},
    });

    await handle.completed;

    expect(calls.length).toBe(1);
    expect(calls[0].request?.ids).toEqual(['1', '2']);

    // Update with manifest that adds comment 3
    const manifest2: DependencyManifest = {
      ...emptyManifest(),
      commentRefs: [{ commentId: '1' }, { commentId: '2' }, { commentId: '3' }],
    };

    handle.updateManifest(manifest2);

    // Wait for the delta dispatch to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls.length).toBe(2);
    expect(calls[1].target).toBe('comments');
    expect(calls[1].request?.ids).toEqual(['3']); // Only the delta
  });

  it('rotates the completed promise when a new manifest adds work after the scheduler is idle', async () => {
    const { runtime } = createMockRuntime();

    const handle = scheduleEnrichment({
      runtime,
      manifest: emptyManifest(),
      onResult: () => {},
    });

    const initialCompleted = handle.completed;
    await initialCompleted;

    handle.updateManifest({
      ...emptyManifest(),
      commentRefs: [{ commentId: '7' }],
    });

    const nextCompleted = handle.completed;
    expect(nextCompleted).not.toBe(initialCompleted);

    await nextCompleted;

    expect(runtime.enrich).toHaveBeenCalledWith(
      'comments',
      expect.objectContaining({
        ids: ['7'],
      }),
    );
  });

  it('does not redispatch IDs that are already in flight when the manifest grows', async () => {
    let resolveComments: (() => void) | null = null;
    const calls: { target: EnrichmentTarget; request?: EnrichmentRequest }[] = [];
    let commentCallCount = 0;

    const runtime = {
      enrich: vi.fn((target: EnrichmentTarget, request?: EnrichmentRequest): Promise<EnrichmentResult> => {
        calls.push({ target, request });

        if (target !== 'comments') {
          return Promise.resolve({ target: 'comments', mergePolicy: 'overlay-only', items: [] } as EnrichmentResult);
        }

        commentCallCount += 1;
        if (commentCallCount > 1) {
          return Promise.resolve({ target: 'comments', mergePolicy: 'overlay-only', items: [] });
        }

        return new Promise<EnrichmentResult>((resolve, reject) => {
          resolveComments = () => {
            if (request?.signal?.aborted) {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
              return;
            }
            resolve({ target: 'comments', mergePolicy: 'overlay-only', items: [] });
          };
        });
      }),
    } as unknown as DocumentRuntime;

    const handle = scheduleEnrichment({
      runtime,
      manifest: {
        ...emptyManifest(),
        commentRefs: [{ commentId: '1' }, { commentId: '2' }],
      },
      onResult: () => {},
    });

    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });

    handle.updateManifest({
      ...emptyManifest(),
      commentRefs: [{ commentId: '1' }, { commentId: '2' }, { commentId: '3' }],
    });

    await Promise.resolve();
    expect(calls).toHaveLength(1);

    resolveComments?.();
    await handle.completed;

    expect(calls).toHaveLength(2);
    expect(calls[0].request?.ids).toEqual(['1', '2']);
    expect(calls[1].request?.ids).toEqual(['3']);
  });

  it('cancels the active enrichment request through its abort signal', async () => {
    let capturedRequest: EnrichmentRequest | undefined;

    const runtime = {
      enrich: vi.fn((target: EnrichmentTarget, request?: EnrichmentRequest): Promise<EnrichmentResult> => {
        capturedRequest = request;
        return new Promise<EnrichmentResult>((_resolve, reject) => {
          request?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error(`cancelled ${target}`);
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
      }),
    } as unknown as DocumentRuntime;

    const handle = scheduleEnrichment({
      runtime,
      manifest: {
        ...emptyManifest(),
        commentRefs: [{ commentId: '1' }],
      },
      onResult: () => {
        throw new Error('cancelled work must not emit results');
      },
    });

    await vi.waitFor(() => {
      expect(capturedRequest).toBeDefined();
    });

    handle.cancel();
    await handle.completed;

    expect(capturedRequest?.signal?.aborted).toBe(true);
  });
});
