// ---------------------------------------------------------------------------
// settingsView — typed view over /word/settings.xml
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlElementNode } from "../types/xml.js";
import { getXmlPart, getPartRoot } from "./view-base.js";
import { findChildElement, getAttr } from "./tree-helpers.js";

export type SettingsView = {
  /** Get a setting element by local name (under w: prefix). */
  getSetting(localName: string): XmlElementNode | undefined;
  /** Get the value attribute of a simple w:val-style setting. */
  getSettingVal(localName: string): string | undefined;
  /** Get the raw root element. */
  rootElement(): XmlElementNode | undefined;
};

export function createSettingsView(
  session: PackageSession,
): SettingsView | undefined {
  const maybePart = getXmlPart(session, "/word/settings.xml");
  if (!maybePart) return undefined;
  const part = maybePart;

  const getRoot = () => getPartRoot(part, session);

  return {
    getSetting(localName: string): XmlElementNode | undefined {
      const root = getRoot();
      if (!root) return undefined;
      return findChildElement(root, localName, "w");
    },

    getSettingVal(localName: string): string | undefined {
      const root = getRoot();
      if (!root) return undefined;
      const el = findChildElement(root, localName, "w");
      if (!el) return undefined;
      return getAttr(el, "val", "w");
    },

    rootElement: getRoot,
  };
}
