// ---------------------------------------------------------------------------
// translate-styles.ts
//
// Reads a fully hydrated `w:styles` root XmlElementNode and produces the
// style-engine's `StylesDocumentProperties` structure. This bridges the
// v2/model's XML tree representation to the flat property maps that the
// style-engine's cascade logic expects.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import {
  findChildElement,
  findChildElements,
  getAttr,
} from "../word/tree-helpers.js";
import { readToggle, readVal, readNumericVal } from "../extract/xml-helpers.js";
import {
  translateParagraphProperties,
  translateRunProperties,
} from "./translate-properties.js";

import type {
  StylesDocumentProperties,
  DocDefaults,
  LatentStyles,
  LsdException,
  StyleDefinition,
  TableProperties,
  TableRowProperties,
  TableCellProperties,
  TableStyleType,
  TableStyleProperties,
  MeasurementProperties,
  TableBorders,
  TableCellBorders,
  TableCellMargins,
  TableLookProperties,
  TableFloatingProperties,
  TableRowHeight,
  BorderProperties,
  ShadingProperties,
  ParagraphConditionalFormatting,
} from "@superdoc/style-engine/ooxml";

export type { StylesDocumentProperties, StyleDefinition };

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Translates a fully hydrated `w:styles` root element into the
 * style-engine's `StylesDocumentProperties` format.
 *
 * Extracts:
 * - `w:docDefaults` (default run and paragraph properties)
 * - `w:latentStyles` (latent style defaults and exceptions)
 * - All `w:style` children (paragraph, character, table, numbering styles)
 */
export function translateStyles(
  stylesRoot: XmlElementNode,
): StylesDocumentProperties {
  const docDefaults = translateDocDefaults(stylesRoot);
  const latentStyles = translateLatentStyles(stylesRoot);
  const styles = translateStyleDefinitions(stylesRoot);

  return { docDefaults, latentStyles, styles };
}

// ---------------------------------------------------------------------------
// Document defaults (w:docDefaults)
// ---------------------------------------------------------------------------

function translateDocDefaults(stylesRoot: XmlElementNode): DocDefaults {
  const defaults: DocDefaults = {};
  const docDefaultsEl = findChildElement(stylesRoot, "docDefaults", "w");
  if (!docDefaultsEl) return defaults;

  // w:rPrDefault/w:rPr
  const rPrDefaultEl = findChildElement(docDefaultsEl, "rPrDefault", "w");
  if (rPrDefaultEl) {
    const rPrEl = findChildElement(rPrDefaultEl, "rPr", "w");
    if (rPrEl) {
      defaults.runProperties = translateRunProperties(rPrEl);
    }
  }

  // w:pPrDefault/w:pPr
  const pPrDefaultEl = findChildElement(docDefaultsEl, "pPrDefault", "w");
  if (pPrDefaultEl) {
    const pPrEl = findChildElement(pPrDefaultEl, "pPr", "w");
    if (pPrEl) {
      defaults.paragraphProperties = translateParagraphProperties(pPrEl);
    }
  }

  return defaults;
}

// ---------------------------------------------------------------------------
// Latent styles (w:latentStyles)
// ---------------------------------------------------------------------------

function translateLatentStyles(stylesRoot: XmlElementNode): LatentStyles {
  const latentEl = findChildElement(stylesRoot, "latentStyles", "w");
  if (!latentEl) return {};

  const latent: LatentStyles = {};

  const defLockedState = getAttr(latentEl, "defLockedState", "w");
  if (defLockedState !== undefined) {
    latent.defLockedState = defLockedState === "1" || defLockedState === "true";
  }

  const defUIPriority = getAttr(latentEl, "defUIPriority", "w");
  if (defUIPriority !== undefined) {
    latent.defUIPriority = defUIPriority === "1" || defUIPriority === "true";
  }

  const defSemiHidden = getAttr(latentEl, "defSemiHidden", "w");
  if (defSemiHidden !== undefined) {
    latent.defSemiHidden = defSemiHidden === "1" || defSemiHidden === "true";
  }

  const defUnhideWhenUsed = getAttr(latentEl, "defUnhideWhenUsed", "w");
  if (defUnhideWhenUsed !== undefined) {
    latent.defUnhideWhenUsed = defUnhideWhenUsed === "1" || defUnhideWhenUsed === "true";
  }

  const defQFormat = getAttr(latentEl, "defQFormat", "w");
  if (defQFormat !== undefined) {
    latent.defQFormat = defQFormat === "1" || defQFormat === "true";
  }

  // Latent style exceptions (w:lsdException children)
  const lsdEls = findChildElements(latentEl, "lsdException", "w");
  if (lsdEls.length > 0) {
    const exceptions: Record<string, LsdException> = {};
    for (const lsdEl of lsdEls) {
      const name = getAttr(lsdEl, "name", "w");
      if (!name) continue;

      const exc: LsdException = { name };

      const locked = getAttr(lsdEl, "locked", "w");
      if (locked !== undefined) {
        exc.locked = locked === "1" || locked === "true";
      }

      const qFormat = getAttr(lsdEl, "qFormat", "w");
      if (qFormat !== undefined) {
        exc.qFormat = qFormat === "1" || qFormat === "true";
      }

      const semiHidden = getAttr(lsdEl, "semiHidden", "w");
      if (semiHidden !== undefined) {
        exc.semiHidden = semiHidden === "1" || semiHidden === "true";
      }

      const unhideWhenUsed = getAttr(lsdEl, "unhideWhenUsed", "w");
      if (unhideWhenUsed !== undefined) {
        exc.unhideWhenUsed = unhideWhenUsed === "1" || unhideWhenUsed === "true";
      }

      const uiPriority = optionalNumber(getAttr(lsdEl, "uiPriority", "w"));
      if (uiPriority !== undefined) exc.uiPriority = uiPriority;

      exceptions[name] = exc;
    }
    latent.lsdExceptions = exceptions;
  }

  return latent;
}

// ---------------------------------------------------------------------------
// Style definitions (w:style children)
// ---------------------------------------------------------------------------

function translateStyleDefinitions(
  stylesRoot: XmlElementNode,
): Record<string, StyleDefinition> {
  const styles: Record<string, StyleDefinition> = {};
  const styleEls = findChildElements(stylesRoot, "style", "w");

  for (const styleEl of styleEls) {
    const styleId = getAttr(styleEl, "styleId", "w");
    if (!styleId) continue;

    const def: StyleDefinition = { styleId };

    // --- Metadata attributes ---
    def.type = getAttr(styleEl, "type", "w");

    const isDefault = getAttr(styleEl, "default", "w");
    if (isDefault !== undefined) {
      def.default = isDefault === "1" || isDefault === "true";
    }

    const customStyle = getAttr(styleEl, "customStyle", "w");
    if (customStyle !== undefined) {
      def.customStyle = customStyle === "1" || customStyle === "true";
    }

    // --- Name and relationships ---
    def.name = readVal(styleEl, "name");
    def.aliases = readVal(styleEl, "aliases");
    def.basedOn = readVal(styleEl, "basedOn");
    def.next = readVal(styleEl, "next");
    def.link = readVal(styleEl, "link");

    // --- Boolean flags ---
    const autoRedefine = readToggle(styleEl, "autoRedefine");
    if (autoRedefine !== undefined) def.autoRedefine = autoRedefine;

    const hidden = readToggle(styleEl, "hidden");
    if (hidden !== undefined) def.hidden = hidden;

    const semiHidden = readToggle(styleEl, "semiHidden");
    if (semiHidden !== undefined) def.semiHidden = semiHidden;

    const unhideWhenUsed = readToggle(styleEl, "unhideWhenUsed");
    if (unhideWhenUsed !== undefined) def.unhideWhenUsed = unhideWhenUsed;

    const qFormat = readToggle(styleEl, "qFormat");
    if (qFormat !== undefined) def.qFormat = qFormat;

    const locked = readToggle(styleEl, "locked");
    if (locked !== undefined) def.locked = locked;

    const personal = readToggle(styleEl, "personal");
    if (personal !== undefined) def.personal = personal;

    const personalCompose = readToggle(styleEl, "personalCompose");
    if (personalCompose !== undefined) def.personalCompose = personalCompose;

    const personalReply = readToggle(styleEl, "personalReply");
    if (personalReply !== undefined) def.personalReply = personalReply;

    // --- UI Priority ---
    const uiPriority = readNumericVal(styleEl, "uiPriority");
    if (uiPriority !== undefined) def.uiPriority = uiPriority;

    // --- RSID ---
    const rsidEl = findChildElement(styleEl, "rsid", "w");
    if (rsidEl) {
      const rsidVal = getAttr(rsidEl, "val", "w");
      if (rsidVal) {
        const parsed = parseInt(rsidVal, 16);
        if (!Number.isNaN(parsed)) def.rsid = parsed;
      }
    }

    // --- Paragraph properties (w:pPr) ---
    const pPrEl = findChildElement(styleEl, "pPr", "w");
    if (pPrEl) {
      def.paragraphProperties = translateParagraphProperties(pPrEl);
    }

    // --- Run properties (w:rPr) ---
    const rPrEl = findChildElement(styleEl, "rPr", "w");
    if (rPrEl) {
      def.runProperties = translateRunProperties(rPrEl);
    }

    // --- Table properties (w:tblPr) ---
    const tblPrEl = findChildElement(styleEl, "tblPr", "w");
    if (tblPrEl) {
      def.tableProperties = translateTableProperties(tblPrEl);
    }

    // --- Table row properties (w:trPr) ---
    const trPrEl = findChildElement(styleEl, "trPr", "w");
    if (trPrEl) {
      def.tableRowProperties = translateTableRowProperties(trPrEl);
    }

    // --- Table cell properties (w:tcPr) ---
    const tcPrEl = findChildElement(styleEl, "tcPr", "w");
    if (tcPrEl) {
      def.tableCellProperties = translateTableCellProperties(tcPrEl);
    }

    // --- Table style properties (w:tblStylePr children) ---
    const tblStylePrEls = findChildElements(styleEl, "tblStylePr", "w");
    if (tblStylePrEls.length > 0) {
      const tblStyleProps: Record<string, TableStyleProperties> = {};
      for (const tblStylePrEl of tblStylePrEls) {
        const type = getAttr(tblStylePrEl, "type", "w") as TableStyleType | undefined;
        if (!type) continue;

        const tsp: TableStyleProperties = { type };

        const tspPPr = findChildElement(tblStylePrEl, "pPr", "w");
        if (tspPPr) tsp.paragraphProperties = translateParagraphProperties(tspPPr);

        const tspRPr = findChildElement(tblStylePrEl, "rPr", "w");
        if (tspRPr) tsp.runProperties = translateRunProperties(tspRPr);

        const tspTblPr = findChildElement(tblStylePrEl, "tblPr", "w");
        if (tspTblPr) tsp.tableProperties = translateTableProperties(tspTblPr);

        const tspTrPr = findChildElement(tblStylePrEl, "trPr", "w");
        if (tspTrPr) tsp.tableRowProperties = translateTableRowProperties(tspTrPr);

        const tspTcPr = findChildElement(tblStylePrEl, "tcPr", "w");
        if (tspTcPr) tsp.tableCellProperties = translateTableCellProperties(tspTcPr);

        tblStyleProps[type] = tsp;
      }
      def.tableStyleProperties = tblStyleProps as Record<TableStyleType, TableStyleProperties>;
    }

    styles[styleId] = def;
  }

  return styles;
}

// ---------------------------------------------------------------------------
// Table property translators
// ---------------------------------------------------------------------------

/** Translates a `w:tblPr` element into `TableProperties`. */
function translateTableProperties(tblPr: XmlElementNode): TableProperties {
  const props: TableProperties = {};

  // Style ID
  props.tableStyleId = readVal(tblPr, "tblStyle");

  // Justification
  props.justification = readVal(tblPr, "jc");

  // Right-to-left
  const bidi = readToggle(tblPr, "bidiVisual");
  if (bidi !== undefined) props.rightToLeft = bidi;

  // Layout
  const layoutEl = findChildElement(tblPr, "tblLayout", "w");
  if (layoutEl) {
    props.tableLayout = getAttr(layoutEl, "type", "w");
  }

  // Table width
  const tblWEl = findChildElement(tblPr, "tblW", "w");
  if (tblWEl) {
    props.tableWidth = translateMeasurement(tblWEl);
  }

  // Table indent
  const tblIndEl = findChildElement(tblPr, "tblInd", "w");
  if (tblIndEl) {
    props.tableIndent = translateMeasurement(tblIndEl);
  }

  // Cell spacing
  const tblCellSpEl = findChildElement(tblPr, "tblCellSpacing", "w");
  if (tblCellSpEl) {
    props.tableCellSpacing = translateMeasurement(tblCellSpEl);
  }

  // Band sizes
  const rowBandSize = readNumericVal(tblPr, "tblStyleRowBandSize");
  if (rowBandSize !== undefined) props.tableStyleRowBandSize = rowBandSize;

  const colBandSize = readNumericVal(tblPr, "tblStyleColBandSize");
  if (colBandSize !== undefined) props.tableStyleColBandSize = colBandSize;

  // Overlap
  props.overlap = readVal(tblPr, "tblOverlap");

  // Caption / description
  const captionEl = findChildElement(tblPr, "tblCaption", "w");
  if (captionEl) {
    props.caption = getAttr(captionEl, "val", "w");
  }

  const descEl = findChildElement(tblPr, "tblDescription", "w");
  if (descEl) {
    props.description = getAttr(descEl, "val", "w");
  }

  // Shading
  const shdEl = findChildElement(tblPr, "shd", "w");
  if (shdEl) {
    props.shading = translateShadingDirect(shdEl);
  }

  // Table look
  const tblLookEl = findChildElement(tblPr, "tblLook", "w");
  if (tblLookEl) {
    props.tblLook = translateTableLook(tblLookEl);
  }

  // Borders
  const tblBordersEl = findChildElement(tblPr, "tblBorders", "w");
  if (tblBordersEl) {
    props.borders = translateTableBorders(tblBordersEl);
  }

  // Cell margins
  const tblCellMarEl = findChildElement(tblPr, "tblCellMar", "w");
  if (tblCellMarEl) {
    props.cellMargins = translateTableCellMargins(tblCellMarEl);
  }

  // Floating table properties
  const tblpPrEl = findChildElement(tblPr, "tblpPr", "w");
  if (tblpPrEl) {
    props.floatingTableProperties = translateFloatingTable(tblpPrEl);
  }

  return props;
}

/** Translates a `w:trPr` element into `TableRowProperties`. */
function translateTableRowProperties(trPr: XmlElementNode): TableRowProperties {
  const props: TableRowProperties = {
    cantSplit: false,
    hidden: false,
    repeatHeader: false,
  };

  const cantSplit = readToggle(trPr, "cantSplit");
  if (cantSplit !== undefined) props.cantSplit = cantSplit;

  const hidden = readToggle(trPr, "hidden");
  if (hidden !== undefined) props.hidden = hidden;

  const repeatHeader = readToggle(trPr, "tblHeader");
  if (repeatHeader !== undefined) props.repeatHeader = repeatHeader;

  // Justification
  props.justification = readVal(trPr, "jc");

  // Division ID
  props.divId = readVal(trPr, "divId");

  // Grid before/after
  const gridBefore = readNumericVal(trPr, "gridBefore");
  if (gridBefore !== undefined) props.gridBefore = gridBefore;

  const gridAfter = readNumericVal(trPr, "gridAfter");
  if (gridAfter !== undefined) props.gridAfter = gridAfter;

  // Row height
  const trHeightEl = findChildElement(trPr, "trHeight", "w");
  if (trHeightEl) {
    const rowHeight: TableRowHeight = {};
    rowHeight.value = optionalNumber(getAttr(trHeightEl, "val", "w"));
    rowHeight.rule = getAttr(trHeightEl, "hRule", "w");
    props.rowHeight = rowHeight;
  }

  // Cell spacing
  const cellSpEl = findChildElement(trPr, "tblCellSpacing", "w");
  if (cellSpEl) {
    props.tableCellSpacing = translateMeasurement(cellSpEl);
  }

  // Width before / after
  const wBeforeEl = findChildElement(trPr, "wBefore", "w");
  if (wBeforeEl) props.wBefore = translateMeasurement(wBeforeEl);

  const wAfterEl = findChildElement(trPr, "wAfter", "w");
  if (wAfterEl) props.wAfter = translateMeasurement(wAfterEl);

  // Conditional formatting
  const cnfStyleEl = findChildElement(trPr, "cnfStyle", "w");
  if (cnfStyleEl) {
    props.cnfStyle = translateCnfStyleDirect(cnfStyleEl);
  }

  return props;
}

/** Translates a `w:tcPr` element into `TableCellProperties`. */
function translateTableCellProperties(tcPr: XmlElementNode): TableCellProperties {
  const props: TableCellProperties = {};

  // Cell width
  const tcWEl = findChildElement(tcPr, "tcW", "w");
  if (tcWEl) {
    props.cellWidth = translateMeasurement(tcWEl);
  }

  // Grid span
  const gridSpan = readNumericVal(tcPr, "gridSpan");
  if (gridSpan !== undefined) props.gridSpan = gridSpan;

  // Vertical merge
  const vMergeEl = findChildElement(tcPr, "vMerge", "w");
  if (vMergeEl) {
    props.vMerge = getAttr(vMergeEl, "val", "w") ?? "continue";
  }

  // Borders
  const tcBordersEl = findChildElement(tcPr, "tcBorders", "w");
  if (tcBordersEl) {
    props.borders = translateTableCellBorders(tcBordersEl);
  }

  // Shading
  const shdEl = findChildElement(tcPr, "shd", "w");
  if (shdEl) {
    props.shading = translateShadingDirect(shdEl);
  }

  // No wrap
  const noWrap = readToggle(tcPr, "noWrap");
  if (noWrap !== undefined) props.noWrap = noWrap;

  // Cell margins
  const tcMarEl = findChildElement(tcPr, "tcMar", "w");
  if (tcMarEl) {
    props.cellMargins = translateTableCellMargins(tcMarEl);
  }

  // Text direction
  props.textDirection = readVal(tcPr, "textDirection");

  // Fit text
  const tcFitText = readToggle(tcPr, "tcFitText");
  if (tcFitText !== undefined) props.tcFitText = tcFitText;

  // Vertical alignment
  props.vAlign = readVal(tcPr, "vAlign");

  // Hide mark
  const hideMark = readToggle(tcPr, "hideMark");
  if (hideMark !== undefined) props.hideMark = hideMark;

  // Conditional formatting
  const cnfStyleEl = findChildElement(tcPr, "cnfStyle", "w");
  if (cnfStyleEl) {
    props.cnfStyle = translateCnfStyleDirect(cnfStyleEl);
  }

  return props;
}

// ---------------------------------------------------------------------------
// Table sub-element translators
// ---------------------------------------------------------------------------

/** Translates an element with w:w and w:type into `MeasurementProperties`. */
function translateMeasurement(el: XmlElementNode): MeasurementProperties | undefined {
  const w = optionalNumber(getAttr(el, "w", "w"));
  const type = getAttr(el, "type", "w");
  if (w === undefined) return undefined;
  return { value: w, type };
}

/** Translates a `w:tblLook` element. */
function translateTableLook(el: XmlElementNode): TableLookProperties {
  const look: TableLookProperties = {};

  look.val = getAttr(el, "val", "w");

  const firstRow = getAttr(el, "firstRow", "w");
  if (firstRow !== undefined) look.firstRow = firstRow === "1" || firstRow === "true";

  const lastRow = getAttr(el, "lastRow", "w");
  if (lastRow !== undefined) look.lastRow = lastRow === "1" || lastRow === "true";

  const firstColumn = getAttr(el, "firstColumn", "w");
  if (firstColumn !== undefined) look.firstColumn = firstColumn === "1" || firstColumn === "true";

  const lastColumn = getAttr(el, "lastColumn", "w");
  if (lastColumn !== undefined) look.lastColumn = lastColumn === "1" || lastColumn === "true";

  const noHBand = getAttr(el, "noHBand", "w");
  if (noHBand !== undefined) look.noHBand = noHBand === "1" || noHBand === "true";

  const noVBand = getAttr(el, "noVBand", "w");
  if (noVBand !== undefined) look.noVBand = noVBand === "1" || noVBand === "true";

  return look;
}

/** Translates a `w:tblBorders` element. */
function translateTableBorders(el: XmlElementNode): TableBorders {
  const borders: TableBorders = {};
  const sides = ["top", "left", "bottom", "right", "start", "end", "insideH", "insideV"] as const;

  for (const side of sides) {
    const sideEl = findChildElement(el, side, "w");
    if (sideEl) {
      borders[side as keyof TableBorders] = translateBorderDirect(sideEl);
    }
  }

  return borders;
}

/** Translates a `w:tcBorders` element. */
function translateTableCellBorders(el: XmlElementNode): TableCellBorders {
  const borders: TableCellBorders = {};
  const sides = [
    "top", "start", "left", "bottom", "end", "right",
    "insideH", "insideV", "tl2br", "tr2bl",
  ] as const;

  for (const side of sides) {
    const sideEl = findChildElement(el, side, "w");
    if (sideEl) {
      borders[side as keyof TableCellBorders] = translateBorderDirect(sideEl);
    }
  }

  return borders;
}

/** Translates table cell margins from a container element. */
function translateTableCellMargins(container: XmlElementNode): TableCellMargins {
  const margins: TableCellMargins = {};
  const mapping: Array<[string, keyof TableCellMargins]> = [
    ["top", "marginTop"],
    ["bottom", "marginBottom"],
    ["left", "marginLeft"],
    ["right", "marginRight"],
    ["start", "marginStart"],
    ["end", "marginEnd"],
  ];

  for (const [elName, propKey] of mapping) {
    const sideEl = findChildElement(container, elName, "w");
    if (sideEl) {
      const m = translateMeasurement(sideEl);
      if (m) margins[propKey] = m;
    }
  }

  return margins;
}

/** Translates floating table properties from a `w:tblpPr` element. */
function translateFloatingTable(el: XmlElementNode): TableFloatingProperties {
  const props: TableFloatingProperties = {};

  props.leftFromText = optionalNumber(getAttr(el, "leftFromText", "w"));
  props.rightFromText = optionalNumber(getAttr(el, "rightFromText", "w"));
  props.topFromText = optionalNumber(getAttr(el, "topFromText", "w"));
  props.bottomFromText = optionalNumber(getAttr(el, "bottomFromText", "w"));
  props.tblpX = optionalNumber(getAttr(el, "tblpX", "w"));
  props.tblpY = optionalNumber(getAttr(el, "tblpY", "w"));
  props.horzAnchor = getAttr(el, "horzAnchor", "w");
  props.vertAnchor = getAttr(el, "vertAnchor", "w");
  props.tblpXSpec = getAttr(el, "tblpXSpec", "w");
  props.tblpYSpec = getAttr(el, "tblpYSpec", "w");

  return props;
}

// ---------------------------------------------------------------------------
// Shared helpers (duplicated from translate-properties to avoid circular deps)
// ---------------------------------------------------------------------------

/**
 * Direct border translation for table-level borders.
 * Identical logic to translate-properties but kept local to avoid import
 * loops when only this module is needed.
 */
function translateBorderDirect(el: XmlElementNode): BorderProperties {
  const border: BorderProperties = {};

  border.val = getAttr(el, "val", "w");
  border.color = getAttr(el, "color", "w");
  border.themeColor = getAttr(el, "themeColor", "w");
  border.themeTint = getAttr(el, "themeTint", "w");
  border.themeShade = getAttr(el, "themeShade", "w");
  border.size = optionalNumber(getAttr(el, "sz", "w"));
  border.space = optionalNumber(getAttr(el, "space", "w"));

  const shadowAttr = getAttr(el, "shadow", "w");
  if (shadowAttr !== undefined) {
    border.shadow = shadowAttr === "1" || shadowAttr === "true";
  }

  const frameAttr = getAttr(el, "frame", "w");
  if (frameAttr !== undefined) {
    border.frame = frameAttr === "1" || frameAttr === "true";
  }

  return border;
}

/** Direct shading translation for table elements. */
function translateShadingDirect(el: XmlElementNode): ShadingProperties {
  return {
    val: getAttr(el, "val", "w"),
    color: getAttr(el, "color", "w"),
    fill: getAttr(el, "fill", "w"),
    themeColor: getAttr(el, "themeColor", "w"),
    themeFill: getAttr(el, "themeFill", "w"),
    themeFillShade: getAttr(el, "themeFillShade", "w"),
    themeFillTint: getAttr(el, "themeFillTint", "w"),
    themeShade: getAttr(el, "themeShade", "w"),
    themeTint: getAttr(el, "themeTint", "w"),
  };
}

/** Direct cnfStyle translation for table row / cell properties. */
function translateCnfStyleDirect(el: XmlElementNode): ParagraphConditionalFormatting {
  const cnf: ParagraphConditionalFormatting = {};

  cnf.val = getAttr(el, "val", "w");

  const boolAttrs: Array<[string, keyof ParagraphConditionalFormatting]> = [
    ["firstRow", "firstRow"],
    ["lastRow", "lastRow"],
    ["firstColumn", "firstColumn"],
    ["lastColumn", "lastColumn"],
    ["oddHBand", "oddHBand"],
    ["evenHBand", "evenHBand"],
    ["oddVBand", "oddVBand"],
    ["evenVBand", "evenVBand"],
    ["firstRowFirstColumn", "firstRowFirstColumn"],
    ["firstRowLastColumn", "firstRowLastColumn"],
    ["lastRowFirstColumn", "lastRowFirstColumn"],
    ["lastRowLastColumn", "lastRowLastColumn"],
  ];

  for (const [attrName, propKey] of boolAttrs) {
    const attrVal = getAttr(el, attrName, "w");
    if (attrVal !== undefined) {
      (cnf as Record<string, unknown>)[propKey] =
        attrVal === "1" || attrVal === "true";
    }
  }

  return cnf;
}

/** Parses a string to a number, returning undefined for non-numeric values. */
function optionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}
