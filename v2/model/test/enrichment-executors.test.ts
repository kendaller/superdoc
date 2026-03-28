// ---------------------------------------------------------------------------
// Enrichment executor tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { open } from '../src/session/open.js';
import { InProcessRuntimeV2 } from '../src/runtime/in-process-v2.js';
import { executeHeadersFootersEnrichment } from '../src/enrichment/executors/headers-footers-executor.js';
import {
  executeFootnotesEnrichment,
  executeEndnotesEnrichment,
  executeCommentsEnrichment,
} from '../src/enrichment/executors/annotations-executor.js';
import { executeImagesEnrichment } from '../src/enrichment/executors/images-executor.js';
import { executeEnrichment } from '../src/enrichment/executors/index.js';
import { classifyMergeAction } from '../src/enrichment/merge-policy.js';
import {
  createDocxWithHeadersFooters,
  createDocxWithFootnotes,
  createDocxWithEndnotes,
  createDocxWithComments,
} from './helpers/create-enrichment-docx.js';
import { createInlineImageDocx } from './helpers/create-rich-docx.js';
import type { DependencyManifest } from '../src/projections/layout/dependency-manifest.js';

async function openAndReady(bytes: Uint8Array) {
  const handle = await open(bytes);
  await handle.ready('render-shell');
  return handle;
}

// ---- Headers/footers --------------------------------------------------------

describe('headers/footers enrichment', () => {
  it('projects header and footer content to FlowBlocks', async () => {
    const handle = await openAndReady(createDocxWithHeadersFooters());
    const result = await executeHeadersFootersEnrichment(handle);

    expect(result.target).toBe('headers-footers');
    expect(result.mergePolicy).toBe('layout-affecting');
    expect(result.items.length).toBe(2);

    const header = result.items.find((i) => i.type === 'header');
    expect(header).toBeDefined();
    expect(header!.blocks.length).toBeGreaterThan(0);
    expect(header!.blocks[0].kind).toBe('paragraph');

    const footer = result.items.find((i) => i.type === 'footer');
    expect(footer).toBeDefined();
    expect(footer!.blocks.length).toBeGreaterThan(0);

    await handle.close();
  });

  it('filters by relationship IDs', async () => {
    const handle = await openAndReady(createDocxWithHeadersFooters());
    const result = await executeHeadersFootersEnrichment(handle, ['rId10']);

    expect(result.items.length).toBe(1);
    expect(result.items[0].type).toBe('header');
    expect(result.items[0].relationshipId).toBe('rId10');

    await handle.close();
  });

  it('returns empty items when no headers/footers exist', async () => {
    const handle = await openAndReady(createDocxWithFootnotes()); // No headers/footers
    const result = await executeHeadersFootersEnrichment(handle);

    expect(result.items).toEqual([]);

    await handle.close();
  });
});

// ---- Footnotes --------------------------------------------------------------

describe('footnotes enrichment', () => {
  it('projects footnote content, excluding system notes', async () => {
    const handle = await openAndReady(createDocxWithFootnotes());
    const result = await executeFootnotesEnrichment(handle);

    expect(result.target).toBe('footnotes');
    expect(result.mergePolicy).toBe('layout-affecting');

    // Should only have footnote ID 2 (system notes 0 and 1 are excluded)
    expect(result.items.length).toBe(1);
    expect(result.items[0].wordId).toBe('2');
    expect(result.items[0].blocks.length).toBeGreaterThan(0);
    expect(result.items[0].blocks[0].kind).toBe('paragraph');

    await handle.close();
  });

  it('filters by specific IDs', async () => {
    const handle = await openAndReady(createDocxWithFootnotes());
    const result = await executeFootnotesEnrichment(handle, ['2']);

    expect(result.items.length).toBe(1);
    expect(result.items[0].wordId).toBe('2');

    await handle.close();
  });

  it('returns empty for missing footnotes part', async () => {
    const handle = await openAndReady(createDocxWithComments()); // No footnotes
    const result = await executeFootnotesEnrichment(handle);

    expect(result.items).toEqual([]);

    await handle.close();
  });
});

// ---- Endnotes ---------------------------------------------------------------

describe('endnotes enrichment', () => {
  it('projects endnote content, excluding system notes', async () => {
    const handle = await openAndReady(createDocxWithEndnotes());
    const result = await executeEndnotesEnrichment(handle);

    expect(result.target).toBe('endnotes');
    expect(result.mergePolicy).toBe('decoration');
    expect(result.items.length).toBe(1);
    expect(result.items[0].wordId).toBe('2');
    expect(result.items[0].blocks.length).toBeGreaterThan(0);

    await handle.close();
  });
});

// ---- Comments ---------------------------------------------------------------

describe('comments enrichment', () => {
  it('projects comment content with metadata', async () => {
    const handle = await openAndReady(createDocxWithComments());
    const result = await executeCommentsEnrichment(handle);

    expect(result.target).toBe('comments');
    expect(result.mergePolicy).toBe('overlay-only');
    expect(result.items.length).toBe(1);

    const comment = result.items[0];
    expect(comment.commentId).toBe('5');
    expect(comment.author).toBe('Jane Doe');
    expect(comment.date).toBe('2024-01-15T10:30:00Z');
    expect(comment.initials).toBe('JD');
    expect(comment.blocks.length).toBeGreaterThan(0);
    expect(comment.blocks[0].kind).toBe('paragraph');

    await handle.close();
  });

  it('filters by specific IDs', async () => {
    const handle = await openAndReady(createDocxWithComments());
    const result = await executeCommentsEnrichment(handle, ['5']);

    expect(result.items.length).toBe(1);

    await handle.close();
  });

  it('returns empty for non-existent ID', async () => {
    const handle = await openAndReady(createDocxWithComments());
    const result = await executeCommentsEnrichment(handle, ['999']);

    expect(result.items).toEqual([]);

    await handle.close();
  });
});

// ---- Images -----------------------------------------------------------------

describe('images enrichment', () => {
  it('resolves image binary data with manifest', async () => {
    const handle = await openAndReady(createInlineImageDocx());
    const manifest: DependencyManifest = {
      headerFooterRefs: [],
      footnoteRefs: [],
      endnoteRefs: [],
      commentRefs: [],
      imageRefs: [{ relationshipId: 'rId5', sourcePartUri: '/word/document.xml' }],
      hyperlinkRefs: [],
    };

    const result = await executeImagesEnrichment(handle, manifest);

    expect(result.target).toBe('images');
    expect(result.mergePolicy).toBe('decoration');
    expect(result.items.length).toBe(1);

    const image = result.items[0];
    expect(image.relationshipId).toBe('rId5');
    expect(image.mimeType).toBe('image/png');
    expect(image.data).toBeInstanceOf(ArrayBuffer);
    expect(image.data.byteLength).toBeGreaterThan(0);

    await handle.close();
  });

  it('returns empty without manifest', async () => {
    const handle = await openAndReady(createInlineImageDocx());
    const result = await executeImagesEnrichment(handle);

    expect(result.items).toEqual([]);

    await handle.close();
  });
});

// ---- Top-level dispatch -----------------------------------------------------

describe('executeEnrichment dispatch', () => {
  it('dispatches to comments executor', async () => {
    const handle = await openAndReady(createDocxWithComments());
    const result = await executeEnrichment(handle, 'comments');

    expect(result.target).toBe('comments');
    expect(result.items.length).toBe(1);

    await handle.close();
  });

  it('dispatches to footnotes executor', async () => {
    const handle = await openAndReady(createDocxWithFootnotes());
    const result = await executeEnrichment(handle, 'footnotes');

    expect(result.target).toBe('footnotes');

    await handle.close();
  });

  it('dispatches to headers-footers executor', async () => {
    const handle = await openAndReady(createDocxWithHeadersFooters());
    const result = await executeEnrichment(handle, 'headers-footers');

    expect(result.target).toBe('headers-footers');
    expect(result.items.length).toBe(2);

    await handle.close();
  });

  it('dispatches to images executor when manifest context is provided', async () => {
    const handle = await openAndReady(createInlineImageDocx());
    const result = await executeEnrichment(handle, 'images', undefined, {
      headerFooterRefs: [],
      footnoteRefs: [],
      endnoteRefs: [],
      commentRefs: [],
      imageRefs: [{ relationshipId: 'rId5', sourcePartUri: '/word/document.xml' }],
      hyperlinkRefs: [],
    });

    expect(result.target).toBe('images');
    expect(result.items).toHaveLength(1);

    await handle.close();
  });
});

// ---- Runtime integration ---------------------------------------------------

describe('runtime enrich integration', () => {
  it('passes manifest context through the in-process runtime for images', async () => {
    const runtime = new InProcessRuntimeV2();
    await runtime.openSource(createInlineImageDocx());

    const result = await runtime.enrich('images', {
      ids: ['rId5'],
      manifest: {
        headerFooterRefs: [],
        footnoteRefs: [],
        endnoteRefs: [],
        commentRefs: [],
        imageRefs: [{ relationshipId: 'rId5', sourcePartUri: '/word/document.xml' }],
        hyperlinkRefs: [],
      },
    });

    expect(result.target).toBe('images');
    expect(result.items).toHaveLength(1);

    await runtime.close();
  });
});

// ---- Merge policy classification --------------------------------------------

describe('classifyMergeAction', () => {
  it('classifies comments as overlay', () => {
    const action = classifyMergeAction({
      target: 'comments',
      mergePolicy: 'overlay-only',
      items: [],
    });
    expect(action).toEqual({ kind: 'overlay', target: 'comments' });
  });

  it('classifies images as decoration', () => {
    const action = classifyMergeAction({
      target: 'images',
      mergePolicy: 'decoration',
      items: [],
    });
    expect(action).toEqual({ kind: 'decorate', target: 'images' });
  });

  it('classifies headers-footers as relayout', () => {
    const action = classifyMergeAction({
      target: 'headers-footers',
      mergePolicy: 'layout-affecting',
      items: [],
    });
    expect(action).toEqual({ kind: 'relayout', target: 'headers-footers' });
  });

  it('classifies footnotes as relayout', () => {
    const action = classifyMergeAction({
      target: 'footnotes',
      mergePolicy: 'layout-affecting',
      items: [],
    });
    expect(action).toEqual({ kind: 'relayout', target: 'footnotes' });
  });
});

// ---- Structured cloneability ------------------------------------------------

describe('structured cloneability', () => {
  it('enrichment results survive structuredClone', async () => {
    const handle = await openAndReady(createDocxWithComments());
    const result = await executeCommentsEnrichment(handle);

    const cloned = structuredClone(result);
    expect(cloned.target).toBe('comments');
    expect(cloned.items.length).toBe(1);
    expect(cloned.items[0].commentId).toBe('5');
    expect(cloned.items[0].blocks.length).toBeGreaterThan(0);

    await handle.close();
  });
});

// ---- Abort signal -----------------------------------------------------------

describe('abort signal support', () => {
  it('executor respects cancellation', async () => {
    const handle = await openAndReady(createDocxWithComments());
    const controller = new AbortController();
    controller.abort();

    await expect(executeCommentsEnrichment(handle, undefined, controller.signal)).rejects.toThrow('Aborted');

    await handle.close();
  });
});
