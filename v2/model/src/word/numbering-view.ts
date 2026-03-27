// ---------------------------------------------------------------------------
// numberingView — typed view over /word/numbering.xml
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlElementNode } from "../types/xml.js";
import { getXmlPart, getPartRoot } from "./view-base.js";
import { findChildElements, findChildElement, getAttr } from "./tree-helpers.js";

export type AbstractNumDescriptor = {
  abstractNumId: string;
  levels: NumberingLevelDescriptor[];
  element: XmlElementNode;
};

export type NumberingLevelDescriptor = {
  ilvl: string;
  numFmt?: string;
  lvlText?: string;
  start?: string;
  element: XmlElementNode;
};

export type NumInstanceDescriptor = {
  numId: string;
  abstractNumId: string;
  element: XmlElementNode;
};

export type NumberingView = {
  /** List all abstract numbering definitions. */
  abstractNums(): AbstractNumDescriptor[];
  /** List all numbering instances. */
  numInstances(): NumInstanceDescriptor[];
  /** Resolve numId → abstractNumId. */
  resolveAbstractNumId(numId: string): string | undefined;
  /** Get the raw root element. */
  rootElement(): XmlElementNode | undefined;
};

export function createNumberingView(
  session: PackageSession,
): NumberingView | undefined {
  const maybePart = getXmlPart(session, "/word/numbering.xml");
  if (!maybePart) return undefined;
  const part = maybePart;

  let cachedAbstract: AbstractNumDescriptor[] | undefined;
  let cachedInstances: NumInstanceDescriptor[] | undefined;
  let numIdMap: Map<string, string> | undefined;

  const getRoot = () => getPartRoot(part, session);

  function abstractNums(): AbstractNumDescriptor[] {
    if (cachedAbstract) return cachedAbstract;
    const root = getRoot();
    if (!root) return [];

    cachedAbstract = findChildElements(root, "abstractNum", "w").map(
      (el) => {
        const abstractNumId = getAttr(el, "abstractNumId", "w") ?? "";
        const levels = findChildElements(el, "lvl", "w").map((lvl) => ({
          ilvl: getAttr(lvl, "ilvl", "w") ?? "0",
          numFmt: getAttr(findChildElement(lvl, "numFmt", "w")!, "val", "w"),
          lvlText: getAttr(findChildElement(lvl, "lvlText", "w")!, "val", "w"),
          start: getAttr(findChildElement(lvl, "start", "w")!, "val", "w"),
          element: lvl,
        }));
        return { abstractNumId, levels, element: el };
      },
    );
    return cachedAbstract;
  }

  function numInstances(): NumInstanceDescriptor[] {
    if (cachedInstances) return cachedInstances;
    const root = getRoot();
    if (!root) return [];

    cachedInstances = findChildElements(root, "num", "w").map((el) => {
      const numId = getAttr(el, "numId", "w") ?? "";
      const absRef = findChildElement(el, "abstractNumId", "w");
      const abstractNumId = absRef ? getAttr(absRef, "val", "w") ?? "" : "";
      return { numId, abstractNumId, element: el };
    });

    numIdMap = new Map(cachedInstances.map((n) => [n.numId, n.abstractNumId]));
    return cachedInstances;
  }

  return {
    abstractNums,
    numInstances,

    resolveAbstractNumId(numId: string): string | undefined {
      numInstances(); // ensure index built
      return numIdMap?.get(numId);
    },

    rootElement: getRoot,
  };
}
