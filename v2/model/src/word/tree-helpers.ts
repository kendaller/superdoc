// ---------------------------------------------------------------------------
// Pure tree traversal helpers
//
// These functions operate solely on XmlNode trees with no session
// dependencies, making them safe to use anywhere without side-effects.
// ---------------------------------------------------------------------------

import type {
  XmlDocumentNode,
  XmlElementNode,
  XmlNode,
} from "../types/xml.js";

/** Find the root element of a hydrated document. */
export function getRootElement(doc: XmlDocumentNode): XmlElementNode | undefined {
  return doc.children.find((c): c is XmlElementNode => c.kind === "element");
}

/** Find direct child elements matching a local name. */
export function findChildElements(
  parent: XmlElementNode,
  localName: string,
  prefix?: string,
): XmlElementNode[] {
  return parent.children.filter(
    (c): c is XmlElementNode =>
      c.kind === "element" &&
      c.localName === localName &&
      (prefix === undefined || c.prefix === prefix),
  );
}

/** Find the first child element matching a local name. */
export function findChildElement(
  parent: XmlElementNode,
  localName: string,
  prefix?: string,
): XmlElementNode | undefined {
  return parent.children.find(
    (c): c is XmlElementNode =>
      c.kind === "element" &&
      c.localName === localName &&
      (prefix === undefined || c.prefix === prefix),
  );
}

/** Get an attribute value from an element. */
export function getAttr(
  el: XmlElementNode,
  localName: string,
  prefix?: string,
): string | undefined {
  const attr = el.attributes.find(
    (a) =>
      a.localName === localName &&
      (prefix === undefined || a.prefix === prefix),
  );
  return attr?.value;
}

/** Collect all text content from an element's descendants. */
export function getTextContent(node: XmlNode): string {
  if (node.kind === "text") return node.value;
  if (node.kind === "cdata") return node.value;
  if (node.kind === "element") {
    return node.children.map(getTextContent).join("");
  }
  return "";
}
