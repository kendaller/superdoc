import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowBlock, Layout, Measure, SectionMetadata } from '@superdoc/contracts';
import { layoutPerRIdHeaderFooters } from './HeaderFooterPerRidLayout';

const { mockLayoutHeaderFooterWithCache, mockComputeDisplayPageNumber, mockMeasureBlock } = vi.hoisted(() => ({
  mockLayoutHeaderFooterWithCache: vi.fn(),
  mockComputeDisplayPageNumber: vi.fn(),
  mockMeasureBlock: vi.fn(),
}));

vi.mock('@superdoc/layout-bridge', () => ({
  OOXML_PCT_DIVISOR: 5000,
  computeDisplayPageNumber: mockComputeDisplayPageNumber,
  layoutHeaderFooterWithCache: mockLayoutHeaderFooterWithCache,
}));

vi.mock('@superdoc/measuring-dom', () => ({
  measureBlock: mockMeasureBlock,
}));

const makeBlock = (id: string): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text: id, fontFamily: 'Arial', fontSize: 12 }],
});

const makeMeasure = (): Measure => ({
  kind: 'paragraph',
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 1,
      width: 100,
      ascent: 8,
      descent: 2,
      lineHeight: 10,
    },
  ],
  totalHeight: 10,
});

describe('layoutPerRIdHeaderFooters', () => {
  beforeEach(() => {
    mockComputeDisplayPageNumber.mockReset();
    mockLayoutHeaderFooterWithCache.mockReset();
    mockMeasureBlock.mockReset();

    mockComputeDisplayPageNumber.mockImplementation((pages: Array<{ number: number; sectionIndex?: number }>) =>
      pages.map((page, index) => ({
        physicalPage: page.number,
        displayNumber: index + 1,
        displayText: String(index + 1),
        sectionIndex: page.sectionIndex ?? 0,
      })),
    );

    mockLayoutHeaderFooterWithCache.mockImplementation(async (sections: { default?: FlowBlock[] }) => ({
      default: sections.default
        ? {
            layout: {
              height: 10,
              pages: [{ number: 1, fragments: [] }],
            },
            blocks: sections.default,
            measures: [makeMeasure()],
          }
        : undefined,
    }));
  });

  it('lays out only section-referenced rIds for single-section documents', async () => {
    const headerBlocksByRId = new Map<string, FlowBlock[]>([
      ['rId-header-default', [makeBlock('block-default')]],
      ['rId-header-first', [makeBlock('block-first')]],
      ['rId-header-orphan', [makeBlock('block-orphan')]],
    ]);

    const headerFooterInput = {
      headerBlocksByRId,
      footerBlocksByRId: undefined,
      headerBlocks: undefined,
      footerBlocks: undefined,
      constraints: {
        width: 400,
        height: 80,
        pageWidth: 600,
        pageHeight: 800,
        margins: {
          top: 50,
          right: 50,
          bottom: 50,
          left: 50,
          header: 20,
        },
      },
    };

    const layout = {
      pages: [{ number: 1, fragments: [], sectionIndex: 0 }],
    } as unknown as Layout;

    const sectionMetadata: SectionMetadata[] = [
      {
        sectionIndex: 0,
        headerRefs: {
          default: 'rId-header-default',
          first: 'rId-header-first',
        },
      },
    ];

    const deps = {
      headerLayoutsByRId: new Map(),
      footerLayoutsByRId: new Map(),
    };

    await layoutPerRIdHeaderFooters(headerFooterInput, layout, sectionMetadata, deps);

    expect(mockLayoutHeaderFooterWithCache).toHaveBeenCalledTimes(2);

    const laidOutBlockIds = new Set(
      mockLayoutHeaderFooterWithCache.mock.calls.map((call) => call[0].default?.[0]?.id).filter(Boolean),
    );

    expect(laidOutBlockIds).toEqual(new Set(['block-default', 'block-first']));
    expect(deps.headerLayoutsByRId.has('rId-header-default')).toBe(true);
    expect(deps.headerLayoutsByRId.has('rId-header-first')).toBe(true);
    expect(deps.headerLayoutsByRId.has('rId-header-orphan')).toBe(false);
  });

  it('lays out even/odd header refs inherited from earlier sections', async () => {
    const deps = {
      headerLayoutsByRId: new Map(),
      footerLayoutsByRId: new Map(),
    };

    const layout: Layout = {
      pageSize: { w: 612, h: 792 },
      pages: [
        { number: 1, fragments: [], sectionIndex: 0 },
        { number: 2, fragments: [], sectionIndex: 0 },
        { number: 3, fragments: [], sectionIndex: 1 },
      ],
    };

    const sectionMetadata: SectionMetadata[] = [
      {
        sectionIndex: 0,
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72, header: 36 },
        headerRefs: {
          default: 'rId-default',
          even: 'rId-even',
          odd: 'rId-odd',
        },
      },
      {
        sectionIndex: 1,
        pageSize: { w: 612, h: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72, header: 36 },
        headerRefs: {
          default: 'rId-default-s1',
          // even and odd NOT defined — should be inherited from section 0
        },
      },
    ];

    await layoutPerRIdHeaderFooters(
      {
        headerBlocksByRId: new Map([
          ['rId-default', [makeParagraph('h-default', 'Default')]],
          ['rId-even', [makeParagraph('h-even', 'Even header')]],
          ['rId-odd', [makeParagraph('h-odd', 'Odd header')]],
          ['rId-default-s1', [makeParagraph('h-default-s1', 'Section 1 default')]],
        ]),
        footerBlocksByRId: new Map(),
        constraints: {
          width: 468,
          height: 648,
          pageWidth: 612,
          pageHeight: 792,
          margins: { left: 72, right: 72, top: 72, bottom: 72, header: 36 },
          overflowBaseHeight: 36,
        },
      },
      layout,
      sectionMetadata,
      deps,
    );

    // Section 0 should have default, even, and odd layouts
    expect(deps.headerLayoutsByRId.has('rId-default::s0')).toBe(true);
    expect(deps.headerLayoutsByRId.has('rId-even::s0')).toBe(true);
    expect(deps.headerLayoutsByRId.has('rId-odd::s0')).toBe(true);

    // Section 1 should have its own default, plus inherited even and odd from section 0
    expect(deps.headerLayoutsByRId.has('rId-default-s1::s1')).toBe(true);
    expect(deps.headerLayoutsByRId.has('rId-even::s1')).toBe(true);
    expect(deps.headerLayoutsByRId.has('rId-odd::s1')).toBe(true);
  });
});
