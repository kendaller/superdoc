// ---------------------------------------------------------------------------
// fontTableView — typed view over /word/fontTable.xml
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlElementNode } from "../types/xml.js";
import { getXmlPart, getPartRoot } from "./view-base.js";
import { findChildElements, getAttr } from "./tree-helpers.js";

export type FontDescriptor = {
  name: string;
  element: XmlElementNode;
};

export type FontTableView = {
  /** List all font declarations. */
  list(): FontDescriptor[];
  /** Look up a font by name. */
  byName(name: string): FontDescriptor | undefined;
  /** Get the raw root element. */
  rootElement(): XmlElementNode | undefined;
};

export function createFontTableView(
  session: PackageSession,
): FontTableView | undefined {
  const maybePart = getXmlPart(session, "/word/fontTable.xml");
  if (!maybePart) return undefined;
  const part = maybePart;

  let cachedFonts: FontDescriptor[] | undefined;
  let fontIndex: Map<string, FontDescriptor> | undefined;

  const getRoot = () => getPartRoot(part, session);

  function list(): FontDescriptor[] {
    if (cachedFonts) return cachedFonts;
    const root = getRoot();
    if (!root) return [];

    cachedFonts = findChildElements(root, "font", "w").map((el) => ({
      name: getAttr(el, "name", "w") ?? "",
      element: el,
    }));

    fontIndex = new Map(cachedFonts.map((f) => [f.name, f]));
    return cachedFonts;
  }

  return {
    list,

    byName(name: string): FontDescriptor | undefined {
      list();
      return fontIndex?.get(name);
    },

    rootElement: getRoot,
  };
}
