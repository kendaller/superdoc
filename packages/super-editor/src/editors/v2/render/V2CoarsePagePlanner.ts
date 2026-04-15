import type {
  FlowBlock,
  Page,
  PageMargins,
  ParagraphBlock,
  Run,
  SectionBreakBlock,
  TableBlock,
} from '@superdoc/contracts';

const DEFAULT_LINE_HEIGHT_PX = 20;
const DEFAULT_FONT_SIZE_PX = 16;
const DEFAULT_TAB_WIDTH_PX = 48;
const AVERAGE_GLYPH_WIDTH_RATIO = 0.55;
const MIN_CONTENT_WIDTH_PX = 120;
const MIN_ESTIMATED_PAGE_COUNT = 1;

type PageSize = { w: number; h: number };

export type V2CoarsePagePlannerInput = {
  blocks: readonly FlowBlock[];
  defaultPageSize: PageSize;
  defaultMargins: PageMargins;
  maxPageCount?: number;
};

export function buildCoarsePages(input: V2CoarsePagePlannerInput): Page[] {
  const { blocks, defaultPageSize, defaultMargins } = input;
  const maxPageCount = Math.max(MIN_ESTIMATED_PAGE_COUNT, input.maxPageCount ?? Number.MAX_SAFE_INTEGER);

  let currentPageSize = defaultPageSize;
  let currentMargins = defaultMargins;
  let remainingHeightPx = getContentHeight(currentPageSize, currentMargins);
  let nextPageNumber = 1;
  let pendingForcedPageBreak = false;

  const pages: Page[] = [
    createPlaceholderPage({
      pageNumber: nextPageNumber,
      pageSize: currentPageSize,
      margins: currentMargins,
    }),
  ];

  for (const block of blocks) {
    if (pages.length >= maxPageCount) {
      break;
    }

    if (block.kind === 'sectionBreak') {
      const nextGeometry = applySectionGeometry(currentPageSize, currentMargins, block);
      currentPageSize = nextGeometry.pageSize;
      currentMargins = nextGeometry.margins;
      remainingHeightPx = Math.min(remainingHeightPx, getContentHeight(currentPageSize, currentMargins));

      if (block.type && block.type !== 'continuous') {
        pendingForcedPageBreak = true;
      }
      continue;
    }

    if (pendingForcedPageBreak) {
      if (pages.length >= maxPageCount) {
        break;
      }

      nextPageNumber += 1;
      pages.push(
        createPlaceholderPage({
          pageNumber: nextPageNumber,
          pageSize: currentPageSize,
          margins: currentMargins,
        }),
      );
      remainingHeightPx = getContentHeight(currentPageSize, currentMargins);
      pendingForcedPageBreak = false;
    }

    const estimatedHeightPx = estimateBlockHeight(block, currentPageSize, currentMargins);
    if (estimatedHeightPx <= 0) {
      continue;
    }

    while (estimatedHeightPx > remainingHeightPx && pages.length < maxPageCount) {
      nextPageNumber += 1;
      pages.push(
        createPlaceholderPage({
          pageNumber: nextPageNumber,
          pageSize: currentPageSize,
          margins: currentMargins,
        }),
      );
      remainingHeightPx += getContentHeight(currentPageSize, currentMargins);
    }

    remainingHeightPx = Math.max(0, remainingHeightPx - estimatedHeightPx);
  }

  return pages;
}

function createPlaceholderPage(input: { pageNumber: number; pageSize: PageSize; margins: PageMargins }): Page {
  return {
    number: input.pageNumber,
    numberText: String(input.pageNumber),
    fragments: [],
    size: input.pageSize,
    margins: input.margins,
  };
}

function applySectionGeometry(
  pageSize: PageSize,
  margins: PageMargins,
  block: SectionBreakBlock,
): { pageSize: PageSize; margins: PageMargins } {
  return {
    pageSize: {
      w: block.pageSize?.w ?? pageSize.w,
      h: block.pageSize?.h ?? pageSize.h,
    },
    margins: {
      top: block.margins.top ?? margins.top,
      right: block.margins.right ?? margins.right,
      bottom: block.margins.bottom ?? margins.bottom,
      left: block.margins.left ?? margins.left,
      header: block.margins.header ?? margins.header,
      footer: block.margins.footer ?? margins.footer,
      gutter: margins.gutter,
    },
  };
}

function estimateBlockHeight(block: FlowBlock, pageSize: PageSize, margins: PageMargins): number {
  switch (block.kind) {
    case 'paragraph':
      return estimateParagraphHeight(block, pageSize, margins);
    case 'table':
      return estimateTableHeight(block, pageSize, margins);
    case 'image':
      return Math.max(block.height ?? DEFAULT_LINE_HEIGHT_PX * 6, DEFAULT_LINE_HEIGHT_PX);
    case 'drawing':
      return Math.max(resolveDrawingHeight(block), DEFAULT_LINE_HEIGHT_PX * 6);
    case 'list':
      return block.items.reduce(
        (totalHeightPx, item) => totalHeightPx + estimateParagraphHeight(item.paragraph, pageSize, margins),
        0,
      );
    case 'pageBreak':
      return getContentHeight(pageSize, margins);
    default:
      return 0;
  }
}

function estimateParagraphHeight(block: ParagraphBlock, pageSize: PageSize, margins: PageMargins): number {
  const availableWidthPx = getContentWidth(pageSize, margins);
  const lineHeightPx = Math.max(DEFAULT_LINE_HEIGHT_PX, ...block.runs.map(estimateRunLineHeight));

  let lineCount = 1;
  let currentLineWidthPx = 0;
  let explicitPageBreakCount = block.attrs?.pageBreakBefore ? 1 : 0;

  for (const run of block.runs) {
    if (run.kind === 'lineBreak') {
      lineCount += 1;
      currentLineWidthPx = 0;
      continue;
    }

    if (run.kind === 'break' && run.breakType === 'page') {
      explicitPageBreakCount += 1;
      lineCount = 1;
      currentLineWidthPx = 0;
      continue;
    }

    const runWidthPx = estimateRunWidth(run);
    if (runWidthPx <= 0) {
      continue;
    }

    const totalLineWidthPx = currentLineWidthPx + runWidthPx;
    const additionalLines = Math.floor(Math.max(totalLineWidthPx - 1, 0) / availableWidthPx);
    lineCount += additionalLines;
    currentLineWidthPx = totalLineWidthPx - additionalLines * availableWidthPx;
  }

  const spacingBeforePx = block.attrs?.spacing?.before ?? 0;
  const spacingAfterPx = block.attrs?.spacing?.after ?? 0;
  const paragraphHeightPx =
    lineCount * lineHeightPx +
    spacingBeforePx +
    spacingAfterPx +
    explicitPageBreakCount * getContentHeight(pageSize, margins);

  return Math.max(paragraphHeightPx, lineHeightPx);
}

function estimateTableHeight(block: TableBlock, pageSize: PageSize, margins: PageMargins): number {
  const availableWidthPx = getContentWidth(pageSize, margins);
  const columnCount = block.columnWidths?.length ?? Math.max(...block.rows.map((row) => row.cells.length), 1);
  const defaultColumnWidthPx = Math.max(availableWidthPx / Math.max(columnCount, 1), MIN_CONTENT_WIDTH_PX);

  let totalHeightPx = 0;

  for (const row of block.rows) {
    const estimatedRowHeightPx = row.cells.reduce((maxRowHeightPx, cell) => {
      const spannedColumnCount = cell.colSpan ?? 1;
      const cellWidthPx = block.columnWidths
        ? estimateSpannedColumnWidth(block.columnWidths, spannedColumnCount, defaultColumnWidthPx)
        : defaultColumnWidthPx * spannedColumnCount;

      const paddingTopPx = cell.attrs?.padding?.top ?? 0;
      const paddingBottomPx = cell.attrs?.padding?.bottom ?? 0;
      const paddingLeftPx = cell.attrs?.padding?.left ?? 0;
      const paddingRightPx = cell.attrs?.padding?.right ?? 0;
      const cellContentWidthPx = Math.max(cellWidthPx - paddingLeftPx - paddingRightPx, MIN_CONTENT_WIDTH_PX);

      let cellHeightPx = DEFAULT_LINE_HEIGHT_PX;
      if (cell.paragraph) {
        cellHeightPx = estimateParagraphHeight(cell.paragraph, pageSize, {
          ...margins,
          left: 0,
          right: 0,
        });
      } else if (cell.blocks && cell.blocks.length > 0) {
        cellHeightPx = cell.blocks.reduce(
          (total, childBlock) =>
            total +
            estimateBlockHeight(childBlock, pageSize, {
              ...margins,
              left: 0,
              right: 0,
            }),
          0,
        );
      }

      const paddedCellHeightPx = Math.max(cellHeightPx, DEFAULT_LINE_HEIGHT_PX) + paddingTopPx + paddingBottomPx;
      const adjustedCellHeightPx = Math.max(
        paddedCellHeightPx,
        estimateCellMinimumHeight(cellContentWidthPx, spannedColumnCount),
      );
      return Math.max(maxRowHeightPx, adjustedCellHeightPx);
    }, DEFAULT_LINE_HEIGHT_PX);

    const explicitRowHeightPx = row.attrs?.rowHeight?.value;
    totalHeightPx += explicitRowHeightPx ? Math.max(explicitRowHeightPx, estimatedRowHeightPx) : estimatedRowHeightPx;
  }

  return totalHeightPx;
}

function estimateCellMinimumHeight(cellContentWidthPx: number, spannedColumnCount: number): number {
  if (spannedColumnCount > 1) {
    return DEFAULT_LINE_HEIGHT_PX * 1.5;
  }

  return Math.max(DEFAULT_LINE_HEIGHT_PX, Math.min(cellContentWidthPx / 6, DEFAULT_LINE_HEIGHT_PX * 3));
}

function estimateSpannedColumnWidth(
  columnWidths: readonly number[],
  spannedColumnCount: number,
  defaultColumnWidthPx: number,
): number {
  const widthPx = columnWidths.slice(0, spannedColumnCount).reduce((total, value) => total + value, 0);
  if (widthPx > 0) {
    return widthPx;
  }

  return defaultColumnWidthPx * spannedColumnCount;
}

function estimateRunLineHeight(run: Run): number {
  if ('fontSize' in run && typeof run.fontSize === 'number' && Number.isFinite(run.fontSize)) {
    return Math.max(run.fontSize * 1.25, DEFAULT_LINE_HEIGHT_PX);
  }

  return DEFAULT_LINE_HEIGHT_PX;
}

function estimateRunWidth(run: Run): number {
  switch (run.kind) {
    case 'text':
      return estimateTextWidth(run.text, run.fontSize);
    case 'tab':
      return run.width ?? DEFAULT_TAB_WIDTH_PX;
    case 'lineBreak':
      return 0;
    case 'break':
      return run.breakType === 'page' ? 0 : DEFAULT_FONT_SIZE_PX;
    case 'image':
      return Math.max(run.width ?? DEFAULT_FONT_SIZE_PX * 4, DEFAULT_FONT_SIZE_PX);
    case 'fieldAnnotation':
      return estimateTextWidth(run.displayLabel ?? '', normalizeOptionalFontSize(run.fontSize));
    case 'math':
      return Math.max(run.width, estimateTextWidth(run.textContent ?? ' ', DEFAULT_FONT_SIZE_PX));
    default:
      return DEFAULT_FONT_SIZE_PX;
  }
}

function estimateTextWidth(text: string, fontSizePx: number | undefined): number {
  if (!text) {
    return 0;
  }

  const effectiveFontSizePx = fontSizePx ?? DEFAULT_FONT_SIZE_PX;
  return text.length * effectiveFontSizePx * AVERAGE_GLYPH_WIDTH_RATIO;
}

function normalizeOptionalFontSize(value: string | number | null | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function resolveDrawingHeight(block: Extract<FlowBlock, { kind: 'drawing' }>): number {
  if ('geometry' in block && block.geometry?.height) {
    return block.geometry.height;
  }

  if ('size' in block && typeof block.size?.height === 'number') {
    return block.size.height;
  }

  return DEFAULT_LINE_HEIGHT_PX * 6;
}

function getContentWidth(pageSize: PageSize, margins: PageMargins): number {
  const left = margins.left ?? 0;
  const right = margins.right ?? 0;
  return Math.max(pageSize.w - left - right, MIN_CONTENT_WIDTH_PX);
}

function getContentHeight(pageSize: PageSize, margins: PageMargins): number {
  const top = margins.top ?? 0;
  const bottom = margins.bottom ?? 0;
  return Math.max(pageSize.h - top - bottom, DEFAULT_LINE_HEIGHT_PX * 4);
}
