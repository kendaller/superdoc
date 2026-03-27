// ---------------------------------------------------------------------------
// Section property extractor (thin)
//
// Reads a `w:sectPr` element and extracts page dimensions, margins,
// header/footer relationship references, orientation, and column count.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { SectionRawProperties } from "../entities/types.js";
import { findChildElement, getAttr } from "../word/tree-helpers.js";

export function extractSectionProperties(element: XmlElementNode): SectionRawProperties {
  const pgSz = findChildElement(element, "pgSz", "w");
  const pgMar = findChildElement(element, "pgMar", "w");
  const cols = findChildElement(element, "cols", "w");

  const headerRefs: string[] = [];
  const footerRefs: string[] = [];
  for (const child of element.children) {
    if (child.kind !== "element") continue;
    if (child.localName === "headerReference" && child.prefix === "w") {
      const rId = getAttr(child, "id", "r");
      if (rId) headerRefs.push(rId);
    }
    if (child.localName === "footerReference" && child.prefix === "w") {
      const rId = getAttr(child, "id", "r");
      if (rId) footerRefs.push(rId);
    }
  }

  return {
    pageWidth: optNum(pgSz && getAttr(pgSz, "w", "w")),
    pageHeight: optNum(pgSz && getAttr(pgSz, "h", "w")),
    marginTop: optNum(pgMar && getAttr(pgMar, "top", "w")),
    marginBottom: optNum(pgMar && getAttr(pgMar, "bottom", "w")),
    marginLeft: optNum(pgMar && getAttr(pgMar, "left", "w")),
    marginRight: optNum(pgMar && getAttr(pgMar, "right", "w")),
    headerRefs,
    footerRefs,
    orientation: pgSz ? getAttr(pgSz, "orient", "w") : undefined,
    cols: optNum(cols && getAttr(cols, "num", "w")),
  };
}

function optNum(val: string | undefined | null): number | undefined {
  if (val == null) return undefined;
  const n = Number(val);
  return Number.isNaN(n) ? undefined : n;
}
