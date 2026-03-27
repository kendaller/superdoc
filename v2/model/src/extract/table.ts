// ---------------------------------------------------------------------------
// Table, row, and cell property extractors
//
// Reads `w:tbl`, `w:tr`, and `w:tc` elements and extracts raw properties.
// Grid column widths are extracted from `w:tblGrid`.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type {
  TableBorders,
  TableCellRawProperties,
  TableRawProperties,
  TableRowRawProperties,
} from "../entities/types.js";
import { findChildElement, findChildElements, getAttr } from "../word/tree-helpers.js";
import {
  readBorder,
  readCellMargins,
  readShading,
  readTableMeasurement,
  readToggle,
  readVal,
} from "./xml-helpers.js";

// ---- Table ------------------------------------------------------------------

export function extractTableProperties(element: XmlElementNode): TableRawProperties {
  const tblPr = findChildElement(element, "tblPr", "w");
  const gridCols = extractGridCols(element);

  if (!tblPr) {
    return {
      styleId: undefined,
      width: undefined,
      alignment: undefined,
      borders: undefined,
      cellMargins: undefined,
      look: undefined,
      layout: undefined,
      gridCols,
      bidi: false,
    };
  }

  const tblW = findChildElement(tblPr, "tblW", "w");
  const tblBorders = findChildElement(tblPr, "tblBorders", "w");
  const tblCellMar = findChildElement(tblPr, "tblCellMar", "w");

  return {
    styleId: readVal(tblPr, "tblStyle"),
    width: tblW ? readTableMeasurement(tblW) : undefined,
    alignment: readVal(tblPr, "jc"),
    borders: tblBorders ? extractTableBorders(tblBorders) : undefined,
    cellMargins: tblCellMar ? readCellMargins(tblCellMar) : undefined,
    look: readVal(tblPr, "tblLook"),
    layout: readVal(tblPr, "tblLayout"),
    gridCols,
    bidi: readToggle(tblPr, "bidiVisual") ?? false,
  };
}

function extractGridCols(table: XmlElementNode): number[] {
  const tblGrid = findChildElement(table, "tblGrid", "w");
  if (!tblGrid) return [];

  return findChildElements(tblGrid, "gridCol", "w").map((col) => {
    const w = getAttr(col, "w", "w");
    return w !== undefined ? Number(w) : 0;
  });
}

function extractTableBorders(bordersEl: XmlElementNode): TableBorders {
  const sides = ["top", "bottom", "left", "right", "insideH", "insideV"] as const;
  const result: Record<string, ReturnType<typeof readBorder> | undefined> = {};

  for (const side of sides) {
    const el = findChildElement(bordersEl, side, "w");
    if (el) result[side] = readBorder(el);
  }

  return result as TableBorders;
}

// ---- Table row --------------------------------------------------------------

export function extractTableRowProperties(element: XmlElementNode): TableRowRawProperties {
  const trPr = findChildElement(element, "trPr", "w");

  if (!trPr) {
    return {
      height: undefined,
      heightRule: undefined,
      isHeader: false,
      cantSplit: false,
    };
  }

  const trHeight = findChildElement(trPr, "trHeight", "w");

  return {
    height: trHeight ? readTableMeasurement(trHeight) : undefined,
    heightRule: trHeight ? getAttr(trHeight, "hRule", "w") : undefined,
    isHeader: readToggle(trPr, "tblHeader") ?? false,
    cantSplit: readToggle(trPr, "cantSplit") ?? false,
  };
}

// ---- Table cell -------------------------------------------------------------

export function extractTableCellProperties(element: XmlElementNode): TableCellRawProperties {
  const tcPr = findChildElement(element, "tcPr", "w");

  if (!tcPr) {
    return {
      width: undefined,
      gridSpan: undefined,
      vMerge: undefined,
      borders: undefined,
      shading: undefined,
      verticalAlignment: undefined,
      noWrap: false,
      textDirection: undefined,
    };
  }

  const tcW = findChildElement(tcPr, "tcW", "w");
  const tcBorders = findChildElement(tcPr, "tcBorders", "w");
  const gridSpanEl = findChildElement(tcPr, "gridSpan", "w");
  const vMergeEl = findChildElement(tcPr, "vMerge", "w");

  return {
    width: tcW ? readTableMeasurement(tcW) : undefined,
    gridSpan: gridSpanEl ? optionalNumber(getAttr(gridSpanEl, "val", "w")) : undefined,
    vMerge: vMergeEl ? (getAttr(vMergeEl, "val", "w") ?? "continue") : undefined,
    borders: tcBorders ? extractTableBorders(tcBorders) : undefined,
    shading: readShading(tcPr),
    verticalAlignment: readVal(tcPr, "vAlign"),
    noWrap: readToggle(tcPr, "noWrap") ?? false,
    textDirection: readVal(tcPr, "textDirection"),
  };
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}
