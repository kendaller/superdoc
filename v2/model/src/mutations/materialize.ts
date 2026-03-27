// ---------------------------------------------------------------------------
// Materialize — convert SerializedXmlNode payloads to concrete XmlNode trees
//
// The engine treats SerializedXmlNode as untrusted input: it validates the
// structure, assigns IDs, and produces concrete nodes ready for tree insertion.
// Callers never supply internal IDs — the engine assigns them all.
// ---------------------------------------------------------------------------

import type {
  XmlElementNode,
  XmlTextNode,
  XmlNode,
  XmlAttributeNode,
  XmlNamespaceDecl,
} from "../types/xml.js";
import type {
  SerializedXmlNode,
  SerializedXmlElement,
  SerializedXmlAttribute,
} from "./types.js";

/**
 * Convert a SerializedXmlNode into a concrete XmlNode with engine-assigned IDs.
 *
 * @param serialized - The creation payload (no internal IDs, no source spans).
 * @param nextId - ID generator function (returns session-scoped IDs like "s:0").
 */
export function materializeNode(
  serialized: SerializedXmlNode,
  nextId: () => string,
): XmlNode {
  if (serialized.kind === "text") {
    return materializeText(serialized.value, nextId);
  }
  return materializeElement(serialized, nextId);
}

/** Collect all node IDs in a materialized subtree (for StepEffect reporting). */
export function collectNodeIds(node: XmlNode): string[] {
  const ids: string[] = [node.id];
  if (node.kind === "element") {
    for (const child of node.children) {
      ids.push(...collectNodeIds(child));
    }
  }
  return ids;
}

// ---- Internal helpers -----------------------------------------------------

function materializeText(value: string, nextId: () => string): XmlTextNode {
  return { id: nextId(), kind: "text", value };
}

function materializeElement(
  serialized: SerializedXmlElement,
  nextId: () => string,
): XmlElementNode {
  const elementId = nextId();

  const attributes = materializeAttributes(serialized.attributes, nextId);
  const namespaceDecls = extractNamespaceDecls(serialized, nextId);
  const children = (serialized.children ?? []).map((child) => materializeNode(child, nextId));

  return {
    id: elementId,
    kind: "element",
    prefix: serialized.prefix,
    localName: serialized.name,
    namespaceUri: serialized.namespace,
    attributes,
    namespaceDecls,
    children,
  };
}

function materializeAttributes(
  attrs: SerializedXmlAttribute[] | undefined,
  nextId: () => string,
): XmlAttributeNode[] {
  if (!attrs) return [];
  return attrs.map((attr) => ({
    id: nextId(),
    prefix: attr.prefix,
    localName: attr.name,
    namespaceUri: attr.namespace,
    value: attr.value,
  }));
}

/**
 * Extract namespace declarations from a serialized element.
 *
 * Handles three cases:
 * - Prefixed namespace (e.g. prefix="w", namespace="...wml") → xmlns:w="..."
 * - Default namespace (namespace present, no prefix) → xmlns="..."
 * - Attribute namespaces with prefixes → additional xmlns:prefix declarations
 *
 * Duplicates within the same element are suppressed.
 */
function extractNamespaceDecls(
  serialized: SerializedXmlElement,
  nextId: () => string,
): XmlNamespaceDecl[] {
  const decls: XmlNamespaceDecl[] = [];
  const seen = new Set<string>(); // track "prefix:uri" to avoid duplicates

  // Element's own namespace
  if (serialized.namespace) {
    const key = `${serialized.prefix ?? ""}:${serialized.namespace}`;
    if (!seen.has(key)) {
      seen.add(key);
      decls.push({
        id: nextId(),
        prefix: serialized.prefix,
        uri: serialized.namespace,
      });
    }
  }

  // Attribute namespaces (e.g. r:id needs xmlns:r)
  if (serialized.attributes) {
    for (const attr of serialized.attributes) {
      if (attr.namespace && attr.prefix) {
        const key = `${attr.prefix}:${attr.namespace}`;
        if (!seen.has(key)) {
          seen.add(key);
          decls.push({
            id: nextId(),
            prefix: attr.prefix,
            uri: attr.namespace,
          });
        }
      }
    }
  }

  return decls;
}
