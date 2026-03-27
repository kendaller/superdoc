// ---------------------------------------------------------------------------
// themeView — typed view over /word/theme/theme*.xml
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlElementNode } from "../types/xml.js";
import type { PartUri } from "../types/package.js";
import { getXmlPart, getPartRoot } from "./view-base.js";
import { findChildElement } from "./tree-helpers.js";

export type ThemeView = {
  partUri: PartUri;
  /** Get the raw root element (a:theme). */
  rootElement(): XmlElementNode | undefined;
  /** Get the theme name from a:theme/@name. */
  name(): string | undefined;
  /** Get the color scheme element. */
  colorScheme(): XmlElementNode | undefined;
  /** Get the font scheme element. */
  fontScheme(): XmlElementNode | undefined;
};

export function createThemeView(
  session: PackageSession,
): ThemeView | undefined {
  // Find the first theme part
  const themeUri = findThemePartUri(session);
  if (!themeUri) return undefined;

  const maybePart = getXmlPart(session, themeUri);
  if (!maybePart) return undefined;
  const part = maybePart;

  const getRoot = () => getPartRoot(part, session);

  return {
    partUri: themeUri,

    rootElement: getRoot,

    name(): string | undefined {
      const root = getRoot();
      if (!root) return undefined;
      const nameAttr = root.attributes.find((a) => a.localName === "name");
      return nameAttr?.value;
    },

    colorScheme(): XmlElementNode | undefined {
      const root = getRoot();
      if (!root) return undefined;
      const elements = findChildElement(root, "themeElements", "a");
      if (!elements) return undefined;
      return findChildElement(elements, "clrScheme", "a");
    },

    fontScheme(): XmlElementNode | undefined {
      const root = getRoot();
      if (!root) return undefined;
      const elements = findChildElement(root, "themeElements", "a");
      if (!elements) return undefined;
      return findChildElement(elements, "fontScheme", "a");
    },
  };
}

function findThemePartUri(session: PackageSession): PartUri | undefined {
  for (const uri of session.parts.keys()) {
    if (uri.match(/\/word\/theme\/theme\d*\.xml$/)) return uri;
  }
  return undefined;
}
