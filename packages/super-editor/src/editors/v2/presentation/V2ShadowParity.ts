import type { FlowBlock } from '@superdoc/contracts';

type ParagraphBlock = Extract<FlowBlock, { kind: 'paragraph' }>;
type TableBlock = Extract<FlowBlock, { kind: 'table' }>;
type FlowRun = ParagraphBlock['runs'][number];
type TableCell = TableBlock['rows'][number]['cells'][number];

/**
 * Merge PM-derived range metadata into v2-projected FlowBlocks.
 *
 * The v2 semantic projection is the source of truth for rendered structure.
 * The PM projection is used only as a shadow metadata source for fields that
 * still depend on ProseMirror positions, such as bookmark navigation.
 *
 * The merge is intentionally conservative:
 * - when paragraph/run structures align, run-level PM ranges are copied
 * - when they do not align, the paragraph-level PM range is copied onto the
 *   first/last addressable v2 runs as a fallback
 * - when table structure diverges, the v2 subtree is left untouched
 */
export function mergePmMetadataIntoV2Blocks(v2Blocks: FlowBlock[], shadowPmBlocks: readonly FlowBlock[]): FlowBlock[] {
  if (v2Blocks.length !== shadowPmBlocks.length) {
    return v2Blocks;
  }

  let changed = false;
  const mergedBlocks = v2Blocks.map((v2Block, index) => {
    const merged = mergeBlock(v2Block, shadowPmBlocks[index]);
    if (merged !== v2Block) {
      changed = true;
    }
    return merged;
  });

  return changed ? mergedBlocks : v2Blocks;
}

function mergeBlock(v2Block: FlowBlock, shadowPmBlock: FlowBlock): FlowBlock {
  if (v2Block.kind !== shadowPmBlock.kind) {
    return v2Block;
  }

  switch (v2Block.kind) {
    case 'paragraph':
      return mergeParagraphBlock(v2Block, shadowPmBlock as ParagraphBlock);
    case 'table':
      return mergeTableBlock(v2Block, shadowPmBlock as TableBlock);
    default:
      return v2Block;
  }
}

function mergeParagraphBlock(v2Paragraph: ParagraphBlock, shadowPmParagraph: ParagraphBlock): ParagraphBlock {
  const exactRuns = tryMergeRunsByStructure(v2Paragraph.runs, shadowPmParagraph.runs);
  if (exactRuns) {
    return exactRuns === v2Paragraph.runs ? v2Paragraph : { ...v2Paragraph, runs: exactRuns };
  }

  const fallbackRuns = mergeParagraphRangeFallback(v2Paragraph.runs, shadowPmParagraph.runs);
  return fallbackRuns === v2Paragraph.runs ? v2Paragraph : { ...v2Paragraph, runs: fallbackRuns };
}

function tryMergeRunsByStructure(v2Runs: readonly FlowRun[], shadowPmRuns: readonly FlowRun[]): FlowRun[] | undefined {
  if (v2Runs.length !== shadowPmRuns.length) {
    return undefined;
  }

  for (let index = 0; index < v2Runs.length; index += 1) {
    if (!areCompatibleRuns(v2Runs[index], shadowPmRuns[index])) {
      return undefined;
    }
  }

  let changed = false;
  const mergedRuns = v2Runs.map((v2Run, index) => {
    const merged = withPmRange(v2Run, shadowPmRuns[index]);
    if (merged !== v2Run) {
      changed = true;
    }
    return merged;
  });

  return changed ? mergedRuns : (v2Runs as FlowRun[]);
}

function mergeParagraphRangeFallback(v2Runs: readonly FlowRun[], shadowPmRuns: readonly FlowRun[]): FlowRun[] {
  const paragraphRange = collectParagraphRange(shadowPmRuns);
  if (!paragraphRange) {
    return v2Runs as FlowRun[];
  }

  const firstIndex = findAddressableRunIndex(v2Runs, 'start');
  const lastIndex = findAddressableRunIndex(v2Runs, 'end');
  if (firstIndex === undefined || lastIndex === undefined) {
    return v2Runs as FlowRun[];
  }

  let changed = false;
  const mergedRuns = v2Runs.map((run, index) => {
    if (index !== firstIndex && index !== lastIndex) {
      return run;
    }

    const nextRun = { ...run } as FlowRun & { pmStart?: number; pmEnd?: number };
    if (index === firstIndex && nextRun.pmStart !== paragraphRange.pmStart) {
      nextRun.pmStart = paragraphRange.pmStart;
      changed = true;
    }
    if (index === lastIndex && nextRun.pmEnd !== paragraphRange.pmEnd) {
      nextRun.pmEnd = paragraphRange.pmEnd;
      changed = true;
    }
    return nextRun;
  });

  return changed ? mergedRuns : (v2Runs as FlowRun[]);
}

function mergeTableBlock(v2Table: TableBlock, shadowPmTable: TableBlock): TableBlock {
  if (v2Table.rows.length !== shadowPmTable.rows.length) {
    return v2Table;
  }

  let changed = false;
  const mergedRows = v2Table.rows.map((v2Row, rowIndex) => {
    const shadowPmRow = shadowPmTable.rows[rowIndex];
    if (v2Row.cells.length !== shadowPmRow.cells.length) {
      return v2Row;
    }

    let rowChanged = false;
    const mergedCells = v2Row.cells.map((v2Cell, cellIndex) => {
      const mergedCell = mergeTableCell(v2Cell, shadowPmRow.cells[cellIndex]);
      if (mergedCell !== v2Cell) {
        rowChanged = true;
      }
      return mergedCell;
    });

    if (!rowChanged) {
      return v2Row;
    }

    changed = true;
    return {
      ...v2Row,
      cells: mergedCells,
    };
  });

  return changed ? { ...v2Table, rows: mergedRows } : v2Table;
}

function mergeTableCell(v2Cell: TableCell, shadowPmCell: TableCell): TableCell {
  const v2Blocks = getCellBlocks(v2Cell);
  const shadowPmBlocks = getCellBlocks(shadowPmCell);
  if (!v2Blocks || !shadowPmBlocks || v2Blocks.length !== shadowPmBlocks.length) {
    return v2Cell;
  }

  const mergedBlocks = mergePmMetadataIntoV2Blocks([...v2Blocks], shadowPmBlocks);
  if (blocksEqualByReference(v2Blocks, mergedBlocks)) {
    return v2Cell;
  }

  if (v2Cell.blocks) {
    const nextBlocks = mergedBlocks as unknown as NonNullable<typeof v2Cell.blocks>;
    return {
      ...v2Cell,
      blocks: nextBlocks,
      ...(mergedBlocks.length === 1 && mergedBlocks[0].kind === 'paragraph'
        ? { paragraph: mergedBlocks[0] as TableCell['paragraph'] }
        : {}),
    };
  }

  if (mergedBlocks.length === 1 && mergedBlocks[0].kind === 'paragraph') {
    return {
      ...v2Cell,
      paragraph: mergedBlocks[0] as TableCell['paragraph'],
    };
  }

  return {
    ...v2Cell,
    blocks: mergedBlocks as unknown as NonNullable<typeof v2Cell.blocks>,
  };
}

function getCellBlocks(cell: TableCell): readonly FlowBlock[] | undefined {
  if (cell.blocks && cell.blocks.length > 0) {
    return cell.blocks as readonly FlowBlock[];
  }
  if (cell.paragraph) {
    return [cell.paragraph as FlowBlock];
  }
  return undefined;
}

function blocksEqualByReference(left: readonly FlowBlock[], right: readonly FlowBlock[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function areCompatibleRuns(v2Run: FlowRun, shadowPmRun: FlowRun): boolean {
  return getRunKind(v2Run) === getRunKind(shadowPmRun);
}

function getRunKind(run: FlowRun): string {
  return run.kind ?? 'text';
}

function withPmRange(v2Run: FlowRun, shadowPmRun: FlowRun): FlowRun {
  const pmStart = getPmBoundary(shadowPmRun, 'start');
  const pmEnd = getPmBoundary(shadowPmRun, 'end');
  if (pmStart === undefined && pmEnd === undefined) {
    return v2Run;
  }

  const merged = { ...v2Run } as FlowRun & { pmStart?: number; pmEnd?: number };
  let changed = false;

  if (pmStart !== undefined && merged.pmStart !== pmStart) {
    merged.pmStart = pmStart;
    changed = true;
  }
  if (pmEnd !== undefined && merged.pmEnd !== pmEnd) {
    merged.pmEnd = pmEnd;
    changed = true;
  }

  return changed ? merged : v2Run;
}

function collectParagraphRange(runs: readonly FlowRun[]): { pmStart: number; pmEnd: number } | undefined {
  let pmStart: number | undefined;
  let pmEnd: number | undefined;

  for (const run of runs) {
    const runStart = getPmBoundary(run, 'start');
    const runEnd = getPmBoundary(run, 'end');
    if (runStart !== undefined) {
      pmStart = pmStart === undefined ? runStart : Math.min(pmStart, runStart);
    }
    if (runEnd !== undefined) {
      pmEnd = pmEnd === undefined ? runEnd : Math.max(pmEnd, runEnd);
    }
  }

  return pmStart !== undefined && pmEnd !== undefined ? { pmStart, pmEnd } : undefined;
}

function findAddressableRunIndex(runs: readonly FlowRun[], direction: 'start' | 'end'): number | undefined {
  if (direction === 'start') {
    for (let index = 0; index < runs.length; index += 1) {
      if (canCarryPmRange(runs[index])) {
        return index;
      }
    }
    return undefined;
  }

  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (canCarryPmRange(runs[index])) {
      return index;
    }
  }
  return undefined;
}

function canCarryPmRange(run: FlowRun): boolean {
  const kind = getRunKind(run);
  return kind === 'text' || kind === 'tab' || kind === 'lineBreak' || kind === 'image';
}

function getPmBoundary(run: FlowRun, boundary: 'start' | 'end'): number | undefined {
  const key = boundary === 'start' ? 'pmStart' : 'pmEnd';
  const value = (run as FlowRun & { pmStart?: number; pmEnd?: number })[key];
  return typeof value === 'number' ? value : undefined;
}
