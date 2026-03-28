// ---------------------------------------------------------------------------
// Windowed projection tests
//
// Validates:
// - Basic windowed projection produces correct FlowBlocks
// - Continuation tokens for window resumption
// - Stable IDs across overlapping windows
// - Table projection through the render-shell feeder
// - Section break handling (inline and body-level)
// - Dependency manifest collection
// - Abort signal support
// - Edge cases (empty window, past-end)
// - Equivalence with full semantic-model projection
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { open } from '../src/session/open.js';
import { projectWindowToFlowBlocks } from '../src/projections/layout/window-project.js';
import { projectToFlowBlocks } from '../src/projections/layout/project.js';
import { createStableIdAllocator } from '../src/projections/layout/stable-id.js';
import { createDependencyCollector } from '../src/projections/layout/dependency-manifest.js';
import type {
  FlowBlock,
  ParagraphBlock,
  TableBlock,
  SectionBreakBlock,
  TextRun,
} from '../src/projections/layout/types.js';
import type { RenderShellDocument } from '../src/render-shell/render-shell-document.js';
import { createMinimalDocx, createMultiParagraphDocx } from './helpers/create-test-docx.js';
import {
  createSectionBreakDocx,
  createSdtDocx,
  createTableDocx,
  createTocFieldDocx,
} from './helpers/create-rich-docx.js';

// ---- Helpers ----------------------------------------------------------------

async function getRenderShell(bytes: Uint8Array): Promise<{ shell: RenderShellDocument; close: () => Promise<void> }> {
  const handle = await open(bytes);
  await handle.ready('render-shell');
  const shell = handle.renderShell();
  if (!shell) throw new Error('RenderShellDocument not available after render-shell stage');
  return { shell, close: () => handle.close() };
}

function paragraphBlocks(blocks: FlowBlock[]): ParagraphBlock[] {
  return blocks.filter((b): b is ParagraphBlock => b.kind === 'paragraph');
}

function tableBlocks(blocks: FlowBlock[]): TableBlock[] {
  return blocks.filter((b): b is TableBlock => b.kind === 'table');
}

function sectionBreakBlocks(blocks: FlowBlock[]): SectionBreakBlock[] {
  return blocks.filter((b): b is SectionBreakBlock => b.kind === 'sectionBreak');
}

function textRuns(block: ParagraphBlock): TextRun[] {
  return block.runs.filter((run): run is TextRun => run.kind === 'text' || run.kind === undefined);
}

function paragraphText(block: ParagraphBlock): string {
  return textRuns(block)
    .map((run) => run.text)
    .join('');
}

// ---- StableIdAllocator unit tests -------------------------------------------

describe('StableIdAllocator', () => {
  it('produces deterministic IDs for the same anchor', () => {
    const ids1 = createStableIdAllocator();
    const ids2 = createStableIdAllocator();
    const anchor = {
      partUri: '/word/document.xml',
      nodeId: '/word/document.xml:element:42-84',
    };

    const id1 = ids1.blockId('paragraph', anchor);
    const id2 = ids2.blockId('paragraph', anchor);

    expect(id1).toBe(id2);
    expect(id1).toBe('b-word_document_xml_42_84-paragraph');
  });

  it('produces different IDs for different anchors', () => {
    const ids = createStableIdAllocator();
    const anchor1 = { partUri: '/word/document.xml', nodeId: 'n42' };
    const anchor2 = { partUri: '/word/document.xml', nodeId: 'n99' };

    expect(ids.blockId('paragraph', anchor1)).not.toBe(ids.blockId('paragraph', anchor2));
  });

  it('records blockId in blockToSourceRef but not subBlockId', () => {
    const ids = createStableIdAllocator();
    const anchor = { partUri: '/word/document.xml', nodeId: 'n42' };

    ids.blockId('paragraph', anchor);
    ids.subBlockId('tableRow', anchor);

    expect(ids.blockToSourceRef.has('b-word_document_xml_n42-paragraph')).toBe(true);
    expect(ids.blockToSourceRef.has('b-word_document_xml_n42-tableRow')).toBe(false);
  });

  it('produces valid DOM-safe IDs', () => {
    const ids = createStableIdAllocator();
    const anchor = { partUri: '/word/document.xml', nodeId: 'abc123' };
    const id = ids.blockId('paragraph', anchor);

    // No spaces, quotes, or special characters that break DOM attributes
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

// ---- DependencyCollector unit tests -----------------------------------------

describe('DependencyCollector', () => {
  it('deduplicates footnote refs', () => {
    const deps = createDependencyCollector();
    deps.addFootnote('1');
    deps.addFootnote('1');
    deps.addFootnote('2');

    const manifest = deps.finalize();
    expect(manifest.footnoteRefs).toHaveLength(2);
  });

  it('collects all six dependency kinds', () => {
    const deps = createDependencyCollector();
    deps.addHeaderFooter('rId5', 'header');
    deps.addFootnote('1');
    deps.addEndnote('2');
    deps.addComment('3');
    deps.addImage('rId8', '/word/document.xml');
    deps.addHyperlink('rId9');

    const manifest = deps.finalize();
    expect(manifest.headerFooterRefs).toHaveLength(1);
    expect(manifest.footnoteRefs).toHaveLength(1);
    expect(manifest.endnoteRefs).toHaveLength(1);
    expect(manifest.commentRefs).toHaveLength(1);
    expect(manifest.imageRefs).toHaveLength(1);
    expect(manifest.hyperlinkRefs).toHaveLength(1);
  });

  it('produces empty manifest when nothing is collected', () => {
    const deps = createDependencyCollector();
    const manifest = deps.finalize();

    expect(manifest.headerFooterRefs).toHaveLength(0);
    expect(manifest.footnoteRefs).toHaveLength(0);
    expect(manifest.endnoteRefs).toHaveLength(0);
    expect(manifest.commentRefs).toHaveLength(0);
    expect(manifest.imageRefs).toHaveLength(0);
    expect(manifest.hyperlinkRefs).toHaveLength(0);
  });
});

// ---- Windowed projection integration tests ----------------------------------

describe('projectWindowToFlowBlocks', () => {
  it('projects a single-paragraph window', async () => {
    const { shell, close } = await getRenderShell(createMinimalDocx('Hello'));

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 1,
    });

    const paragraphs = paragraphBlocks(result.blocks);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphText(paragraphs[0])).toBe('Hello');

    await close();
  });

  it('returns correct continuation for partial window', async () => {
    const texts = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
    const { shell, close } = await getRenderShell(createMultiParagraphDocx(texts));

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 3,
    });

    const paragraphs = paragraphBlocks(result.blocks);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphText(paragraphs[0])).toBe('Alpha');
    expect(paragraphText(paragraphs[1])).toBe('Beta');
    expect(paragraphText(paragraphs[2])).toBe('Gamma');

    expect(result.continuation.nextBodyChildIndex).toBe(3);
    expect(result.continuation.hasMore).toBe(true);
    // 5 paragraphs + 1 body-level sectPr = 6 body children
    expect(result.continuation.totalBodyChildCount).toBe(6);

    await close();
  });

  it('stops early when stopAfterPageEstimate is reached', async () => {
    const paragraphs = Array.from(
      { length: 40 },
      (_, index) => `Paragraph ${index + 1}: ${'Long content '.repeat(40)}`,
    );
    const { shell, close } = await getRenderShell(createMultiParagraphDocx(paragraphs));

    const fullResult = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });
    const limitedResult = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
      stopAfterPageEstimate: 1,
    });

    expect(limitedResult.blocks.length).toBeGreaterThan(0);
    expect(limitedResult.blocks.length).toBeLessThan(fullResult.blocks.length);
    expect(limitedResult.continuation.hasMore).toBe(true);

    await close();
  });

  it('returns hasMore=false when window reaches the end', async () => {
    const { shell, close } = await getRenderShell(createMinimalDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    // Last descriptor projected is the body-level sectPr
    expect(result.continuation.hasMore).toBe(false);

    await close();
  });

  it('handles empty window past end of document', async () => {
    const { shell, close } = await getRenderShell(createMinimalDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 999,
      maxBodyChildCount: 10,
    });

    expect(result.blocks).toHaveLength(0);
    expect(result.continuation.hasMore).toBe(false);

    await close();
  });

  it('produces stable IDs across overlapping windows', async () => {
    const texts = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
    const { shell, close } = await getRenderShell(createMultiParagraphDocx(texts));

    // Window 1: first 3 paragraphs
    const result1 = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 3,
    });

    // Window 2: first 5 paragraphs (overlaps with window 1)
    const result2 = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 5,
    });

    const paragraphs1 = paragraphBlocks(result1.blocks);
    const paragraphs2 = paragraphBlocks(result2.blocks);

    // IDs for the first 3 paragraphs should match
    for (let i = 0; i < 3; i++) {
      expect(paragraphs1[i].id).toBe(paragraphs2[i].id);
    }

    await close();
  });

  it('produces stable IDs across non-overlapping append windows', async () => {
    const texts = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const { shell, close } = await getRenderShell(createMultiParagraphDocx(texts));

    const result1 = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 2,
    });

    const result2 = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 2,
      maxBodyChildCount: 2,
    });

    // All IDs should be unique across windows
    const allIds1 = new Set(result1.blocks.map((b) => b.id));
    const allIds2 = new Set(result2.blocks.map((b) => b.id));
    for (const id of allIds2) {
      expect(allIds1.has(id)).toBe(false);
    }

    await close();
  });

  it('projects tables with rows and cells', async () => {
    const { shell, close } = await getRenderShell(createTableDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    const tables = tableBlocks(result.blocks);
    expect(tables.length).toBeGreaterThanOrEqual(1);

    const table = tables[0];
    expect(table.rows.length).toBeGreaterThanOrEqual(1);
    expect(table.rows[0].cells.length).toBeGreaterThanOrEqual(1);

    // Table should have stable ID format
    expect(table.id).toMatch(/^b-/);

    await close();
  });

  it('projects section breaks at paragraph boundaries', async () => {
    const { shell, close } = await getRenderShell(createSectionBreakDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    const sections = sectionBreakBlocks(result.blocks);
    expect(sections.length).toBeGreaterThanOrEqual(1);

    // Section metadata should be populated
    expect(result.sectionMetadata.sectionBreaks.length).toBeGreaterThanOrEqual(1);

    await close();
  });

  it('projects body-level sectPr as final section break', async () => {
    const { shell, close } = await getRenderShell(createMinimalDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    const sections = sectionBreakBlocks(result.blocks);
    expect(sections.length).toBeGreaterThanOrEqual(1);

    // Should include page geometry from sectPr
    const lastSection = sections[sections.length - 1];
    expect(lastSection.pageSize).toBeDefined();
    expect(lastSection.margins).toBeDefined();

    await close();
  });

  it('provides primary page geometry in section metadata', async () => {
    const { shell, close } = await getRenderShell(createMinimalDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    expect(result.sectionMetadata.primaryPageGeometry).toBeDefined();
    const geo = result.sectionMetadata.primaryPageGeometry!;
    // Letter size: 12240 twips wide = (12240/1440)*96 = 813.33... px
    expect(geo.width).toBeCloseTo((12240 / 1440) * 96, 0);
    expect(geo.height).toBeCloseTo((15840 / 1440) * 96, 0);

    await close();
  });

  it('collects dependency manifest when requested', async () => {
    const { shell, close } = await getRenderShell(createSectionBreakDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
      includeDependencyManifest: true,
    });

    expect(result.dependencyManifest).toBeDefined();
    // Section breaks with header/footer refs should be collected
    const manifest = result.dependencyManifest!;
    expect(
      manifest.headerFooterRefs.length + manifest.footnoteRefs.length + manifest.endnoteRefs.length,
    ).toBeGreaterThanOrEqual(0);

    await close();
  });

  it('omits dependency manifest when not requested', async () => {
    const { shell, close } = await getRenderShell(createMinimalDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    expect(result.dependencyManifest).toBeUndefined();

    await close();
  });

  it('respects abort signal', async () => {
    const { shell, close } = await getRenderShell(createMultiParagraphDocx(['A', 'B', 'C', 'D', 'E']));

    const controller = new AbortController();
    controller.abort();

    expect(() => {
      projectWindowToFlowBlocks(
        shell,
        { startBodyChildIndex: 0, maxBodyChildCount: 100 },
        { signal: controller.signal },
      );
    }).toThrow('Aborted');

    await close();
  });

  it('populates blockToSourceRef trace map', async () => {
    const { shell, close } = await getRenderShell(createMultiParagraphDocx(['Alpha', 'Beta']));

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 2,
    });

    const paragraphs = paragraphBlocks(result.blocks);
    expect(paragraphs).toHaveLength(2);

    // Each paragraph block should be in the trace map
    for (const p of paragraphs) {
      const ref = result.blockToSourceRef.get(p.id);
      expect(ref).toBeDefined();
      expect(ref!.partUri).toBe('/word/document.xml');
      expect(ref!.nodeId).toBeTruthy();
    }

    await close();
  });

  it('transparently unwraps block-level SDT content controls', async () => {
    const { shell, close } = await getRenderShell(createSdtDocx());

    const result = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    // SDT wraps paragraphs — they should be projected directly
    const paragraphs = paragraphBlocks(result.blocks);
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);

    await close();
  });

  it('projects TOC-style field paragraphs through the display fast path without changing visible text', async () => {
    const bytes = createTocFieldDocx();

    const fullHandle = await open(bytes);
    await fullHandle.ready('structure');
    const fullResult = projectToFlowBlocks(fullHandle.semanticModel()!);

    const windowHandle = await open(bytes);
    await windowHandle.ready('render-shell');
    const shell = windowHandle.renderShell()!;
    const windowResult = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 10,
    });

    const fullParagraphs = paragraphBlocks(fullResult.blocks);
    const windowParagraphs = paragraphBlocks(windowResult.blocks);
    expect(windowParagraphs).toHaveLength(fullParagraphs.length);

    for (let index = 0; index < windowParagraphs.length; index += 1) {
      expect(paragraphText(windowParagraphs[index])).toBe(paragraphText(fullParagraphs[index]));
      expect(windowParagraphs[index].id).toBe(fullParagraphs[index].id);
    }

    expect(windowResult.projectionStats?.displayFastPathParagraphs).toBe(2);
    expect(windowResult.projectionStats?.tocDisplayParagraphs).toBe(2);
    expect(windowResult.projectionStats?.displayFastPathRuns).toBeGreaterThan(0);

    await fullHandle.close();
    await windowHandle.close();
  });
});

// ---- Structural equivalence with full semantic projection -------------------

describe('equivalence: windowed vs semantic-model projection', () => {
  it('produces same paragraph count and text for minimal doc', async () => {
    const bytes = createMinimalDocx('Hello, World!');

    // Full semantic projection
    const handle = await open(bytes);
    await handle.ready('structure');
    const model = handle.semanticModel()!;
    const fullResult = projectToFlowBlocks(model);

    // Windowed projection
    const handle2 = await open(bytes);
    await handle2.ready('render-shell');
    const shell = handle2.renderShell()!;
    const windowResult = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    // Compare paragraph count and text
    const fullParagraphs = paragraphBlocks(fullResult.blocks);
    const windowParagraphs = paragraphBlocks(windowResult.blocks);
    expect(windowParagraphs.length).toBe(fullParagraphs.length);

    for (let i = 0; i < fullParagraphs.length; i++) {
      expect(paragraphText(windowParagraphs[i])).toBe(paragraphText(fullParagraphs[i]));
      expect(windowParagraphs[i].id).toBe(fullParagraphs[i].id);
    }

    await handle.close();
    await handle2.close();
  });

  it('produces same block kinds for multi-paragraph doc', async () => {
    const bytes = createMultiParagraphDocx(['Alpha', 'Beta', 'Gamma']);

    const handle = await open(bytes);
    await handle.ready('structure');
    const model = handle.semanticModel()!;
    const fullResult = projectToFlowBlocks(model);

    const handle2 = await open(bytes);
    await handle2.ready('render-shell');
    const shell = handle2.renderShell()!;
    const windowResult = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    // Same block kind sequence
    const fullKinds = fullResult.blocks.map((b) => b.kind);
    const windowKinds = windowResult.blocks.map((b) => b.kind);
    expect(windowKinds).toEqual(fullKinds);
    expect(windowResult.blocks.map((b) => b.id)).toEqual(fullResult.blocks.map((b) => b.id));

    await handle.close();
    await handle2.close();
  });

  it('produces stable IDs for append windows compared with the full semantic projection', async () => {
    const bytes = createMultiParagraphDocx(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);

    const fullHandle = await open(bytes);
    await fullHandle.ready('structure');
    const fullResult = projectToFlowBlocks(fullHandle.semanticModel()!);
    const fullParagraphs = paragraphBlocks(fullResult.blocks);

    const shellHandle = await open(bytes);
    await shellHandle.ready('render-shell');
    const shell = shellHandle.renderShell()!;
    const appendWindowResult = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 2,
      maxBodyChildCount: 2,
    });
    const appendParagraphs = paragraphBlocks(appendWindowResult.blocks);

    const expectedGamma = fullParagraphs.find((block) => paragraphText(block) === 'Gamma');
    const expectedDelta = fullParagraphs.find((block) => paragraphText(block) === 'Delta');
    const actualGamma = appendParagraphs.find((block) => paragraphText(block) === 'Gamma');
    const actualDelta = appendParagraphs.find((block) => paragraphText(block) === 'Delta');

    expect(actualGamma?.id).toBe(expectedGamma?.id);
    expect(actualDelta?.id).toBe(expectedDelta?.id);

    await fullHandle.close();
    await shellHandle.close();
  });

  it('produces same table structure for table doc', async () => {
    const bytes = createTableDocx();

    const handle = await open(bytes);
    await handle.ready('structure');
    const model = handle.semanticModel()!;
    const fullResult = projectToFlowBlocks(model);

    const handle2 = await open(bytes);
    await handle2.ready('render-shell');
    const shell = handle2.renderShell()!;
    const windowResult = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    const fullTables = tableBlocks(fullResult.blocks);
    const windowTables = tableBlocks(windowResult.blocks);
    expect(windowTables.length).toBe(fullTables.length);

    for (let i = 0; i < fullTables.length; i++) {
      expect(windowTables[i].id).toBe(fullTables[i].id);
      expect(windowTables[i].rows.length).toBe(fullTables[i].rows.length);
      for (let r = 0; r < fullTables[i].rows.length; r++) {
        expect(windowTables[i].rows[r].cells.length).toBe(fullTables[i].rows[r].cells.length);
      }
    }

    await handle.close();
    await handle2.close();
  });

  it('produces same section break count for section break doc', async () => {
    const bytes = createSectionBreakDocx();

    const handle = await open(bytes);
    await handle.ready('structure');
    const model = handle.semanticModel()!;
    const fullResult = projectToFlowBlocks(model);

    const handle2 = await open(bytes);
    await handle2.ready('render-shell');
    const shell = handle2.renderShell()!;
    const windowResult = projectWindowToFlowBlocks(shell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 100,
    });

    const fullSections = sectionBreakBlocks(fullResult.blocks);
    const windowSections = sectionBreakBlocks(windowResult.blocks);
    expect(windowSections.length).toBe(fullSections.length);
    expect(windowSections.map((section) => section.id)).toEqual(fullSections.map((section) => section.id));

    await handle.close();
    await handle2.close();
  });
});
