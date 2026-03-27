// ---------------------------------------------------------------------------
// Resource entity property extractors
//
// Style and numbering definition property extraction from their XML elements.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type {
  StyleRawProperties,
  NumberingDefinitionRawProperties,
  AbstractNumRawProperties,
  NumberingLevelInfo,
} from "../entities/types.js";
import { findChildElements, getAttr } from "../word/tree-helpers.js";
import { readVal } from "./xml-helpers.js";

export function extractStyleProperties(element: XmlElementNode): StyleRawProperties {
  return {
    styleId: getAttr(element, "styleId", "w") ?? "",
    type: getAttr(element, "type", "w"),
    name: readVal(element, "name"),
    basedOn: readVal(element, "basedOn"),
    linkedStyleId: readVal(element, "link"),
    isDefault: getAttr(element, "default", "w") === "1",
  };
}

export function extractNumberingDefinitionProperties(
  element: XmlElementNode,
): NumberingDefinitionRawProperties {
  return {
    numId: getAttr(element, "numId", "w") ?? "",
    abstractNumId: readVal(element, "abstractNumId"),
  };
}

export function extractAbstractNumProperties(
  element: XmlElementNode,
): AbstractNumRawProperties {
  const levels: NumberingLevelInfo[] = findChildElements(element, "lvl", "w").map((lvl) => ({
    ilvl: getAttr(lvl, "ilvl", "w") ?? "0",
    numFmt: readVal(lvl, "numFmt"),
    lvlText: readVal(lvl, "lvlText"),
    start: readVal(lvl, "start") ? Number(readVal(lvl, "start")) : undefined,
  }));

  return {
    abstractNumId: getAttr(element, "abstractNumId", "w") ?? "",
    levels,
  };
}
