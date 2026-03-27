// ---------------------------------------------------------------------------
// Table projector
//
// Converts a TableEntity into a layout-compatible TableBlock. Table and cell
// attrs can be resolved through the style-engine when a resolver is provided.
// Row attrs currently remain raw because the style-engine does not yet expose
// a dedicated row-property resolver.
// ---------------------------------------------------------------------------

import type { SemanticModel } from "../../model.js";
import type {
  Entity,
  TableEntity,
  TableCellRawProperties,
  TableRowRawProperties,
  TableRawProperties,
} from "../../entities/types.js";
import type { StyleResolver } from "../../resolve/style-resolver.js";
import type {
  TableBlock,
  TableRow,
  TableCell,
  TableAttrs,
  TableRowAttrs,
  TableCellAttrs,
  TableBorders,
  TableBorderValue,
  CellBorders,
  BorderSpec,
  ParagraphBlock,
} from "./types.js";
import type { ProjectionIdAllocator } from "./block-id.js";
import type { TableCellProperties, TableInfo, TableProperties } from "@superdoc/style-engine/ooxml";
import { projectParagraph } from "./paragraph-projector.js";
import {
  normalizeColor,
  rawTableCellToStyleEngine,
  rawTableToStyleEngine,
} from "./style-engine-adapters.js";

type BorderLike = {
  readonly val?: string;
  readonly color?: string;
  readonly space?: number;
  readonly sz?: number;
  readonly size?: number;
};

export function projectTable(
  entity: TableEntity,
  model: SemanticModel,
  ids: ProjectionIdAllocator,
  resolver?: StyleResolver,
): TableBlock {
  const raw = entity.raw();
  const resolvedTable = resolver
    ? resolver.resolveTableProperties(rawTableToStyleEngine(raw))
    : undefined;
  const rowEntities = model.tableRows(entity.ref);

  const block: TableBlock = {
    kind: "table",
    id: ids.nextBlockId("table", entity.ref),
    rows: projectRows(entity, rowEntities, model, ids, resolvedTable, resolver),
  };

  const attrs = buildTableAttrs(raw, resolvedTable);
  if (attrs) {
    block.attrs = attrs;
  }

  if (raw.gridCols.length > 0) {
    block.columnWidths = raw.gridCols;
  }

  return block;
}

function projectRows(
  tableEntity: TableEntity,
  rowEntities: readonly Entity<"tableRow">[],
  model: SemanticModel,
  ids: ProjectionIdAllocator,
  resolvedTable: TableProperties | undefined,
  resolver?: StyleResolver,
): TableRow[] {
  return rowEntities.map((rowEntity, rowIndex) => {
    const row: TableRow = {
      id: ids.nextId("tableRow"),
      cells: projectCells(
        tableEntity,
        rowEntity,
        rowEntities.length,
        rowIndex,
        model,
        ids,
        resolvedTable,
        resolver,
      ),
    };

    const attrs = buildRowAttrs(rowEntity.raw());
    if (attrs) {
      row.attrs = attrs;
    }

    return row;
  });
}

function projectCells(
  tableEntity: TableEntity,
  rowEntity: Entity<"tableRow">,
  rowCount: number,
  rowIndex: number,
  model: SemanticModel,
  ids: ProjectionIdAllocator,
  resolvedTable: TableProperties | undefined,
  resolver?: StyleResolver,
): TableCell[] {
  const cellEntities = model.tableCells(rowEntity.ref);

  return cellEntities.map((cellEntity, cellIndex) => {
    const rawCell = cellEntity.raw();
    const tableInfo = buildTableInfo(
      tableEntity,
      resolvedTable,
      rowIndex,
      cellIndex,
      rowCount,
      cellEntities.length,
    );
    const resolvedCell = resolver
      ? resolver.resolveTableCellProperties(rawTableCellToStyleEngine(rawCell), tableInfo)
      : undefined;
    const blocks = projectCellContent(cellEntity, model, ids, resolver);

    const cell: TableCell = {
      id: ids.nextId("tableCell"),
      ...(blocks.length === 1 && blocks[0].kind === "paragraph"
        ? { paragraph: blocks[0] as ParagraphBlock }
        : {}),
      ...(blocks.length > 0 ? { blocks } : {}),
      ...(rawCell.gridSpan !== undefined && rawCell.gridSpan > 1
        ? { colSpan: rawCell.gridSpan }
        : {}),
      ...(buildRowSpan(rawCell.vMerge) !== undefined
        ? { rowSpan: buildRowSpan(rawCell.vMerge) }
        : {}),
    };

    const attrs = buildCellAttrs(rawCell, resolvedCell);
    if (attrs) {
      cell.attrs = attrs;
    }

    return cell;
  });
}

function projectCellContent(
  cellEntity: Entity<"tableCell">,
  model: SemanticModel,
  ids: ProjectionIdAllocator,
  resolver?: StyleResolver,
): (ParagraphBlock | TableBlock)[] {
  const blocks: (ParagraphBlock | TableBlock)[] = [];

  for (const entity of model.cellContent(cellEntity.ref)) {
    switch (entity.kind) {
      case "paragraph":
        blocks.push(projectParagraph(entity as Entity<"paragraph">, model, ids, resolver));
        break;
      case "table":
        blocks.push(projectTable(entity as Entity<"table">, model, ids, resolver));
        break;
      case "contentControl":
        for (const childRef of entity.childRefs()) {
          const child = model.entity(childRef);
          if (child?.kind === "paragraph") {
            blocks.push(projectParagraph(child as Entity<"paragraph">, model, ids, resolver));
          } else if (child?.kind === "table") {
            blocks.push(projectTable(child as Entity<"table">, model, ids, resolver));
          }
        }
        break;
    }
  }

  return blocks;
}

function buildTableInfo(
  tableEntity: TableEntity,
  resolvedTable: TableProperties | undefined,
  rowIndex: number,
  cellIndex: number,
  rowCount: number,
  cellCount: number,
): TableInfo {
  return {
    tableProperties: resolvedTable ?? rawTableToStyleEngine(tableEntity.raw()),
    rowIndex,
    cellIndex,
    numRows: rowCount,
    numCells: cellCount,
  };
}

function buildTableAttrs(
  raw: TableRawProperties,
  resolved: TableProperties | undefined,
): TableAttrs | undefined {
  const borders = buildTableBorders(resolved?.borders ?? raw.borders);
  return borders
    ? { borders }
    : undefined;
}

function buildRowAttrs(
  raw: TableRowRawProperties,
): TableRowAttrs | undefined {
  const attrs: TableRowAttrs = {};
  let hasContent = false;

  if (raw.isHeader || raw.cantSplit) {
    attrs.tableRowProperties = {
      ...(raw.isHeader ? { repeatHeader: true } : {}),
      ...(raw.cantSplit ? { cantSplit: true } : {}),
    };
    hasContent = true;
  }

  if (raw.height) {
    attrs.rowHeight = {
      value: raw.height.w,
      ...(raw.heightRule ? { rule: raw.heightRule } : {}),
    };
    hasContent = true;
  }

  return hasContent
    ? attrs
    : undefined;
}

function buildCellAttrs(
  raw: TableCellRawProperties,
  resolved: TableCellProperties | undefined,
): TableCellAttrs | undefined {
  const attrs: TableCellAttrs = {};
  let hasContent = false;

  const borders = buildCellBorders(resolved?.borders ?? raw.borders);
  if (borders) {
    attrs.borders = borders;
    hasContent = true;
  }

  const padding = buildCellPadding(resolved?.cellMargins);
  if (padding) {
    attrs.padding = padding;
    hasContent = true;
  }

  const verticalAlign = mapVerticalAlignment(resolved?.vAlign ?? raw.verticalAlignment);
  if (verticalAlign) {
    attrs.verticalAlign = verticalAlign;
    hasContent = true;
  }

  const background = resolveBackgroundColor(resolved?.shading?.fill ?? raw.shading?.fill);
  if (background) {
    attrs.background = background;
    hasContent = true;
  }

  return hasContent
    ? attrs
    : undefined;
}

function buildTableBorders(
  borders: TableRawProperties["borders"] | TableProperties["borders"],
): TableBorders | undefined {
  if (!borders) {
    return undefined;
  }

  const result: TableBorders = {};
  let hasValue = false;

  for (const side of ["top", "bottom", "left", "right"] as const) {
    const border = borders[side];
    if (!border) {
      continue;
    }

    result[side] = mapTableBorderValue(border);
    hasValue = true;
  }

  if (borders.insideH) {
    result.insideH = mapTableBorderValue(borders.insideH);
    hasValue = true;
  }
  if (borders.insideV) {
    result.insideV = mapTableBorderValue(borders.insideV);
    hasValue = true;
  }

  return hasValue
    ? result
    : undefined;
}

function buildCellBorders(
  borders: TableCellRawProperties["borders"] | TableCellProperties["borders"],
): CellBorders | undefined {
  if (!borders) {
    return undefined;
  }

  const result: CellBorders = {};
  let hasValue = false;

  for (const side of ["top", "bottom", "left", "right"] as const) {
    const border = borders[side] as BorderLike | undefined;
    if (!border || !border.val || border.val === "none" || border.val === "nil") {
      continue;
    }

    result[side] = {
      style: border.val,
      ...((border.sz ?? border.size) !== undefined ? { width: (border.sz ?? border.size)! / 8 } : {}),
      ...(border.color && border.color !== "auto"
        ? { color: normalizeColor(border.color) }
        : {}),
      ...(border.space !== undefined ? { space: border.space } : {}),
    };
    hasValue = true;
  }

  return hasValue
    ? result
    : undefined;
}

function buildCellPadding(
  margins: TableCellProperties["cellMargins"] | undefined,
): TableCellAttrs["padding"] | undefined {
  if (!margins) {
    return undefined;
  }

  const padding: NonNullable<TableCellAttrs["padding"]> = {};
  let hasValue = false;

  if (margins.marginTop?.value !== undefined) {
    padding.top = margins.marginTop.value;
    hasValue = true;
  }
  if (margins.marginRight?.value !== undefined) {
    padding.right = margins.marginRight.value;
    hasValue = true;
  }
  if (margins.marginBottom?.value !== undefined) {
    padding.bottom = margins.marginBottom.value;
    hasValue = true;
  }
  if (margins.marginLeft?.value !== undefined) {
    padding.left = margins.marginLeft.value;
    hasValue = true;
  }

  return hasValue
    ? padding
    : undefined;
}

function buildRowSpan(
  vMerge: string | undefined,
): number | undefined {
  if (vMerge === "restart") {
    return 1;
  }
  if (vMerge === "continue" || vMerge === "") {
    return 0;
  }
  return undefined;
}

function mapTableBorderValue(
  border: BorderLike | undefined,
): TableBorderValue {
  if (!border || !border.val || border.val === "none" || border.val === "nil") {
    return { none: true };
  }

  const spec: BorderSpec = {
    style: border.val,
    ...((border.sz ?? border.size) !== undefined ? { width: (border.sz ?? border.size)! / 8 } : {}),
    ...(border.color && border.color !== "auto"
      ? { color: normalizeColor(border.color) }
      : {}),
    ...(border.space !== undefined ? { space: border.space } : {}),
  };

  return spec;
}

function mapVerticalAlignment(
  value: string | undefined,
): TableCellAttrs["verticalAlign"] | undefined {
  switch (value) {
    case "top":
      return "top";
    case "center":
      return "center";
    case "bottom":
      return "bottom";
    default:
      return undefined;
  }
}

function resolveBackgroundColor(
  fill: string | undefined,
): string | undefined {
  if (!fill || fill === "auto") {
    return undefined;
  }

  return normalizeColor(fill);
}
