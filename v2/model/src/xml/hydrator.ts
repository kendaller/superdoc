// ---------------------------------------------------------------------------
// XML hydrator — materializes XML regions into concrete tree nodes
//
// Given a byte range (from a structural region), parses it into a full
// XmlNode[] tree. Also supports full-document hydration.
// ---------------------------------------------------------------------------

import { SaxesParser } from "saxes";
import type {
  XmlDocumentNode,
  XmlNode,
  XmlElementNode,
  XmlTextNode,
  XmlCDataNode,
  XmlCommentNode,
  XmlProcessingInstructionNode,
  XmlDeclarationNode,
  XmlAttributeNode,
  XmlNamespaceDecl,
  XmlTopLevelNode,
  SourceSpan,
  HydratedXmlRegion,
} from "../types/xml.js";
import { makeNodeId, makeSubNodeId } from "./node-id.js";
import { buildCharToByteMap, findOpenAngleBracket, assertUtf8Encoding } from "./byte-mapping.js";
import { parseXmlDeclaration } from "./declaration-parser.js";

// ---- Public API -----------------------------------------------------------

/**
 * Hydrate a full XML document from bytes.
 * Returns a complete XmlDocumentNode with all children.
 */
export function hydrateDocument(
  bytes: Uint8Array,
  partUri: string,
  existingDeclaration?: XmlDeclarationNode,
): XmlDocumentNode {
  assertUtf8Encoding(bytes, partUri);
  const text = new TextDecoder("utf-8").decode(bytes);
  const charToByte = buildCharToByteMap(text, bytes);

  const children: XmlTopLevelNode[] = [];
  const elementStack: BuildFrame[] = [];

  let declaration = existingDeclaration;
  if (!declaration) {
    declaration = parseXmlDeclaration(text, partUri);
  }

  // Tracks the character position after the most recent structural event.
  // Used as the start position for text, CDATA, comment, and PI nodes.
  let lastEventEndChar = 0;

  /** Compute a SourceSpan from the last event boundary to the current parser position. */
  function spanSinceLastEvent(): SourceSpan {
    const endChar = parser.position;
    return {
      startByte: charToByte[lastEventEndChar] ?? 0,
      endByte: charToByte[endChar] ?? bytes.length,
    };
  }

  const parser = new SaxesParser({ xmlns: true, position: true });

  parser.on("opentag", (node) => {
    // parser.position is the char index right after the `>` of the open tag.
    // Scan backwards in the text to find the `<` that started it.
    const startChar = findOpenAngleBracket(text, parser.position);
    const startByte = charToByte[startChar] ?? 0;

    const attrs: XmlAttributeNode[] = [];
    const nsDecls: XmlNamespaceDecl[] = [];
    let attrIdx = 0;
    let nsIdx = 0;

    // Separate namespace declarations from regular attributes
    if (node.attributes) {
      for (const [key, attr] of Object.entries(node.attributes)) {
        if (typeof attr === "object" && attr !== null) {
          const typedAttr = attr as { local: string; prefix: string; uri: string; value: string };
          if (key === "xmlns" || key.startsWith("xmlns:")) {
            const declPrefix = key === "xmlns" ? undefined : key.slice(6);
            const declId = makeSubNodeId(
              `${partUri}:element:${startByte}-?`,
              "ns",
              nsIdx++,
            );
            nsDecls.push({ id: declId, prefix: declPrefix, uri: typedAttr.value });
          } else {
            const attrId = makeSubNodeId(
              `${partUri}:element:${startByte}-?`,
              "attr",
              attrIdx++,
            );
            attrs.push({
              id: attrId,
              prefix: typedAttr.prefix || undefined,
              localName: typedAttr.local,
              namespaceUri: typedAttr.uri || undefined,
              value: typedAttr.value,
            });
          }
        }
      }
    }

    const elem: XmlElementNode = {
      id: "", // set on close when we know the full span
      kind: "element",
      prefix: node.prefix || undefined,
      localName: node.local,
      namespaceUri: node.uri || undefined,
      attributes: attrs,
      namespaceDecls: nsDecls,
      children: [],
    };

    elementStack.push({ element: elem, startByte });
    lastEventEndChar = parser.position;
  });

  parser.on("closetag", () => {
    const frame = elementStack.pop();
    if (!frame) return;

    const endChar = parser.position;
    const endByte = charToByte[endChar] ?? bytes.length;
    const span: SourceSpan = { startByte: frame.startByte, endByte };

    frame.element.id = makeNodeId(partUri, "element", span);
    frame.element.sourceSpan = span;

    // Fix attribute and namespace IDs now that we have the element ID
    for (let i = 0; i < frame.element.attributes.length; i++) {
      frame.element.attributes[i].id = makeSubNodeId(frame.element.id, "attr", i);
    }
    for (let i = 0; i < frame.element.namespaceDecls.length; i++) {
      frame.element.namespaceDecls[i].id = makeSubNodeId(frame.element.id, "ns", i);
    }

    if (elementStack.length > 0) {
      elementStack[elementStack.length - 1].element.children.push(frame.element);
    } else {
      children.push(frame.element);
    }

    lastEventEndChar = parser.position;
  });

  parser.on("text", (value) => {
    const span = spanSinceLastEvent();
    const textNode: XmlTextNode = {
      id: makeNodeId(partUri, "text", span),
      kind: "text",
      value,
      sourceSpan: span,
    };
    appendNode(textNode, elementStack, children);
    lastEventEndChar = parser.position;
  });

  parser.on("cdata", (value) => {
    const span = spanSinceLastEvent();
    const cdataNode: XmlCDataNode = {
      id: makeNodeId(partUri, "cdata", span),
      kind: "cdata",
      value,
      sourceSpan: span,
    };
    appendNode(cdataNode, elementStack, children);
    lastEventEndChar = parser.position;
  });

  parser.on("comment", (value) => {
    const span = spanSinceLastEvent();
    const commentNode: XmlCommentNode = {
      id: makeNodeId(partUri, "comment", span),
      kind: "comment",
      value,
      sourceSpan: span,
    };
    appendNode(commentNode, elementStack, children as XmlNode[]);
    lastEventEndChar = parser.position;
  });

  parser.on("processinginstruction", (pi) => {
    const span = spanSinceLastEvent();
    const piNode: XmlProcessingInstructionNode = {
      id: makeNodeId(partUri, "pi", span),
      kind: "pi",
      target: pi.target,
      value: pi.body,
      sourceSpan: span,
    };
    appendNode(piNode, elementStack, children as XmlNode[]);
    lastEventEndChar = parser.position;
  });

  parser.write(text);
  parser.close();

  const docSpan: SourceSpan = { startByte: 0, endByte: bytes.length };
  const docId = makeNodeId(partUri, "document", docSpan);

  return {
    id: docId,
    kind: "document",
    declaration,
    children,
    sourceSpan: docSpan,
  };
}

/**
 * Hydrate a specific region of an XML part.
 * Parses only the bytes within the region's span.
 *
 * Invariant: The region's span.startByte and span.endByte must refer to
 * valid byte offsets within `bytes`. The region is wrapped in either the
 * document's root open tag (to carry namespace declarations) or a synthetic
 * wrapper, parsed as a full document, then unwrapped. Source spans are
 * adjusted back to be relative to the original part bytes.
 *
 * @param rootOpenTag - Optional open tag of the document's root element
 *   (e.g., `<w:document xmlns:w="...">`). Used as the wrapper to carry
 *   namespace declarations into the region parse.
 */
export function hydrateRegion(
  bytes: Uint8Array,
  partUri: string,
  regionId: string,
  span: SourceSpan,
  parentId?: string,
  rootOpenTag?: Uint8Array,
): HydratedXmlRegion {
  const regionBytes = bytes.slice(span.startByte, span.endByte);
  const { prefix, suffix } = buildRegionWrapper(rootOpenTag);

  const wrappedBytes = new Uint8Array(
    prefix.length + regionBytes.length + suffix.length,
  );
  wrappedBytes.set(prefix, 0);
  wrappedBytes.set(regionBytes, prefix.length);
  wrappedBytes.set(suffix, prefix.length + regionBytes.length);

  const doc = hydrateDocument(wrappedBytes, partUri);

  // Extract children from the wrapper element
  const wrapper = doc.children[0];
  const tree: XmlNode[] =
    wrapper?.kind === "element" ? wrapper.children : [];

  // Adjust source spans to be relative to the original part bytes
  adjustSourceSpans(tree, span.startByte - prefix.length);

  return { regionId, span, tree, parentId };
}

// ---- Internal helpers -----------------------------------------------------

type BuildFrame = {
  element: XmlElementNode;
  startByte: number;
};

function appendNode(
  node: XmlNode,
  stack: BuildFrame[],
  topLevel: (XmlNode | XmlTopLevelNode)[],
): void {
  if (stack.length > 0) {
    stack[stack.length - 1].element.children.push(node);
  } else {
    topLevel.push(node);
  }
}

const SYNTHETIC_WRAPPER_TAG = "__hydration_wrapper__";

/** Build the prefix/suffix byte arrays for wrapping a region during hydration. */
function buildRegionWrapper(
  rootOpenTag?: Uint8Array,
): { prefix: Uint8Array; suffix: Uint8Array } {
  if (rootOpenTag) {
    const tagText = new TextDecoder("utf-8").decode(rootOpenTag);
    const nameMatch = tagText.match(/^<(\S+)/);
    const tagName = nameMatch ? nameMatch[1] : SYNTHETIC_WRAPPER_TAG;
    return {
      prefix: rootOpenTag,
      suffix: new TextEncoder().encode(`</${tagName}>`),
    };
  }
  return {
    prefix: new TextEncoder().encode(`<${SYNTHETIC_WRAPPER_TAG}>`),
    suffix: new TextEncoder().encode(`</${SYNTHETIC_WRAPPER_TAG}>`),
  };
}

/** Recursively adjust source spans by a byte offset. */
function adjustSourceSpans(nodes: XmlNode[], offsetDelta: number): void {
  for (const node of nodes) {
    if (node.sourceSpan) {
      node.sourceSpan.startByte += offsetDelta;
      node.sourceSpan.endByte += offsetDelta;
    }
    if (node.kind === "element") {
      adjustSourceSpans(node.children, offsetDelta);
    }
  }
}
