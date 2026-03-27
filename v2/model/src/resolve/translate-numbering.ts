// ---------------------------------------------------------------------------
// translate-numbering.ts
//
// Reads a fully hydrated `w:numbering` root XmlElementNode and produces the
// style-engine's `NumberingProperties` structure. This is the numbering
// half of the data required by `OoxmlResolverParams` for style cascade
// resolution.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import {
  findChildElement,
  findChildElements,
  getAttr,
} from "../word/tree-helpers.js";
import { readVal, readNumericVal, readToggle } from "../extract/xml-helpers.js";
import {
  translateParagraphProperties,
  translateRunProperties,
} from "./translate-properties.js";

import type {
  NumberingProperties,
  AbstractNumberingDefinition,
  NumberingDefinition,
  NumberingLevel,
  NumberingLevelOverride,
  NumberingFormat,
  NumberingLegacyProperties,
} from "@superdoc/style-engine/ooxml";

export type { NumberingProperties };

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Translates a fully hydrated `w:numbering` root element into the
 * style-engine's `NumberingProperties` structure.
 *
 * Extracts:
 * - All `w:abstractNum` children into `abstracts` (keyed by abstractNumId)
 * - All `w:num` children into `definitions` (keyed by numId)
 * - Document-level numbering metadata (nsid, tmpl, name, etc.)
 */
export function translateNumbering(
  numberingRoot: XmlElementNode,
): NumberingProperties {
  const result: NumberingProperties = {};

  // --- Document-level metadata ---
  result.nsid = optionalHexNumber(readVal(numberingRoot, "nsid"));
  result.tmpl = optionalHexNumber(readVal(numberingRoot, "tmpl"));
  result.name = readVal(numberingRoot, "name");
  result.styleLink = readVal(numberingRoot, "styleLink");
  result.numStyleLink = readVal(numberingRoot, "numStyleLink");
  result.multiLevelType = readVal(numberingRoot, "multiLevelType");
  result.numIdMacAtCleanup = readNumericVal(numberingRoot, "numIdMacAtCleanup");

  // --- Abstract numbering definitions (w:abstractNum) ---
  const abstractNumEls = findChildElements(numberingRoot, "abstractNum", "w");
  if (abstractNumEls.length > 0) {
    const abstracts: Record<string, AbstractNumberingDefinition> = {};
    for (const absEl of abstractNumEls) {
      const abstractNumId = getAttr(absEl, "abstractNumId", "w");
      if (abstractNumId === undefined) continue;

      const def = translateAbstractNum(absEl, abstractNumId);
      abstracts[abstractNumId] = def;
    }
    result.abstracts = abstracts;
  }

  // --- Concrete numbering definitions (w:num) ---
  const numEls = findChildElements(numberingRoot, "num", "w");
  if (numEls.length > 0) {
    const definitions: Record<string, NumberingDefinition> = {};
    for (const numEl of numEls) {
      const numId = getAttr(numEl, "numId", "w");
      if (numId === undefined) continue;

      const def = translateNum(numEl, numId);
      definitions[numId] = def;
    }
    result.definitions = definitions;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Abstract numbering (w:abstractNum)
// ---------------------------------------------------------------------------

function translateAbstractNum(
  absEl: XmlElementNode,
  abstractNumId: string,
): AbstractNumberingDefinition {
  const def: AbstractNumberingDefinition = {
    abstractNumId: Number(abstractNumId),
  };

  def.nsid = optionalHexNumber(readVal(absEl, "nsid"));
  def.tmpl = optionalHexNumber(readVal(absEl, "tmpl"));
  def.name = readVal(absEl, "name");
  def.styleLink = readVal(absEl, "styleLink");
  def.numStyleLink = readVal(absEl, "numStyleLink");
  def.multiLevelType = readVal(absEl, "multiLevelType");

  // Level definitions (w:lvl children)
  const lvlEls = findChildElements(absEl, "lvl", "w");
  if (lvlEls.length > 0) {
    const levels: Record<string, NumberingLevel> = {};
    for (const lvlEl of lvlEls) {
      const ilvl = getAttr(lvlEl, "ilvl", "w");
      if (ilvl === undefined) continue;

      const level = translateLevel(lvlEl, ilvl);
      levels[ilvl] = level;
    }
    def.levels = levels;
  }

  return def;
}

// ---------------------------------------------------------------------------
// Concrete numbering (w:num)
// ---------------------------------------------------------------------------

function translateNum(
  numEl: XmlElementNode,
  numId: string,
): NumberingDefinition {
  const def: NumberingDefinition = {
    numId: Number(numId),
  };

  // Abstract numbering reference
  const abstractNumIdEl = findChildElement(numEl, "abstractNumId", "w");
  if (abstractNumIdEl) {
    const absId = getAttr(abstractNumIdEl, "val", "w");
    if (absId !== undefined) {
      def.abstractNumId = Number(absId);
    }
  }

  // Level overrides (w:lvlOverride children)
  const lvlOverrideEls = findChildElements(numEl, "lvlOverride", "w");
  if (lvlOverrideEls.length > 0) {
    const overrides: Record<string, NumberingLevelOverride> = {};
    for (const ovrEl of lvlOverrideEls) {
      const ilvl = getAttr(ovrEl, "ilvl", "w");
      if (ilvl === undefined) continue;

      const ovr = translateLevelOverride(ovrEl, ilvl);
      overrides[ilvl] = ovr;
    }
    def.lvlOverrides = overrides;
  }

  return def;
}

// ---------------------------------------------------------------------------
// Level definitions (w:lvl)
// ---------------------------------------------------------------------------

function translateLevel(
  lvlEl: XmlElementNode,
  ilvl: string,
): NumberingLevel {
  const level: NumberingLevel = {
    ilvl: Number(ilvl),
  };

  // Template code
  const tplc = getAttr(lvlEl, "tplc", "w");
  if (tplc !== undefined) {
    const parsed = parseInt(tplc, 16);
    if (!Number.isNaN(parsed)) level.tplc = parsed;
  }

  // Tentative
  const tentative = getAttr(lvlEl, "tentative", "w");
  if (tentative !== undefined) {
    level.tentative = tentative === "1" || tentative === "true";
  }

  // Start value
  level.start = readNumericVal(lvlEl, "start");

  // Picture bullet ID
  level.lvlPicBulletId = readNumericVal(lvlEl, "lvlPicBulletId");

  // Is legal numbering
  const isLgl = readToggle(lvlEl, "isLgl");
  if (isLgl !== undefined) level.isLgl = isLgl;

  // Paragraph style ID
  level.styleId = readVal(lvlEl, "pStyle");

  // Suffix
  level.suff = readVal(lvlEl, "suff");

  // Level text
  const lvlTextEl = findChildElement(lvlEl, "lvlText", "w");
  if (lvlTextEl) {
    level.lvlText = getAttr(lvlTextEl, "val", "w");
  }

  // Level justification
  level.lvlJc = readVal(lvlEl, "lvlJc");

  // Number format
  const numFmtEl = findChildElement(lvlEl, "numFmt", "w");
  if (numFmtEl) {
    level.numFmt = translateNumFmt(numFmtEl);
  }

  // Legacy properties
  const legacyEl = findChildElement(lvlEl, "legacy", "w");
  if (legacyEl) {
    level.legacy = translateLegacy(legacyEl);
  }

  // Paragraph properties (w:pPr)
  const pPrEl = findChildElement(lvlEl, "pPr", "w");
  if (pPrEl) {
    level.paragraphProperties = translateParagraphProperties(pPrEl);
  }

  // Run properties (w:rPr)
  const rPrEl = findChildElement(lvlEl, "rPr", "w");
  if (rPrEl) {
    level.runProperties = translateRunProperties(rPrEl);
  }

  return level;
}

// ---------------------------------------------------------------------------
// Level overrides (w:lvlOverride)
// ---------------------------------------------------------------------------

function translateLevelOverride(
  ovrEl: XmlElementNode,
  ilvl: string,
): NumberingLevelOverride {
  const ovr: NumberingLevelOverride = {
    ilvl: Number(ilvl),
  };

  // Start override
  ovr.startOverride = readNumericVal(ovrEl, "startOverride");

  // Level definition override (w:lvl child)
  const lvlEl = findChildElement(ovrEl, "lvl", "w");
  if (lvlEl) {
    ovr.lvl = translateLevel(lvlEl, ilvl);
  }

  return ovr;
}

// ---------------------------------------------------------------------------
// Number format (w:numFmt)
// ---------------------------------------------------------------------------

function translateNumFmt(el: XmlElementNode): NumberingFormat {
  return {
    val: getAttr(el, "val", "w"),
    format: getAttr(el, "format", "w"),
  };
}

// ---------------------------------------------------------------------------
// Legacy numbering (w:legacy)
// ---------------------------------------------------------------------------

function translateLegacy(el: XmlElementNode): NumberingLegacyProperties {
  const legacy: NumberingLegacyProperties = {};

  const legacyFlag = getAttr(el, "legacy", "w");
  if (legacyFlag !== undefined) {
    legacy.legacy = legacyFlag === "1" || legacyFlag === "true";
  }

  legacy.legacySpace = optionalNumber(getAttr(el, "legacySpace", "w"));
  legacy.legacyIndent = optionalNumber(getAttr(el, "legacyIndent", "w"));

  return legacy;
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

/** Parses a hex string to a number, returning undefined for invalid values. */
function optionalHexNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseInt(raw, 16);
  return Number.isNaN(n) ? undefined : n;
}
