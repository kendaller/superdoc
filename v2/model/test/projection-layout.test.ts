// ---------------------------------------------------------------------------
// Layout projection tests
//
// Validates:
// - paragraph/table/section projection basics
// - transparent SDT projection
// - exact block ownership in the trace map
// - resolver-backed differences for paragraph and table styling
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { createSession, advanceToStage } from '../src/session/session.js';
import { createHandle } from '../src/session/handle.js';
import { SemanticModel } from '../src/model.js';
import { projectToFlowBlocks } from '../src/projections/layout/project.js';
import { StyleResolver } from '../src/resolve/style-resolver.js';
import type {
  FlowBlock,
  ParagraphBlock,
  TableBlock,
  SectionBreakBlock,
  ImageRun,
  TextRun,
} from '../src/projections/layout/types.js';
import { createMinimalDocx, createMultiParagraphDocx } from './helpers/create-test-docx.js';
import {
  createFormattedParagraphDocx,
  createInlineImageDocx,
  createSectionBreakDocx,
  createSdtDocx,
  createStyleResolvedParagraphDocx,
  createStyledTableDocx,
  createTableDocx,
} from './helpers/create-rich-docx.js';

function twipsToLayoutPx(value: number): number {
  return (value / 1440) * 96;
}

function halfPointsToLayoutPx(value: number): number {
  return (value / 2 / 72) * 96;
}

async function buildModel(bytes: Uint8Array): Promise<SemanticModel> {
  const session = createSession({ kind: 'memory', bytes });
  await advanceToStage(session, 'structure');
  const handle = createHandle(session);
  return new SemanticModel(session, handle.views());
}

async function buildModelWithResolver(bytes: Uint8Array): Promise<{
  model: SemanticModel;
  resolver: StyleResolver;
}> {
  const session = createSession({ kind: 'memory', bytes });
  await advanceToStage(session, 'structure');
  const handle = createHandle(session);
  const views = handle.views();

  return {
    model: new SemanticModel(session, views),
    resolver: new StyleResolver(views.styles?.rootElement(), views.numbering?.rootElement()),
  };
}

function paragraphBlocks(blocks: FlowBlock[]): ParagraphBlock[] {
  return blocks.filter((block): block is ParagraphBlock => block.kind === 'paragraph');
}

function tableBlocks(blocks: FlowBlock[]): TableBlock[] {
  return blocks.filter((block): block is TableBlock => block.kind === 'table');
}

function sectionBreaks(blocks: FlowBlock[]): SectionBreakBlock[] {
  return blocks.filter((block): block is SectionBreakBlock => block.kind === 'sectionBreak');
}

function textRuns(block: ParagraphBlock): TextRun[] {
  return block.runs.filter((run): run is TextRun => run.kind === 'text' || run.kind === undefined);
}

function paragraphText(block: ParagraphBlock): string {
  return textRuns(block)
    .map((run) => run.text)
    .join('');
}

function findParagraphEntityByText(
  model: SemanticModel,
  expectedText: string,
): ReturnType<SemanticModel['allParagraphs']>[number] | undefined {
  return model.allParagraphs().find((paragraph) =>
    model
      .runs(paragraph.ref)
      .flatMap((run) => model.segments(run.ref))
      .map((segment) => ('text' in segment ? segment.text : ''))
      .join('')
      .includes(expectedText),
  );
}

describe('layout projection: paragraphs', () => {
  it('projects a minimal docx to FlowBlock[] with a paragraph', async () => {
    const model = await buildModel(createMinimalDocx('Hello, World!'));
    const blocks = projectToFlowBlocks(model).blocks;
    const paragraphs = paragraphBlocks(blocks);

    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs[0].id).toMatch(/^b-/);
    expect(paragraphText(paragraphs[0])).toContain('Hello, World!');
  });

  it('projects multiple paragraphs with correct count and text', async () => {
    const texts = ['First paragraph', 'Second paragraph', 'Third paragraph'];
    const model = await buildModel(createMultiParagraphDocx(texts));
    const blocks = projectToFlowBlocks(model).blocks;
    const paragraphs = paragraphBlocks(blocks);

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map(paragraphText)).toEqual(texts);
  });

  it('supports a custom block ID prefix', async () => {
    const model = await buildModel(createMinimalDocx('test'));
    const blocks = projectToFlowBlocks(model, { prefix: 'custom-' }).blocks;

    for (const block of blocks) {
      expect(block.id).toMatch(/^custom-/);
    }
  });
});

describe('layout projection: formatting', () => {
  it('projects direct paragraph attrs and run formatting', async () => {
    const model = await buildModel(createFormattedParagraphDocx());
    const blocks = projectToFlowBlocks(model).blocks;
    const heading = paragraphBlocks(blocks)[0];
    const runs = textRuns(heading);

    expect(heading.attrs?.styleId).toBe('Heading1');
    expect(heading.attrs?.alignment).toBe('center');
    expect(heading.attrs?.spacing?.before).toBe(twipsToLayoutPx(240));
    expect(heading.attrs?.indent?.left).toBe(twipsToLayoutPx(720));
    expect(heading.attrs?.keepNext).toBe(true);

    expect(runs[0].text).toBe('Bold Red Title');
    expect(runs[0].bold).toBe(true);
    expect(runs[0].fontFamily).toBe('Arial');
    expect(runs[0].fontSize).toBeCloseTo(halfPointsToLayoutPx(28), 5);
    expect(runs[0].color).toBe('#FF0000');

    expect(runs[1].italic).toBe(true);
    expect(runs[1].underline?.style).toBe('single');
  });

  it('projects numbering, tabs, and breaks', async () => {
    const model = await buildModel(createFormattedParagraphDocx());
    const blocks = projectToFlowBlocks(model).blocks;
    const paragraphs = paragraphBlocks(blocks);

    expect(paragraphs[1].attrs?.numberingProperties).toEqual({ numId: 1, ilvl: 0 });
    expect(paragraphs[2].runs.some((run) => run.kind === 'tab')).toBe(true);
    expect(paragraphs[2].runs.some((run) => run.kind === 'break')).toBe(true);
  });

  it('projects inline DrawingML images as image runs', async () => {
    const model = await buildModel(createInlineImageDocx());
    const blocks = projectToFlowBlocks(model).blocks;
    const paragraph = paragraphBlocks(blocks)[0];
    const imageRun = paragraph.runs.find((run): run is ImageRun => run.kind === 'image');

    expect(imageRun).toBeDefined();
    expect(imageRun?.src).toBe('/word/media/image1.png');
    expect(imageRun?.width).toBeGreaterThan(0);
    expect(imageRun?.height).toBeGreaterThan(0);
    expect(imageRun?.alt).toBe('Inline image');
  });
});

describe('layout projection: tables', () => {
  it('projects tables with row, cell, and merged-cell data', async () => {
    const model = await buildModel(createTableDocx());
    const blocks = projectToFlowBlocks(model).blocks;
    const table = tableBlocks(blocks)[0];

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells).toHaveLength(1);
    expect(table.rows[1].cells).toHaveLength(2);
    expect(table.rows[0].cells[0].colSpan).toBe(2);
    expect(table.columnWidths).toEqual([twipsToLayoutPx(2500), twipsToLayoutPx(2500)]);

    const secondRowFirstCell = table.rows[1].cells[0];
    expect(
      secondRowFirstCell.paragraph !== undefined ||
        secondRowFirstCell.blocks?.some((block) => block.kind === 'paragraph'),
    ).toBe(true);
  });
});

describe('layout projection: transparent wrappers', () => {
  it('projects SDT-wrapped content as normal paragraph blocks', async () => {
    const model = await buildModel(createSdtDocx());
    const blocks = projectToFlowBlocks(model).blocks;
    const allText = paragraphBlocks(blocks).map(paragraphText).join(' ');

    expect(allText).toContain('Block SDT paragraph');
    expect(allText).toContain('inline SDT text');
  });
});

describe('layout projection: trace ownership', () => {
  it('maps nested table-cell paragraphs back to the paragraph entity that produced them', async () => {
    const model = await buildModel(createTableDocx());
    const projection = projectToFlowBlocks(model);
    const paragraphEntity = findParagraphEntityByText(model, 'Cell A');

    expect(paragraphEntity).toBeDefined();

    const mappingEntry = [...projection.blockToEntityRef.entries()].find(
      ([, entityRef]) => entityRef.id === paragraphEntity!.ref.id,
    );

    expect(mappingEntry?.[0]).toMatch(/paragraph$/);
  });

  it('does not assign projected paragraph blocks to content-control wrapper entities', async () => {
    const model = await buildModel(createSdtDocx());
    const projection = projectToFlowBlocks(model);
    const contentControl = model.allEntities('contentControl')[0];
    const wrappedParagraph = model
      .allParagraphs()
      .find((paragraph) => paragraph.sourceRefs[0]?.sourceNodePath === 'w:body/w:sdt[1]/w:sdtContent[1]/w:p[1]');

    expect(contentControl).toBeDefined();
    expect(wrappedParagraph).toBeDefined();
    expect([...projection.blockToEntityRef.values()].some((entityRef) => entityRef.id === contentControl.ref.id)).toBe(
      false,
    );
    expect(
      [...projection.blockToEntityRef.values()].some((entityRef) => entityRef.id === wrappedParagraph!.ref.id),
    ).toBe(true);
  });
});

describe('layout projection: resolver-backed output', () => {
  it('applies paragraph and run formatting that exists only in styles.xml', async () => {
    const { model, resolver } = await buildModelWithResolver(createStyleResolvedParagraphDocx());

    const rawProjection = projectToFlowBlocks(model);
    const resolvedProjection = projectToFlowBlocks(model, { resolver });

    const rawParagraph = paragraphBlocks(rawProjection.blocks)[0];
    const resolvedParagraph = paragraphBlocks(resolvedProjection.blocks)[0];
    const resolvedRun = textRuns(resolvedParagraph)[0];

    expect(rawParagraph.attrs?.alignment).toBeUndefined();
    expect(resolvedParagraph.attrs?.alignment).toBe('center');
    expect(textRuns(rawParagraph)[0].bold).toBeUndefined();
    expect(resolvedRun.bold).toBe(true);
    expect(resolvedRun.color).toBe('#AA0000');
    expect(resolvedRun.fontFamily).toBe('Cambria');
  });

  it('applies table and first-row cell formatting that exists only in the table style', async () => {
    const { model, resolver } = await buildModelWithResolver(createStyledTableDocx());

    const rawProjection = projectToFlowBlocks(model);
    const resolvedProjection = projectToFlowBlocks(model, { resolver });

    const rawTable = tableBlocks(rawProjection.blocks)[0];
    const resolvedTable = tableBlocks(resolvedProjection.blocks)[0];

    expect(rawTable.attrs?.borders).toBeUndefined();
    expect(resolvedTable.attrs?.borders?.top).toBeDefined();
    expect((resolvedTable.attrs?.borders?.top as { color?: string }).color).toBe('#0066CC');
    expect(rawTable.rows[0].cells[0].attrs?.background).toBeUndefined();
    expect(resolvedTable.rows[0].cells[0].attrs?.background).toBe('#DDEEFF');
  });
});

describe('layout projection: sections', () => {
  it('emits section breaks with page dimensions and margins', async () => {
    const model = await buildModel(createMinimalDocx('test'));
    const sections = sectionBreaks(projectToFlowBlocks(model).blocks);

    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections[0].pageSize).toEqual({
      w: twipsToLayoutPx(12240),
      h: twipsToLayoutPx(15840),
    });
    expect(sections[0].margins).toBeDefined();
  });

  it('emits multiple section breaks and landscape orientation for multi-section docs', async () => {
    const model = await buildModel(createSectionBreakDocx());
    const sections = sectionBreaks(projectToFlowBlocks(model).blocks);

    expect(sections).toHaveLength(2);
    expect(sections[0].margins.top).toBe(twipsToLayoutPx(1440));
    expect(sections[1].orientation).toBe('landscape');
    expect(sections[1].pageSize).toEqual({
      w: twipsToLayoutPx(15840),
      h: twipsToLayoutPx(12240),
    });
  });
});
