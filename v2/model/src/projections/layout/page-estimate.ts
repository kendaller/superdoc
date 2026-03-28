// ---------------------------------------------------------------------------
// Page-estimate limiter for windowed projection
//
// Windowed projection needs a lightweight way to stop after "roughly enough
// content for N pages" without running the full layout engine. This module
// provides a deliberately simple, explicit heuristic.
// ---------------------------------------------------------------------------

import type { FlowBlock, ParagraphBlock, Run, SectionBreakBlock, TableBlock } from './types.js';

export type LayoutPageGeometry = {
  width: number;
  height: number;
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export type PageEstimateLimiter = {
  observeBlocks(blocks: readonly FlowBlock[]): void;
  hasReachedLimit(): boolean;
};

const DEFAULT_PAGE_GEOMETRY: LayoutPageGeometry = {
  width: (12240 / 1440) * 96,
  height: (15840 / 1440) * 96,
  margins: {
    top: (1440 / 1440) * 96,
    right: (1440 / 1440) * 96,
    bottom: (1440 / 1440) * 96,
    left: (1440 / 1440) * 96,
  },
};

const DEFAULT_LINE_HEIGHT_PX = 20;
const DEFAULT_FONT_SIZE_PX = 16;
const DEFAULT_TAB_WIDTH_PX = 48;
const AVERAGE_GLYPH_WIDTH_RATIO = 0.55;
const MIN_CONTENT_WIDTH_PX = 120;

export function createPageEstimateLimiter(
  stopAfterPageEstimate: number | undefined,
  primaryGeometry: LayoutPageGeometry | undefined,
): PageEstimateLimiter {
  if (!stopAfterPageEstimate || stopAfterPageEstimate < 1) {
    return createUnlimitedLimiter();
  }

  let currentGeometry = primaryGeometry ?? DEFAULT_PAGE_GEOMETRY;
  let pagesTouched = 0;
  let remainingHeightPx = contentHeight(currentGeometry);
  let pendingPageBreak = false;

  return {
    observeBlocks(blocks: readonly FlowBlock[]): void {
      for (const block of blocks) {
        if (block.kind === 'sectionBreak') {
          applySectionBreak(block);
          continue;
        }

        reserveHeight(estimateBlockHeight(block, currentGeometry));
        if (pagesTouched >= stopAfterPageEstimate) {
          return;
        }
      }
    },

    hasReachedLimit(): boolean {
      return pagesTouched >= stopAfterPageEstimate;
    },
  };

  function applySectionBreak(block: SectionBreakBlock): void {
    if (block.pageSize) {
      currentGeometry = mergeSectionGeometry(currentGeometry, block);
      remainingHeightPx = Math.min(remainingHeightPx, contentHeight(currentGeometry));
    }

    if (block.type && block.type !== 'continuous') {
      pendingPageBreak = true;
    }
  }

  function reserveHeight(heightPx: number): void {
    if (heightPx <= 0) {
      return;
    }

    ensurePageStarted();

    if (pendingPageBreak) {
      pagesTouched += 1;
      remainingHeightPx = contentHeight(currentGeometry);
      pendingPageBreak = false;
    }

    if (remainingHeightPx <= 0) {
      pagesTouched += 1;
      remainingHeightPx = contentHeight(currentGeometry);
    }

    if (heightPx <= remainingHeightPx) {
      remainingHeightPx -= heightPx;
      return;
    }

    const overflowPx = heightPx - remainingHeightPx;
    const pageHeightPx = contentHeight(currentGeometry);
    const additionalPages = Math.ceil(overflowPx / pageHeightPx);
    const remainderPx = overflowPx % pageHeightPx;

    pagesTouched += additionalPages;
    remainingHeightPx = remainderPx === 0 ? 0 : pageHeightPx - remainderPx;
  }

  function ensurePageStarted(): void {
    if (pagesTouched === 0) {
      pagesTouched = 1;
      remainingHeightPx = contentHeight(currentGeometry);
    }
  }
}

function createUnlimitedLimiter(): PageEstimateLimiter {
  return {
    observeBlocks(): void {
      // Intentionally empty.
    },
    hasReachedLimit(): boolean {
      return false;
    },
  };
}

function mergeSectionGeometry(
  previousGeometry: LayoutPageGeometry,
  sectionBreak: SectionBreakBlock,
): LayoutPageGeometry {
  const nextWidth = sectionBreak.pageSize?.w ?? previousGeometry.width;
  const nextHeight = sectionBreak.pageSize?.h ?? previousGeometry.height;

  return {
    width: nextWidth,
    height: nextHeight,
    margins: {
      top: sectionBreak.margins.top ?? previousGeometry.margins.top,
      right: sectionBreak.margins.right ?? previousGeometry.margins.right,
      bottom: sectionBreak.margins.bottom ?? previousGeometry.margins.bottom,
      left: sectionBreak.margins.left ?? previousGeometry.margins.left,
    },
  };
}

function estimateBlockHeight(
  block: ParagraphBlock | TableBlock,
  pageGeometry: LayoutPageGeometry,
  availableWidthPx: number = contentWidth(pageGeometry),
): number {
  if (block.kind === 'paragraph') {
    return estimateParagraphHeight(block, pageGeometry, availableWidthPx);
  }

  return estimateTableHeight(block, pageGeometry, availableWidthPx);
}

function estimateParagraphHeight(
  block: ParagraphBlock,
  pageGeometry: LayoutPageGeometry,
  availableWidthPx: number,
): number {
  const widthPx = Math.max(availableWidthPx, MIN_CONTENT_WIDTH_PX);
  const lineHeightPx = Math.max(DEFAULT_LINE_HEIGHT_PX, ...block.runs.map(estimateRunLineHeight));

  let lineCount = 1;
  let currentLineWidthPx = 0;
  let explicitPageBreaks = block.attrs?.pageBreakBefore ? 1 : 0;

  for (const run of block.runs) {
    if (run.kind === 'lineBreak') {
      lineCount += 1;
      currentLineWidthPx = 0;
      continue;
    }

    if (run.kind === 'break' && run.breakType === 'page') {
      explicitPageBreaks += 1;
      lineCount = 1;
      currentLineWidthPx = 0;
      continue;
    }

    const runWidthPx = estimateRunWidth(run);
    const totalLineWidthPx = currentLineWidthPx + runWidthPx;
    const additionalLines = Math.floor(Math.max(totalLineWidthPx - 1, 0) / widthPx);

    lineCount += additionalLines;
    currentLineWidthPx = totalLineWidthPx - additionalLines * widthPx;
  }

  const spacingBeforePx = block.attrs?.spacing?.before ?? 0;
  const spacingAfterPx = block.attrs?.spacing?.after ?? 0;
  const paragraphHeightPx =
    lineCount * lineHeightPx + spacingBeforePx + spacingAfterPx + explicitPageBreaks * contentHeight(pageGeometry);

  return Math.max(paragraphHeightPx, lineHeightPx);
}

function estimateTableHeight(block: TableBlock, pageGeometry: LayoutPageGeometry, availableWidthPx: number): number {
  const columnCount = block.columnWidths?.length ?? Math.max(...block.rows.map((row) => row.cells.length), 1);
  const defaultColumnWidthPx = Math.max(availableWidthPx / Math.max(columnCount, 1), MIN_CONTENT_WIDTH_PX);

  let totalHeightPx = 0;

  for (const row of block.rows) {
    const estimatedRowHeightPx = row.cells.reduce((maxHeightPx, cell) => {
      const spannedColumnCount = cell.colSpan ?? 1;
      const cellWidthPx = block.columnWidths
        ? estimateSpannedColumnWidth(block.columnWidths, spannedColumnCount, defaultColumnWidthPx)
        : defaultColumnWidthPx * spannedColumnCount;

      const paddingTopPx = cell.attrs?.padding?.top ?? 0;
      const paddingBottomPx = cell.attrs?.padding?.bottom ?? 0;
      const paddingLeftPx = cell.attrs?.padding?.left ?? 0;
      const paddingRightPx = cell.attrs?.padding?.right ?? 0;
      const contentWidthPx = Math.max(cellWidthPx - paddingLeftPx - paddingRightPx, MIN_CONTENT_WIDTH_PX);
      const blocksHeightPx = estimateCellContentHeight(cell, pageGeometry, contentWidthPx);
      const cellHeightPx = blocksHeightPx + paddingTopPx + paddingBottomPx;

      return Math.max(maxHeightPx, cellHeightPx);
    }, DEFAULT_LINE_HEIGHT_PX);

    const explicitRowHeightPx = row.attrs?.rowHeight?.value;
    totalHeightPx += explicitRowHeightPx ? Math.max(explicitRowHeightPx, estimatedRowHeightPx) : estimatedRowHeightPx;
  }

  return totalHeightPx;
}

function estimateCellContentHeight(
  cell: TableBlock['rows'][number]['cells'][number],
  pageGeometry: LayoutPageGeometry,
  contentWidthPx: number,
): number {
  if (cell.paragraph) {
    return estimateParagraphHeight(cell.paragraph, pageGeometry, contentWidthPx);
  }

  if (!cell.blocks || cell.blocks.length === 0) {
    return DEFAULT_LINE_HEIGHT_PX;
  }

  return cell.blocks.reduce(
    (totalHeightPx, block) => totalHeightPx + estimateBlockHeight(block, pageGeometry, contentWidthPx),
    0,
  );
}

function estimateSpannedColumnWidth(
  columnWidthsPx: readonly number[],
  spanCount: number,
  fallbackWidthPx: number,
): number {
  if (columnWidthsPx.length === 0) {
    return fallbackWidthPx * spanCount;
  }

  let totalWidthPx = 0;
  for (let index = 0; index < spanCount; index++) {
    totalWidthPx += columnWidthsPx[index] ?? fallbackWidthPx;
  }

  return totalWidthPx;
}

function estimateRunWidth(run: Run): number {
  switch (run.kind) {
    case 'image':
      return run.width;
    case 'tab':
      return DEFAULT_TAB_WIDTH_PX;
    case 'lineBreak':
      return 0;
    case 'break':
      return 0;
    case 'text':
    case undefined: {
      const letterSpacingPx = run.letterSpacing ?? 0;
      return (
        run.text.length * Math.max(run.fontSize, DEFAULT_FONT_SIZE_PX) * AVERAGE_GLYPH_WIDTH_RATIO +
        Math.max(run.text.length - 1, 0) * letterSpacingPx
      );
    }
  }
}

function estimateRunLineHeight(run: Run): number {
  switch (run.kind) {
    case 'image':
      return run.height;
    case 'text':
    case undefined:
      return Math.max(run.fontSize * 1.35, DEFAULT_LINE_HEIGHT_PX);
    default:
      return DEFAULT_LINE_HEIGHT_PX;
  }
}

function contentWidth(geometry: LayoutPageGeometry): number {
  return Math.max(geometry.width - geometry.margins.left - geometry.margins.right, MIN_CONTENT_WIDTH_PX);
}

function contentHeight(geometry: LayoutPageGeometry): number {
  return Math.max(geometry.height - geometry.margins.top - geometry.margins.bottom, DEFAULT_LINE_HEIGHT_PX);
}
