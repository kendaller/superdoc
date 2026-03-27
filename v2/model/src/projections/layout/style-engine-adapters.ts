// ---------------------------------------------------------------------------
// style-engine-adapters
//
// Bridges semantic-model raw properties to the style-engine's OOXML input
// types, and maps resolved run properties back into the layout projection's
// local formatting shape.
// ---------------------------------------------------------------------------

import type {
  ParagraphRawProperties,
  RunFormatting,
  TableCellRawProperties,
  TableMeasurement,
  TableRawProperties,
} from "../../entities/types.js";
import type {
  ParagraphProperties,
  RunProperties,
  TableCellProperties,
  TableProperties,
} from "@superdoc/style-engine/ooxml";

export function rawParagraphToStyleEngine(
  raw: ParagraphRawProperties,
): ParagraphProperties {
  const result: ParagraphProperties = {};

  if (raw.styleId) result.styleId = raw.styleId;
  if (raw.alignment) result.justification = raw.alignment;
  if (raw.spacing) result.spacing = raw.spacing;
  if (raw.indentation) result.indent = raw.indentation;
  if (raw.numPr) {
    result.numberingProperties = {
      numId: Number(raw.numPr.numId),
      ilvl: Number(raw.numPr.ilvl),
    };
  }
  if (raw.keepNext) result.keepNext = true;
  if (raw.keepLines) result.keepLines = true;
  if (raw.pageBreakBefore) result.pageBreakBefore = true;
  if (raw.contextualSpacing) result.contextualSpacing = true;
  if (raw.bidi) result.rightToLeft = true;
  if (raw.borders) result.borders = raw.borders;
  if (raw.tabs) {
    result.tabStops = raw.tabs.map((tab) => ({
      tab: {
        tabType: tab.val,
        pos: tab.pos,
        leader: tab.leader,
      },
    }));
  }

  return result;
}

export function rawRunToStyleEngine(
  formatting: RunFormatting,
): RunProperties {
  const result: RunProperties = {};

  if (formatting.rStyle) result.styleId = formatting.rStyle;
  if (formatting.bold !== undefined) result.bold = formatting.bold;
  if (formatting.boldCs !== undefined) result.boldCs = formatting.boldCs;
  if (formatting.italic !== undefined) result.italic = formatting.italic;
  if (formatting.italicCs !== undefined) result.iCs = formatting.italicCs;
  if (formatting.underline) result.underline = { "w:val": formatting.underline };
  if (formatting.strike !== undefined) result.strike = formatting.strike;
  if (formatting.dstrike !== undefined) result.dstrike = formatting.dstrike;
  if (formatting.fontSize !== undefined) result.fontSize = formatting.fontSize;
  if (formatting.fontSizeCs !== undefined) result.fontSizeCs = formatting.fontSizeCs;
  if (formatting.fontFamily || formatting.fontFamilyCs) {
    result.fontFamily = {
      ascii: formatting.fontFamily,
      cs: formatting.fontFamilyCs,
      hAnsi: formatting.fontFamily,
      eastAsia: formatting.fontFamily,
    };
  }
  if (formatting.color) result.color = { val: formatting.color };
  if (formatting.highlight) result.highlight = { "w:val": formatting.highlight };
  if (formatting.vertAlign) result.vertAlign = formatting.vertAlign;
  if (formatting.caps !== undefined) result.textTransform = formatting.caps ? "uppercase" : "none";
  if (formatting.smallCaps !== undefined) result.smallCaps = formatting.smallCaps;
  if (formatting.vanish !== undefined) result.vanish = formatting.vanish;
  if (formatting.lang) result.lang = { val: formatting.lang };
  if (formatting.spacing !== undefined) result.letterSpacing = formatting.spacing;
  if (formatting.kern !== undefined) result.kern = formatting.kern;
  if (formatting.position !== undefined) result.position = formatting.position;
  if (formatting.shading) result.shading = formatting.shading;

  return result;
}

export function rawTableToStyleEngine(
  raw: TableRawProperties,
): TableProperties {
  const result: TableProperties = {};

  if (raw.styleId) result.tableStyleId = raw.styleId;
  if (raw.width) result.tableWidth = toMeasurementProperties(raw.width);
  if (raw.alignment) result.justification = raw.alignment;
  if (raw.borders) result.borders = raw.borders;
  if (raw.cellMargins) result.cellMargins = toCellMargins(raw.cellMargins);
  if (raw.layout) result.tableLayout = raw.layout;
  if (raw.bidi) result.rightToLeft = true;

  return result;
}

export function rawTableCellToStyleEngine(
  raw: TableCellRawProperties,
): TableCellProperties {
  const result: TableCellProperties = {};

  if (raw.width) result.cellWidth = toMeasurementProperties(raw.width);
  if (raw.gridSpan !== undefined) result.gridSpan = raw.gridSpan;
  if (raw.vMerge !== undefined) result.vMerge = raw.vMerge;
  if (raw.borders) result.borders = raw.borders;
  if (raw.shading) result.shading = raw.shading;
  if (raw.noWrap) result.noWrap = true;
  if (raw.textDirection) result.textDirection = raw.textDirection;
  if (raw.verticalAlignment) result.vAlign = raw.verticalAlignment;

  return result;
}

export function styleEngineRunToFormatting(
  resolved: RunProperties,
): RunFormatting {
  return {
    rStyle: asString(resolved.styleId),
    bold: asBoolean(resolved.bold),
    boldCs: asBoolean(resolved.boldCs),
    italic: asBoolean(resolved.italic),
    italicCs: asBoolean(resolved.iCs),
    underline: readNestedString(resolved.underline, "w:val"),
    strike: asBoolean(resolved.strike),
    dstrike: asBoolean(resolved.dstrike),
    fontSize: asNumber(resolved.fontSize),
    fontSizeCs: asNumber(resolved.fontSizeCs),
    fontFamily: readNestedString(resolved.fontFamily, "ascii")
      ?? readNestedString(resolved.fontFamily, "hAnsi")
      ?? readNestedString(resolved.fontFamily, "eastAsia"),
    fontFamilyCs: readNestedString(resolved.fontFamily, "cs"),
    color: readNestedString(resolved.color, "val"),
    highlight: readNestedString(resolved.highlight, "w:val"),
    vertAlign: asString(resolved.vertAlign),
    caps: resolved.textTransform === "uppercase" ? true : undefined,
    smallCaps: asBoolean(resolved.smallCaps),
    vanish: asBoolean(resolved.vanish),
    lang: readNestedString(resolved.lang, "val"),
    spacing: asNumber(resolved.letterSpacing),
    kern: asNumber(resolved.kern),
    position: asNumber(resolved.position),
    shading: resolved.shading,
  };
}

export function normalizeColor(color: string): string {
  if (color === "auto") {
    return color;
  }

  return /^[0-9a-fA-F]{6}$/.test(color)
    ? `#${color}`
    : color;
}

function toMeasurementProperties(
  measurement: TableMeasurement,
): { value?: number; type?: string } {
  return {
    value: measurement.w,
    type: measurement.type,
  };
}

function toCellMargins(
  margins: NonNullable<TableRawProperties["cellMargins"]>,
): TableProperties["cellMargins"] {
  const result: NonNullable<TableProperties["cellMargins"]> = {};

  if (margins.top) result.marginTop = toMeasurementProperties(margins.top);
  if (margins.right) result.marginRight = toMeasurementProperties(margins.right);
  if (margins.bottom) result.marginBottom = toMeasurementProperties(margins.bottom);
  if (margins.left) result.marginLeft = toMeasurementProperties(margins.left);

  return result;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
    : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean"
    ? value
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : undefined;
}

function readNestedString(
  value: unknown,
  key: string,
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record[key] === "string"
    ? record[key] as string
    : undefined;
}
