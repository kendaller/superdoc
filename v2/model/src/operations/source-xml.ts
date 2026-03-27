// ---------------------------------------------------------------------------
// Source XML helpers for semantic operations
//
// These helpers let the semantic operation compiler preserve the original
// OOXML subtree whenever possible instead of rebuilding content from a lossy
// semantic snapshot.
// ---------------------------------------------------------------------------

import type { SemanticModel } from "../model.js";
import type { SourceRef } from "../identity/types.js";
import type { SerializedXmlElement, SerializedXmlNode } from "../mutations/types.js";
import type { XmlElementNode, XmlNode, XmlTextNode } from "../types/xml.js";

/**
 * Resolve a source element or throw a focused error that includes the part URI
 * and source node ID. Callers use this when a semantic operation depends on
 * the original XML subtree for fidelity.
 */
export function requireSourceElement(
  model: SemanticModel,
  sourceRef: SourceRef,
  description: string,
): XmlElementNode {
  const element = model.resolveSourceElement(sourceRef);
  if (!element) {
    throw new Error(
      `Could not resolve ${description} at ${sourceRef.partUri}#${sourceRef.nodeId}`,
    );
  }
  return element;
}

/** Convert a concrete XML node into the serialized mutation payload shape. */
export function serializeSourceNode(node: XmlNode): SerializedXmlNode {
  if (node.kind === "text" || node.kind === "cdata") {
    return { kind: "text", value: node.value };
  }

  if (node.kind === "element") {
    return serializeSourceElement(node);
  }

  throw new Error(`Unsupported XML node kind for mutation serialization: ${node.kind}`);
}

/** Convert a concrete XML element into the serialized mutation payload shape. */
export function serializeSourceElement(element: XmlElementNode): SerializedXmlElement {
  return {
    kind: "element",
    name: element.localName,
    ...(element.namespaceUri ? { namespace: element.namespaceUri } : {}),
    ...(element.prefix ? { prefix: element.prefix } : {}),
    ...(element.attributes.length > 0
      ? {
          attributes: element.attributes.map((attribute) => ({
            name: attribute.localName,
            value: attribute.value,
            ...(attribute.namespaceUri ? { namespace: attribute.namespaceUri } : {}),
            ...(attribute.prefix ? { prefix: attribute.prefix } : {}),
          })),
        }
      : {}),
    ...(element.children.length > 0
      ? { children: element.children.map(serializeSourceNode) }
      : {}),
  };
}

/** Find the first direct child element matching a qualified OOXML name. */
export function findDirectChildElement(
  parent: XmlElementNode,
  localName: string,
  prefix?: string,
): XmlElementNode | undefined {
  return parent.children.find(
    (child): child is XmlElementNode =>
      child.kind === "element"
      && child.localName === localName
      && (prefix === undefined || child.prefix === prefix),
  );
}

/** Find the first direct text or CDATA child of an element. */
export function findDirectTextChild(
  parent: XmlElementNode,
): XmlTextNode | undefined {
  return parent.children.find(
    (child): child is XmlTextNode =>
      child.kind === "text",
  );
}

/** Clone an element while replacing its text child content. */
export function cloneTextElementWithValue(
  sourceElement: XmlElementNode,
  value: string,
): SerializedXmlElement {
  return {
    kind: "element",
    name: sourceElement.localName,
    ...(sourceElement.namespaceUri ? { namespace: sourceElement.namespaceUri } : {}),
    ...(sourceElement.prefix ? { prefix: sourceElement.prefix } : {}),
    ...(sourceElement.attributes.length > 0
      ? {
          attributes: sourceElement.attributes.map((attribute) => ({
            name: attribute.localName,
            value: attribute.value,
            ...(attribute.namespaceUri ? { namespace: attribute.namespaceUri } : {}),
            ...(attribute.prefix ? { prefix: attribute.prefix } : {}),
          })),
        }
      : {}),
    children: [{ kind: "text", value }],
  };
}
