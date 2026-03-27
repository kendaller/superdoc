// ---------------------------------------------------------------------------
// XML serializer — concrete tree → XML string
//
// Preserves:
//   - XML declaration presence and fields
//   - original child order, attribute order
//   - namespace declarations and prefixes
//   - comments, processing instructions, CDATA sections
//   - exact text content
//
// Future: source-span splice strategy for changed-region-only rewrites.
// Current: full serialization from the concrete tree.
// ---------------------------------------------------------------------------

import type {
  XmlDocumentNode,
  XmlNode,
  XmlElementNode,
  XmlDeclarationNode,
  XmlTopLevelNode,
} from "../types/xml.js";

/** Serialize a full XmlDocumentNode back to an XML string. */
export function serializeXmlDocument(doc: XmlDocumentNode): string {
  const parts: string[] = [];

  if (doc.declaration) {
    parts.push(serializeDeclaration(doc.declaration));
  }

  for (const child of doc.children) {
    parts.push(serializeTopLevelNode(child));
  }

  return parts.join("");
}

/** Serialize a single node and its descendants. */
export function serializeNode(node: XmlNode): string {
  switch (node.kind) {
    case "element":
      return serializeElement(node);
    case "text":
      return escapeXmlText(node.value);
    case "cdata":
      return `<![CDATA[${node.value}]]>`;
    case "comment":
      return `<!--${node.value}-->`;
    case "pi":
      return node.value
        ? `<?${node.target} ${node.value}?>`
        : `<?${node.target}?>`;
  }
}

// ---- Internal serializers -------------------------------------------------

function serializeDeclaration(decl: XmlDeclarationNode): string {
  // If we have the original raw string, use it for exact fidelity
  if (decl.raw) return decl.raw;

  let s = `<?xml version="${decl.version}"`;
  if (decl.encoding) s += ` encoding="${decl.encoding}"`;
  if (decl.standalone) s += ` standalone="${decl.standalone}"`;
  s += "?>";
  return s;
}

function serializeTopLevelNode(node: XmlTopLevelNode): string {
  switch (node.kind) {
    case "element":
      return serializeElement(node);
    case "comment":
      return `<!--${node.value}-->`;
    case "pi":
      return node.value
        ? `<?${node.target} ${node.value}?>`
        : `<?${node.target}?>`;
  }
}

function serializeElement(el: XmlElementNode): string {
  const parts: string[] = [];
  const qname = el.prefix ? `${el.prefix}:${el.localName}` : el.localName;

  parts.push(`<${qname}`);

  // Namespace declarations first (preserving order)
  for (const ns of el.namespaceDecls) {
    if (ns.prefix) {
      parts.push(` xmlns:${ns.prefix}="${escapeAttrValue(ns.uri)}"`);
    } else {
      parts.push(` xmlns="${escapeAttrValue(ns.uri)}"`);
    }
  }

  // Attributes (preserving order)
  for (const attr of el.attributes) {
    const attrQName = attr.prefix
      ? `${attr.prefix}:${attr.localName}`
      : attr.localName;
    parts.push(` ${attrQName}="${escapeAttrValue(attr.value)}"`);
  }

  if (el.children.length === 0) {
    parts.push("/>");
  } else {
    parts.push(">");
    for (const child of el.children) {
      parts.push(serializeNode(child));
    }
    parts.push(`</${qname}>`);
  }

  return parts.join("");
}

// ---- Escaping -------------------------------------------------------------

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttrValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
