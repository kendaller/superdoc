// ---------------------------------------------------------------------------
// commentsView / footnotesView / endnotesView
//
// Each is a collection view that enumerates items by their Word IDs
// and provides lazy hydration for individual items.
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlElementNode } from "../types/xml.js";
import type { PartUri } from "../types/package.js";
import { getXmlPart, getPartRoot } from "./view-base.js";
import { findChildElements, getAttr } from "./tree-helpers.js";

export type AnnotationDescriptor = {
  wordId: string;
  element: XmlElementNode;
};

export type AnnotationCollectionView = {
  /** List all items in the collection. */
  list(): AnnotationDescriptor[];
  /** Look up an item by its Word ID. */
  byId(wordId: string): AnnotationDescriptor | undefined;
  /** Count of items. */
  count(): number;
  /** Get the raw root element. */
  rootElement(): XmlElementNode | undefined;
};

// ---- Factories ------------------------------------------------------------

export function createCommentsView(
  session: PackageSession,
): AnnotationCollectionView | undefined {
  return createAnnotationView(session, "/word/comments.xml", "comment", "w");
}

export function createFootnotesView(
  session: PackageSession,
): AnnotationCollectionView | undefined {
  return createAnnotationView(session, "/word/footnotes.xml", "footnote", "w");
}

export function createEndnotesView(
  session: PackageSession,
): AnnotationCollectionView | undefined {
  return createAnnotationView(session, "/word/endnotes.xml", "endnote", "w");
}

// ---- Internal builder -----------------------------------------------------

function createAnnotationView(
  session: PackageSession,
  partUri: PartUri,
  itemLocalName: string,
  itemPrefix: string,
): AnnotationCollectionView | undefined {
  const maybePart = getXmlPart(session, partUri);
  if (!maybePart) return undefined;
  const part = maybePart;

  let cachedItems: AnnotationDescriptor[] | undefined;
  let index: Map<string, AnnotationDescriptor> | undefined;

  const getRoot = () => getPartRoot(part, session);

  function list(): AnnotationDescriptor[] {
    if (cachedItems) return cachedItems;
    const root = getRoot();
    if (!root) return [];

    const elements = findChildElements(root, itemLocalName, itemPrefix);
    cachedItems = elements.map((el) => {
      const wordId =
        getAttr(el, "id", "w") ??
        getAttr(el, "id") ??
        "";
      return { wordId, element: el };
    });

    index = new Map(cachedItems.map((d) => [d.wordId, d]));
    return cachedItems;
  }

  return {
    list,

    byId(wordId: string): AnnotationDescriptor | undefined {
      list();
      return index?.get(wordId);
    },

    count(): number {
      return list().length;
    },

    rootElement: getRoot,
  };
}
