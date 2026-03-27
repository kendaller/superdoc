// ---------------------------------------------------------------------------
// Paragraph property extractor
//
// Reads a `w:p` element and extracts raw paragraph properties from `w:pPr`.
// Only extracts what is explicitly in the XML — no style cascade resolution.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type {
  ParagraphBorders,
  ParagraphRawProperties,
  TabStop,
} from "../entities/types.js";
import { findChildElement, findChildElements, getAttr } from "../word/tree-helpers.js";
import {
  readBorder,
  readNumericVal,
  readToggle,
  readVal,
} from "./xml-helpers.js";
import { extractRunFormatting } from "./run.js";

export function extractParagraphProperties(element: XmlElementNode): ParagraphRawProperties {
  const pPr = findChildElement(element, "pPr", "w");

  // w14:paraId attribute on the paragraph element itself
  const paraId = getAttr(element, "paraId", "w14");

  if (!pPr) {
    return {
      paraId,
      styleId: undefined,
      spacing: undefined,
      alignment: undefined,
      numPr: undefined,
      indentation: undefined,
      keepNext: false,
      keepLines: false,
      pageBreakBefore: false,
      outlineLevel: undefined,
      borders: undefined,
      tabs: undefined,
      bidi: false,
      hasSectPr: false,
      suppressAutoHyphens: false,
      contextualSpacing: false,
      markRunProperties: undefined,
    };
  }

  return {
    paraId,
    styleId: readVal(pPr, "pStyle"),
    spacing: extractSpacing(pPr),
    alignment: readVal(pPr, "jc"),
    numPr: extractNumPr(pPr),
    indentation: extractIndentation(pPr),
    keepNext: readToggle(pPr, "keepNext") ?? false,
    keepLines: readToggle(pPr, "keepLines") ?? false,
    pageBreakBefore: readToggle(pPr, "pageBreakBefore") ?? false,
    outlineLevel: readNumericVal(pPr, "outlineLvl"),
    borders: extractParagraphBorders(pPr),
    tabs: extractTabs(pPr),
    bidi: readToggle(pPr, "bidi") ?? false,
    hasSectPr: findChildElement(pPr, "sectPr", "w") !== undefined,
    suppressAutoHyphens: readToggle(pPr, "suppressAutoHyphens") ?? false,
    contextualSpacing: readToggle(pPr, "contextualSpacing") ?? false,
    markRunProperties: extractMarkRunProperties(pPr),
  };
}

function extractSpacing(pPr: XmlElementNode) {
  const spacing = findChildElement(pPr, "spacing", "w");
  if (!spacing) return undefined;

  const before = getAttr(spacing, "before", "w");
  const after = getAttr(spacing, "after", "w");
  const line = getAttr(spacing, "line", "w");
  const lineRule = getAttr(spacing, "lineRule", "w");
  const beforeAutospacing = getAttr(spacing, "beforeAutospacing", "w");
  const afterAutospacing = getAttr(spacing, "afterAutospacing", "w");

  return {
    before: before !== undefined ? Number(before) : undefined,
    after: after !== undefined ? Number(after) : undefined,
    line: line !== undefined ? Number(line) : undefined,
    lineRule: lineRule ?? undefined,
    beforeAutospacing: beforeAutospacing === "1" || beforeAutospacing === "true" ? true : undefined,
    afterAutospacing: afterAutospacing === "1" || afterAutospacing === "true" ? true : undefined,
  };
}

function extractNumPr(pPr: XmlElementNode) {
  const numPr = findChildElement(pPr, "numPr", "w");
  if (!numPr) return undefined;

  const numId = readVal(numPr, "numId");
  const ilvl = readVal(numPr, "ilvl");
  if (!numId) return undefined;

  return { numId, ilvl: ilvl ?? "0" };
}

function extractIndentation(pPr: XmlElementNode) {
  const ind = findChildElement(pPr, "ind", "w");
  if (!ind) return undefined;

  const left = getAttr(ind, "left", "w") ?? getAttr(ind, "start", "w");
  const right = getAttr(ind, "right", "w") ?? getAttr(ind, "end", "w");
  const firstLine = getAttr(ind, "firstLine", "w");
  const hanging = getAttr(ind, "hanging", "w");

  return {
    left: left !== undefined ? Number(left) : undefined,
    right: right !== undefined ? Number(right) : undefined,
    firstLine: firstLine !== undefined ? Number(firstLine) : undefined,
    hanging: hanging !== undefined ? Number(hanging) : undefined,
  };
}

function extractParagraphBorders(pPr: XmlElementNode): ParagraphBorders | undefined {
  const pBdr = findChildElement(pPr, "pBdr", "w");
  if (!pBdr) return undefined;

  const sides = ["top", "bottom", "left", "right", "between"] as const;
  let found = false;
  const result: Record<string, ReturnType<typeof readBorder> | undefined> = {};

  for (const side of sides) {
    const el = findChildElement(pBdr, side, "w");
    if (el) {
      result[side] = readBorder(el);
      found = true;
    }
  }

  return found ? result as ParagraphBorders : undefined;
}

function extractTabs(pPr: XmlElementNode): TabStop[] | undefined {
  const tabs = findChildElement(pPr, "tabs", "w");
  if (!tabs) return undefined;

  const tabElements = findChildElements(tabs, "tab", "w");
  if (tabElements.length === 0) return undefined;

  return tabElements.map((el) => ({
    val: getAttr(el, "val", "w") ?? "left",
    pos: Number(getAttr(el, "pos", "w") ?? "0"),
    leader: getAttr(el, "leader", "w"),
  }));
}

function extractMarkRunProperties(pPr: XmlElementNode) {
  const rPr = findChildElement(pPr, "rPr", "w");
  if (!rPr) return undefined;
  return extractRunFormatting(rPr);
}
