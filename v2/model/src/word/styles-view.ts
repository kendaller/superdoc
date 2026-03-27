// ---------------------------------------------------------------------------
// stylesView — typed view over /word/styles.xml
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlElementNode } from "../types/xml.js";
import { getXmlPart, getPartRoot } from "./view-base.js";
import { findChildElements, getAttr, findChildElement } from "./tree-helpers.js";

export type StyleDescriptor = {
  styleId: string;
  type?: string;
  name?: string;
  basedOn?: string;
  linkedStyleId?: string;
  isDefault?: boolean;
  element: XmlElementNode;
};

export type StylesView = {
  /** List all style descriptors. */
  list(): StyleDescriptor[];
  /** Look up a style by its w:styleId. */
  byId(styleId: string): StyleDescriptor | undefined;
  /** Resolve the basedOn chain for a style (returns IDs from child to root). */
  basedOnChain(styleId: string): string[];
  /** Get the raw root element. */
  rootElement(): XmlElementNode | undefined;
};

export function createStylesView(
  session: PackageSession,
): StylesView | undefined {
  const maybePart = getXmlPart(session, "/word/styles.xml");
  if (!maybePart) return undefined;
  const part = maybePart;

  let cachedStyles: StyleDescriptor[] | undefined;
  let styleIndex: Map<string, StyleDescriptor> | undefined;

  const getRoot = () => getPartRoot(part, session);

  function buildStyles(): StyleDescriptor[] {
    if (cachedStyles) return cachedStyles;

    const root = getRoot();
    if (!root) return [];

    const styleElements = findChildElements(root, "style", "w");
    cachedStyles = styleElements.map(parseStyleElement);
    styleIndex = new Map(cachedStyles.map((s) => [s.styleId, s]));
    return cachedStyles;
  }

  return {
    list: buildStyles,

    byId(styleId: string): StyleDescriptor | undefined {
      buildStyles();
      return styleIndex?.get(styleId);
    },

    basedOnChain(styleId: string): string[] {
      buildStyles();
      const chain: string[] = [];
      const visited = new Set<string>();
      let current: string | undefined = styleId;

      while (current && !visited.has(current)) {
        visited.add(current);
        chain.push(current);
        const desc: StyleDescriptor | undefined = styleIndex?.get(current);
        current = desc?.basedOn;
      }

      return chain;
    },

    rootElement: getRoot,
  };
}

function parseStyleElement(el: XmlElementNode): StyleDescriptor {
  const styleId = getAttr(el, "styleId", "w") ?? "";
  const type = getAttr(el, "type", "w");
  const isDefault = getAttr(el, "default", "w") === "1";

  const nameEl = findChildElement(el, "name", "w");
  const name = nameEl ? getAttr(nameEl, "val", "w") : undefined;

  const basedOnEl = findChildElement(el, "basedOn", "w");
  const basedOn = basedOnEl ? getAttr(basedOnEl, "val", "w") : undefined;

  const linkedEl = findChildElement(el, "link", "w");
  const linkedStyleId = linkedEl ? getAttr(linkedEl, "val", "w") : undefined;

  return {
    styleId,
    type,
    name,
    basedOn,
    linkedStyleId,
    isDefault: isDefault || undefined,
    element: el,
  };
}
