// ---------------------------------------------------------------------------
// Content control (SDT) property extractor
//
// Reads a `w:sdt` element and extracts metadata from `w:sdtPr`:
// ID, tag, alias, lock, and control type.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { ContentControlRawProperties } from "../entities/types.js";
import { findChildElement, getAttr } from "../word/tree-helpers.js";

export function extractContentControlProperties(element: XmlElementNode): ContentControlRawProperties {
  const sdtPr = findChildElement(element, "sdtPr", "w");
  const scope = detectScope(element);

  if (!sdtPr) {
    return { sdtId: undefined, tag: undefined, alias: undefined, lock: undefined, controlType: undefined, scope };
  }

  const idEl = findChildElement(sdtPr, "id", "w");
  const tagEl = findChildElement(sdtPr, "tag", "w");
  const aliasEl = findChildElement(sdtPr, "alias", "w");
  const lockEl = findChildElement(sdtPr, "lock", "w");

  return {
    sdtId: idEl ? getAttr(idEl, "val", "w") : undefined,
    tag: tagEl ? getAttr(tagEl, "val", "w") : undefined,
    alias: aliasEl ? getAttr(aliasEl, "val", "w") : undefined,
    lock: lockEl ? getAttr(lockEl, "val", "w") : undefined,
    controlType: detectControlType(sdtPr),
    scope,
  };
}

/** Detect the SDT control type from w:sdtPr children. */
function detectControlType(sdtPr: XmlElementNode): string | undefined {
  const typeElements = [
    "text", "date", "checkbox", "comboBox", "dropDownList",
    "repeatingSection", "repeatingSectionItem", "group", "docPartObj",
  ];
  for (const child of sdtPr.children) {
    if (child.kind !== "element") continue;
    if (child.prefix === "w" && typeElements.includes(child.localName)) {
      return child.localName;
    }
    // w14:checkbox
    if (child.prefix === "w14" && child.localName === "checkbox") {
      return "checkbox";
    }
  }
  return undefined;
}

/** Detect whether this SDT wraps block or inline content. */
function detectScope(element: XmlElementNode): "block" | "inline" {
  const sdtContent = findChildElement(element, "sdtContent", "w");
  if (!sdtContent) return "inline";

  // If sdtContent contains w:p or w:tbl, it's block-level
  for (const child of sdtContent.children) {
    if (child.kind !== "element") continue;
    if (child.localName === "p" || child.localName === "tbl") return "block";
  }
  return "inline";
}
