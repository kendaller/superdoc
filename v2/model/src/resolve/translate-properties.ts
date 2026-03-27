// ---------------------------------------------------------------------------
// translate-properties.ts
//
// Converts w:pPr and w:rPr XmlElementNode trees into the style-engine's
// ParagraphProperties and RunProperties shapes. These are the raw encoded
// properties the style-engine expects as input to its cascade logic.
//
// All extraction is done via the shared tree-helpers and xml-helpers
// utilities, keeping this module focused on the mapping from OOXML
// element structure to typed property objects.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import {
  findChildElement,
  findChildElements,
  getAttr,
} from "../word/tree-helpers.js";
import { readToggle, readVal, readNumericVal } from "../extract/xml-helpers.js";

import type {
  ParagraphProperties,
  ParagraphSpacing,
  ParagraphIndentation,
  ParagraphNumberingProperties,
  ParagraphBorders,
  ParagraphTabStop,
  ParagraphConditionalFormatting,
  ParagraphFrameProperties,
  BorderProperties,
  ShadingProperties,
  RunProperties,
  RunColorProperties,
  RunFontFamilyProperties,
  RunLangProperties,
  RunEastAsianLayoutProperties,
  RunFitTextProperties,
  UnderlineProperties,
  HighlightProperties,
} from "@superdoc/style-engine/ooxml";

// Re-export the types so downstream consumers can import from this module.
export type {
  ParagraphProperties,
  RunProperties,
  BorderProperties,
  ShadingProperties,
};

// ---------------------------------------------------------------------------
// Paragraph properties (w:pPr)
// ---------------------------------------------------------------------------

/**
 * Translates a `w:pPr` element node into the style-engine's
 * `ParagraphProperties` structure.
 *
 * Extracts all standard OOXML paragraph formatting properties including
 * spacing, indentation, justification, borders, shading, numbering,
 * tab stops, and boolean toggle flags.
 */
export function translateParagraphProperties(
  pPr: XmlElementNode,
): ParagraphProperties {
  const props: ParagraphProperties = {};

  // --- Style reference ---
  props.styleId = readVal(pPr, "pStyle");

  // --- Spacing (w:spacing) ---
  const spacingEl = findChildElement(pPr, "spacing", "w");
  if (spacingEl) {
    props.spacing = translateSpacing(spacingEl);
  }

  // --- Indentation (w:ind) ---
  const indEl = findChildElement(pPr, "ind", "w");
  if (indEl) {
    props.indent = translateIndentation(indEl);
  }

  // --- Justification (w:jc) ---
  props.justification = readVal(pPr, "jc");

  // --- Paragraph borders (w:pBdr) ---
  const pBdrEl = findChildElement(pPr, "pBdr", "w");
  if (pBdrEl) {
    props.borders = translateParagraphBorders(pBdrEl);
  }

  // --- Shading (w:shd) ---
  const shdEl = findChildElement(pPr, "shd", "w");
  if (shdEl) {
    props.shading = translateShading(shdEl);
  }

  // --- Tab stops (w:tabs) ---
  const tabsEl = findChildElement(pPr, "tabs", "w");
  if (tabsEl) {
    props.tabStops = translateTabStops(tabsEl);
  }

  // --- Numbering properties (w:numPr) ---
  const numPrEl = findChildElement(pPr, "numPr", "w");
  if (numPrEl) {
    props.numberingProperties = translateNumberingProperties(numPrEl);
  }

  // --- Boolean toggles ---
  const keepNext = readToggle(pPr, "keepNext");
  if (keepNext !== undefined) props.keepNext = keepNext;

  const keepLines = readToggle(pPr, "keepLines");
  if (keepLines !== undefined) props.keepLines = keepLines;

  const pageBreakBefore = readToggle(pPr, "pageBreakBefore");
  if (pageBreakBefore !== undefined) props.pageBreakBefore = pageBreakBefore;

  const contextualSpacing = readToggle(pPr, "contextualSpacing");
  if (contextualSpacing !== undefined) props.contextualSpacing = contextualSpacing;

  const suppressAutoHyphens = readToggle(pPr, "suppressAutoHyphens");
  if (suppressAutoHyphens !== undefined) props.suppressAutoHyphens = suppressAutoHyphens;

  const suppressLineNumbers = readToggle(pPr, "suppressLineNumbers");
  if (suppressLineNumbers !== undefined) props.suppressLineNumbers = suppressLineNumbers;

  const suppressOverlap = readToggle(pPr, "suppressOverlap");
  if (suppressOverlap !== undefined) props.suppressOverlap = suppressOverlap;

  const widowControl = readToggle(pPr, "widowControl");
  if (widowControl !== undefined) props.widowControl = widowControl;

  const wordWrap = readToggle(pPr, "wordWrap");
  if (wordWrap !== undefined) props.wordWrap = wordWrap;

  const kinsoku = readToggle(pPr, "kinsoku");
  if (kinsoku !== undefined) props.kinsoku = kinsoku;

  const overflowPunct = readToggle(pPr, "overflowPunct");
  if (overflowPunct !== undefined) props.overflowPunct = overflowPunct;

  const topLinePunct = readToggle(pPr, "topLinePunct");
  if (topLinePunct !== undefined) props.topLinePunct = topLinePunct;

  const autoSpaceDE = readToggle(pPr, "autoSpaceDE");
  if (autoSpaceDE !== undefined) props.autoSpaceDE = autoSpaceDE;

  const autoSpaceDN = readToggle(pPr, "autoSpaceDN");
  if (autoSpaceDN !== undefined) props.autoSpaceDN = autoSpaceDN;

  const adjustRightInd = readToggle(pPr, "adjustRightInd");
  if (adjustRightInd !== undefined) props.adjustRightInd = adjustRightInd;

  const mirrorIndents = readToggle(pPr, "mirrorIndents");
  if (mirrorIndents !== undefined) props.mirrorIndents = mirrorIndents;

  const snapToGrid = readToggle(pPr, "snapToGrid");
  if (snapToGrid !== undefined) props.snapToGrid = snapToGrid;

  const bidi = readToggle(pPr, "bidi");
  if (bidi !== undefined) props.rightToLeft = bidi;

  // --- Outline level (w:outlineLvl) ---
  const outlineLvl = readNumericVal(pPr, "outlineLvl");
  if (outlineLvl !== undefined) props.outlineLvl = outlineLvl;

  // --- Text alignment (w:textAlignment) ---
  const textAlignment = readVal(pPr, "textAlignment");
  if (textAlignment) {
    props.textAlignment = textAlignment as ParagraphProperties["textAlignment"];
  }

  // --- Text direction (w:textDirection) ---
  props.textDirection = readVal(pPr, "textDirection");

  // --- Textbox tight wrap (w:textboxTightWrap) ---
  props.textboxTightWrap = readVal(pPr, "textboxTightWrap");

  // --- Division ID (w:divId) ---
  props.divId = readVal(pPr, "divId");

  // --- Conditional formatting (w:cnfStyle) ---
  const cnfStyleEl = findChildElement(pPr, "cnfStyle", "w");
  if (cnfStyleEl) {
    props.cnfStyle = translateCnfStyle(cnfStyleEl);
  }

  // --- Frame properties (w:framePr) ---
  const framePrEl = findChildElement(pPr, "framePr", "w");
  if (framePrEl) {
    props.framePr = translateFrameProperties(framePrEl);
  }

  // --- Run properties within paragraph properties (w:rPr) ---
  const rPrEl = findChildElement(pPr, "rPr", "w");
  if (rPrEl) {
    props.runProperties = translateRunProperties(rPrEl);
  }

  return stripUndefined(props);
}

// ---------------------------------------------------------------------------
// Run properties (w:rPr)
// ---------------------------------------------------------------------------

/**
 * Translates a `w:rPr` element node into the style-engine's
 * `RunProperties` structure.
 *
 * Extracts all standard OOXML run formatting properties including
 * bold, italic, font size, font family, color, underline, strikethrough,
 * highlighting, shading, vertical alignment, and more.
 */
export function translateRunProperties(
  rPr: XmlElementNode,
): RunProperties {
  const props: RunProperties = {};

  // --- Style reference ---
  props.styleId = readVal(rPr, "rStyle");

  // --- Boolean toggles ---
  const bold = readToggle(rPr, "b");
  if (bold !== undefined) props.bold = bold;

  const boldCs = readToggle(rPr, "bCs");
  if (boldCs !== undefined) props.boldCs = boldCs;

  const italic = readToggle(rPr, "i");
  if (italic !== undefined) props.italic = italic;

  const iCs = readToggle(rPr, "iCs");
  if (iCs !== undefined) props.iCs = iCs;

  const strike = readToggle(rPr, "strike");
  if (strike !== undefined) props.strike = strike;

  const dstrike = readToggle(rPr, "dstrike");
  if (dstrike !== undefined) props.dstrike = dstrike;

  const vanish = readToggle(rPr, "vanish");
  if (vanish !== undefined) props.vanish = vanish;

  const webHidden = readToggle(rPr, "webHidden");
  if (webHidden !== undefined) props.webHidden = webHidden;

  const outline = readToggle(rPr, "outline");
  if (outline !== undefined) props.outline = outline;

  const shadow = readToggle(rPr, "shadow");
  if (shadow !== undefined) props.shadow = shadow;

  const emboss = readToggle(rPr, "emboss");
  if (emboss !== undefined) props.emboss = emboss;

  const imprint = readToggle(rPr, "imprint");
  if (imprint !== undefined) props.imprint = imprint;

  const noProof = readToggle(rPr, "noProof");
  if (noProof !== undefined) props.noProof = noProof;

  const snapToGrid = readToggle(rPr, "snapToGrid");
  if (snapToGrid !== undefined) props.snapToGrid = snapToGrid;

  const cs = readToggle(rPr, "cs");
  if (cs !== undefined) props.cs = cs;

  const rtl = readToggle(rPr, "rtl");
  if (rtl !== undefined) props.rtl = rtl;

  const specVanish = readToggle(rPr, "specVanish");
  if (specVanish !== undefined) props.specVanish = specVanish;

  const oMath = readToggle(rPr, "oMath");
  if (oMath !== undefined) props.oMath = oMath;

  // --- Caps / small caps ---
  const caps = readToggle(rPr, "caps");
  if (caps !== undefined) props.textTransform = caps ? "uppercase" : "none";

  const smallCaps = readToggle(rPr, "smallCaps");
  if (smallCaps !== undefined) props.smallCaps = smallCaps;

  // --- Font size (w:sz, w:szCs) ---
  const fontSize = readNumericVal(rPr, "sz");
  if (fontSize !== undefined) props.fontSize = fontSize;

  const fontSizeCs = readNumericVal(rPr, "szCs");
  if (fontSizeCs !== undefined) props.fontSizeCs = fontSizeCs;

  // --- Font family (w:rFonts) ---
  const rFontsEl = findChildElement(rPr, "rFonts", "w");
  if (rFontsEl) {
    props.fontFamily = translateFontFamily(rFontsEl);
  }

  // --- Color (w:color) ---
  const colorEl = findChildElement(rPr, "color", "w");
  if (colorEl) {
    props.color = translateRunColor(colorEl);
  }

  // --- Underline (w:u) ---
  const uEl = findChildElement(rPr, "u", "w");
  if (uEl) {
    props.underline = translateUnderline(uEl);
  }

  // --- Highlight (w:highlight) ---
  const highlightEl = findChildElement(rPr, "highlight", "w");
  if (highlightEl) {
    props.highlight = translateHighlight(highlightEl);
  }

  // --- Vertical alignment (w:vertAlign) ---
  props.vertAlign = readVal(rPr, "vertAlign");

  // --- Letter spacing (w:spacing) ---
  const letterSpacing = readNumericVal(rPr, "spacing");
  if (letterSpacing !== undefined) props.letterSpacing = letterSpacing;

  // --- Kern (w:kern) ---
  const kern = readNumericVal(rPr, "kern");
  if (kern !== undefined) props.kern = kern;

  // --- Position (w:position) ---
  const position = readNumericVal(rPr, "position");
  if (position !== undefined) props.position = position;

  // --- Character width (w:w) ---
  props.w = readVal(rPr, "w");

  // --- Shading (w:shd) ---
  const shdEl = findChildElement(rPr, "shd", "w");
  if (shdEl) {
    props.shading = translateShading(shdEl);
  }

  // --- Borders (w:bdr) ---
  const bdrEl = findChildElement(rPr, "bdr", "w");
  if (bdrEl) {
    props.borders = translateBorder(bdrEl);
  }

  // --- Effect (w:effect) ---
  props.effect = readVal(rPr, "effect");

  // --- Emphasis mark (w:em) ---
  props.em = readVal(rPr, "em");

  // --- Language (w:lang) ---
  const langEl = findChildElement(rPr, "lang", "w");
  if (langEl) {
    props.lang = translateLang(langEl);
  }

  // --- East Asian layout (w:eastAsianLayout) ---
  const eaLayoutEl = findChildElement(rPr, "eastAsianLayout", "w");
  if (eaLayoutEl) {
    props.eastAsianLayout = translateEastAsianLayout(eaLayoutEl);
  }

  // --- Fit text (w:fitText) ---
  const fitTextEl = findChildElement(rPr, "fitText", "w");
  if (fitTextEl) {
    props.fitText = translateFitText(fitTextEl);
  }

  return stripUndefined(props);
}

// ---------------------------------------------------------------------------
// Sub-element translators
// ---------------------------------------------------------------------------

/** Translates a `w:spacing` element under `w:pPr`. */
function translateSpacing(el: XmlElementNode): ParagraphSpacing {
  const spacing: ParagraphSpacing = {};

  const before = optionalNumber(getAttr(el, "before", "w"));
  if (before !== undefined) spacing.before = before;

  const after = optionalNumber(getAttr(el, "after", "w"));
  if (after !== undefined) spacing.after = after;

  const line = optionalNumber(getAttr(el, "line", "w"));
  if (line !== undefined) spacing.line = line;

  const lineRule = getAttr(el, "lineRule", "w");
  if (lineRule) spacing.lineRule = lineRule;

  const beforeAutospacing = getAttr(el, "beforeAutospacing", "w");
  if (beforeAutospacing !== undefined) {
    spacing.beforeAutospacing = beforeAutospacing === "1" || beforeAutospacing === "true";
  }

  const afterAutospacing = getAttr(el, "afterAutospacing", "w");
  if (afterAutospacing !== undefined) {
    spacing.afterAutospacing = afterAutospacing === "1" || afterAutospacing === "true";
  }

  const beforeLines = optionalNumber(getAttr(el, "beforeLines", "w"));
  if (beforeLines !== undefined) spacing.beforeLines = beforeLines;

  const afterLines = optionalNumber(getAttr(el, "afterLines", "w"));
  if (afterLines !== undefined) spacing.afterLines = afterLines;

  return spacing;
}

/** Translates a `w:ind` element into `ParagraphIndentation`. */
function translateIndentation(el: XmlElementNode): ParagraphIndentation {
  const ind: ParagraphIndentation = {};

  ind.left = optionalNumber(getAttr(el, "left", "w"));
  ind.leftChars = optionalNumber(getAttr(el, "leftChars", "w"));
  ind.right = optionalNumber(getAttr(el, "right", "w"));
  ind.rightChars = optionalNumber(getAttr(el, "rightChars", "w"));
  ind.start = optionalNumber(getAttr(el, "start", "w"));
  ind.startChars = optionalNumber(getAttr(el, "startChars", "w"));
  ind.end = optionalNumber(getAttr(el, "end", "w"));
  ind.endChars = optionalNumber(getAttr(el, "endChars", "w"));
  ind.firstLine = optionalNumber(getAttr(el, "firstLine", "w"));
  ind.firstLineChars = optionalNumber(getAttr(el, "firstLineChars", "w"));
  ind.hanging = optionalNumber(getAttr(el, "hanging", "w"));
  ind.hangingChars = optionalNumber(getAttr(el, "hangingChars", "w"));

  return stripUndefined(ind);
}

/** Translates paragraph borders from a `w:pBdr` element. */
function translateParagraphBorders(el: XmlElementNode): ParagraphBorders {
  const borders: ParagraphBorders = {};
  const sides = ["top", "bottom", "left", "right", "between", "bar"] as const;

  for (const side of sides) {
    const sideEl = findChildElement(el, side, "w");
    if (sideEl) {
      borders[side] = translateBorder(sideEl);
    }
  }

  return borders;
}

/** Translates a single border element into `BorderProperties`. */
function translateBorder(el: XmlElementNode): BorderProperties {
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

  return stripUndefined(border);
}

/** Translates a `w:shd` element into `ShadingProperties`. */
function translateShading(el: XmlElementNode): ShadingProperties {
  const shd: ShadingProperties = {};

  shd.val = getAttr(el, "val", "w");
  shd.color = getAttr(el, "color", "w");
  shd.fill = getAttr(el, "fill", "w");
  shd.themeColor = getAttr(el, "themeColor", "w");
  shd.themeFill = getAttr(el, "themeFill", "w");
  shd.themeFillShade = getAttr(el, "themeFillShade", "w");
  shd.themeFillTint = getAttr(el, "themeFillTint", "w");
  shd.themeShade = getAttr(el, "themeShade", "w");
  shd.themeTint = getAttr(el, "themeTint", "w");

  return stripUndefined(shd);
}

/** Translates `w:tabs` children into `ParagraphTabStop[]`. */
function translateTabStops(tabsEl: XmlElementNode): ParagraphTabStop[] {
  const tabEls = findChildElements(tabsEl, "tab", "w");
  return tabEls.map((tabEl) => ({
    tab: {
      tabType: getAttr(tabEl, "val", "w"),
      pos: optionalNumber(getAttr(tabEl, "pos", "w")),
      leader: getAttr(tabEl, "leader", "w"),
    },
  }));
}

/** Translates `w:numPr` into `ParagraphNumberingProperties`. */
function translateNumberingProperties(
  numPrEl: XmlElementNode,
): ParagraphNumberingProperties {
  return {
    ilvl: optionalNumber(readVal(numPrEl, "ilvl")),
    numId: optionalNumber(readVal(numPrEl, "numId")),
  };
}

/** Translates a `w:cnfStyle` element into `ParagraphConditionalFormatting`. */
function translateCnfStyle(el: XmlElementNode): ParagraphConditionalFormatting {
  const cnf: ParagraphConditionalFormatting = {};

  cnf.val = getAttr(el, "val", "w");

  // Individual boolean attributes
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

/** Translates a `w:framePr` element into `ParagraphFrameProperties`. */
function translateFrameProperties(el: XmlElementNode): ParagraphFrameProperties {
  const frame: ParagraphFrameProperties = {};

  frame.dropCap = getAttr(el, "dropCap", "w");
  frame.h = optionalNumber(getAttr(el, "h", "w"));
  frame.w = optionalNumber(getAttr(el, "w", "w"));
  frame.hAnchor = getAttr(el, "hAnchor", "w");
  frame.vAnchor = getAttr(el, "vAnchor", "w");
  frame.hSpace = optionalNumber(getAttr(el, "hSpace", "w"));
  frame.vSpace = optionalNumber(getAttr(el, "vSpace", "w"));
  frame.x = optionalNumber(getAttr(el, "x", "w"));
  frame.xAlign = getAttr(el, "xAlign", "w");
  frame.y = optionalNumber(getAttr(el, "y", "w"));
  frame.yAlign = getAttr(el, "yAlign", "w");
  frame.lines = optionalNumber(getAttr(el, "lines", "w"));
  frame.wrap = getAttr(el, "wrap", "w") as ParagraphFrameProperties["wrap"];
  frame.hRule = getAttr(el, "hRule", "w");

  const anchorLock = getAttr(el, "anchorLock", "w");
  if (anchorLock !== undefined) {
    frame.anchorLock = anchorLock === "1" || anchorLock === "true";
  }

  return stripUndefined(frame);
}

/** Translates a `w:rFonts` element into `RunFontFamilyProperties`. */
function translateFontFamily(el: XmlElementNode): RunFontFamilyProperties {
  const fonts: RunFontFamilyProperties = {};

  fonts.ascii = getAttr(el, "ascii", "w");
  fonts.hAnsi = getAttr(el, "hAnsi", "w");
  fonts.eastAsia = getAttr(el, "eastAsia", "w");
  fonts.cs = getAttr(el, "cs", "w");
  fonts.hint = getAttr(el, "hint", "w");
  fonts.asciiTheme = getAttr(el, "asciiTheme", "w");
  fonts.hAnsiTheme = getAttr(el, "hAnsiTheme", "w");
  fonts.eastAsiaTheme = getAttr(el, "eastAsiaTheme", "w");
  fonts.cstheme = getAttr(el, "cstheme", "w");

  return stripUndefined(fonts);
}

/** Translates a `w:color` element into `RunColorProperties`. */
function translateRunColor(el: XmlElementNode): RunColorProperties {
  const color: RunColorProperties = {};

  color.val = getAttr(el, "val", "w");
  color.themeColor = getAttr(el, "themeColor", "w");
  color.themeTint = getAttr(el, "themeTint", "w");
  color.themeShade = getAttr(el, "themeShade", "w");

  return stripUndefined(color);
}

/** Translates a `w:u` element into `UnderlineProperties`. */
function translateUnderline(el: XmlElementNode): UnderlineProperties {
  const u: UnderlineProperties = {};

  const val = getAttr(el, "val", "w");
  u["w:val"] = val ?? null;
  u["w:color"] = getAttr(el, "color", "w");
  u["w:themeColor"] = getAttr(el, "themeColor", "w");
  u["w:themeTint"] = getAttr(el, "themeTint", "w");
  u["w:themeShade"] = getAttr(el, "themeShade", "w");

  return stripUndefined(u);
}

/** Translates a `w:highlight` element into `HighlightProperties`. */
function translateHighlight(el: XmlElementNode): HighlightProperties {
  const val = getAttr(el, "val", "w");
  return { "w:val": val ?? null };
}

/** Translates a `w:lang` element into `RunLangProperties`. */
function translateLang(el: XmlElementNode): RunLangProperties {
  const lang: RunLangProperties = {};

  lang.val = getAttr(el, "val", "w");
  lang.eastAsia = getAttr(el, "eastAsia", "w");
  lang.bidi = getAttr(el, "bidi", "w");

  return stripUndefined(lang);
}

/** Translates a `w:eastAsianLayout` element. */
function translateEastAsianLayout(
  el: XmlElementNode,
): RunEastAsianLayoutProperties {
  const layout: RunEastAsianLayoutProperties = {};

  layout.id = optionalNumber(getAttr(el, "id", "w"));

  const combine = getAttr(el, "combine", "w");
  if (combine !== undefined) {
    layout.combine = combine === "1" || combine === "true" || combine === "on";
  }

  layout.combineBrackets = getAttr(el, "combineBrackets", "w");

  const vert = getAttr(el, "vert", "w");
  if (vert !== undefined) {
    layout.vert = vert === "1" || vert === "true" || vert === "on";
  }

  const vertCompress = getAttr(el, "vertCompress", "w");
  if (vertCompress !== undefined) {
    layout.vertCompress = vertCompress === "1" || vertCompress === "true" || vertCompress === "on";
  }

  return stripUndefined(layout);
}

/** Translates a `w:fitText` element. */
function translateFitText(el: XmlElementNode): RunFitTextProperties {
  const fit: RunFitTextProperties = {};

  fit.val = optionalNumber(getAttr(el, "val", "w"));
  fit.id = optionalNumber(getAttr(el, "id", "w"));

  return stripUndefined(fit);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Parses a string to a number, returning undefined for non-numeric values. */
function optionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Removes keys with `undefined` values from an object.
 * Keeps the object clean for downstream cascade merging.
 */
function stripUndefined<T extends object>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}
