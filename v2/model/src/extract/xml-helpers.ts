// ---------------------------------------------------------------------------
// Shared XML extraction utilities
//
// Thin wrappers around tree-helpers for common OOXML extraction patterns.
// Keeps individual extractors DRY and focused on domain logic.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import { findChildElement, getAttr } from "../word/tree-helpers.js";
import type { BorderProperties, ShadingProperties, TableMeasurement } from "../entities/types.js";

/** Read a boolean toggle element (e.g., `<w:b/>` or `<w:b w:val="true"/>`). */
export function readToggle(parent: XmlElementNode, localName: string): boolean | undefined {
  const el = findChildElement(parent, localName, "w");
  if (!el) return undefined;
  const val = getAttr(el, "val", "w");
  // Present with no val or val="1"/"true"/"on" → true; val="0"/"false"/"off" → false
  if (val === undefined) return true;
  return val === "1" || val === "true" || val === "on";
}

/** Read a simple string attribute from a child element's w:val. */
export function readVal(parent: XmlElementNode, localName: string): string | undefined {
  const el = findChildElement(parent, localName, "w");
  if (!el) return undefined;
  return getAttr(el, "val", "w");
}

/** Read a numeric attribute from a child element's w:val. */
export function readNumericVal(parent: XmlElementNode, localName: string): number | undefined {
  const raw = readVal(parent, localName);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/** Read a border element (e.g., `<w:top w:val="single" w:sz="4" .../>`). */
export function readBorder(el: XmlElementNode): BorderProperties {
  return {
    val: getAttr(el, "val", "w") ?? "none",
    sz: optionalNumber(getAttr(el, "sz", "w")),
    space: optionalNumber(getAttr(el, "space", "w")),
    color: getAttr(el, "color", "w"),
  };
}

/** Read a shading element (`<w:shd w:val="..." w:fill="..." w:color="..."/>`). */
export function readShading(parent: XmlElementNode): ShadingProperties | undefined {
  const shd = findChildElement(parent, "shd", "w");
  if (!shd) return undefined;
  return {
    val: getAttr(shd, "val", "w"),
    fill: getAttr(shd, "fill", "w"),
    color: getAttr(shd, "color", "w"),
  };
}

/** Read a table measurement (`<el w:w="..." w:type="..."/>`). */
export function readTableMeasurement(el: XmlElementNode): TableMeasurement | undefined {
  const w = getAttr(el, "w", "w");
  const type = getAttr(el, "type", "w");
  if (w === undefined) return undefined;
  const n = Number(w);
  return Number.isNaN(n) ? undefined : { w: n, type: type ?? "dxa" };
}

/** Read table cell margins from a container element. */
export function readCellMargins(container: XmlElementNode): {
  top?: TableMeasurement;
  bottom?: TableMeasurement;
  left?: TableMeasurement;
  right?: TableMeasurement;
} | undefined {
  const sides = ["top", "bottom", "left", "right", "start", "end"] as const;
  let found = false;
  const result: Record<string, TableMeasurement | undefined> = {};

  for (const side of sides) {
    const el = findChildElement(container, side, "w");
    if (el) {
      const m = readTableMeasurement(el);
      if (m) {
        // Normalize start→left, end→right for LTR
        const key = side === "start" ? "left" : side === "end" ? "right" : side;
        result[key] = m;
        found = true;
      }
    }
  }

  return found ? result as { top?: TableMeasurement; bottom?: TableMeasurement; left?: TableMeasurement; right?: TableMeasurement } : undefined;
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}
