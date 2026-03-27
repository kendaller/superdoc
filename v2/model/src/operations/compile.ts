// ---------------------------------------------------------------------------
// Semantic operation compiler
//
// Compiles a SemanticOperation into primitive MutationStep[] while preserving
// as much of the original OOXML subtree as possible. The compiler only edits
// the XML required by the requested intent; everything else is cloned from the
// source document verbatim.
// ---------------------------------------------------------------------------

import type { SemanticOperation } from "./types.js";
import type {
  InsertTextOp,
  SplitParagraphOp,
  MergeParagraphsOp,
  InsertParagraphOp,
  SetParagraphStyleOp,
  ToggleBoldOp,
} from "./types.js";
import type {
  MutationStep,
  PartRef,
  NodeRef,
  SerializedXmlElement,
  SerializedXmlNode,
} from "../mutations/types.js";
import type { SemanticModel } from "../model.js";
import type { Entity, EntityKind } from "../entities/types.js";
import type { EntityRef, SourceRef } from "../identity/types.js";
import type { InlineSegment } from "../entities/inline-segments.js";
import type { XmlElementNode, XmlTextNode } from "../types/xml.js";
import { createSourceRef } from "../identity/types.js";
import {
  cloneTextElementWithValue,
  findDirectChildElement,
  findDirectTextChild,
  requireSourceElement,
  serializeSourceElement,
} from "./source-xml.js";

const XML_SPACE_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const WORDPROCESSINGML_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// ---- Public API -------------------------------------------------------------

/**
 * Compile a semantic operation into primitive mutation steps.
 *
 * Resolves entity refs to source refs, builds targeted XML edits, and avoids
 * baking resolved properties back into the package.
 */
export function compileOperation(
  op: SemanticOperation,
  model: SemanticModel,
): MutationStep[] {
  switch (op.kind) {
    case "insertText":
      return compileInsertText(op, model);
    case "splitParagraph":
      return compileSplitParagraph(op, model);
    case "mergeParagraphs":
      return compileMergeParagraphs(op, model);
    case "insertParagraph":
      return compileInsertParagraph(op, model);
    case "setParagraphStyle":
      return compileSetParagraphStyle(op, model);
    case "toggleBold":
      return compileToggleBold(op, model);
  }
}

// ---- insertText -------------------------------------------------------------

function compileInsertText(
  op: InsertTextOp,
  model: SemanticModel,
): MutationStep[] {
  const run = resolveEntity(model, op.target, "run");
  const runSource = primarySource(run);
  const part = partRef(runSource);

  const textSegments = model.segments(op.target).filter(isTextSegment);
  if (textSegments.length === 0) {
    return [{
      kind: "xml.insertNode",
      part,
      position: { kind: "append", parent: nodeRef(runSource) },
      content: buildTextElement(op.text),
    }];
  }

  const targetSegment = resolveTargetTextSegment(textSegments, op.position);
  const textElement = resolveTextElement(model, runSource.partUri, targetSegment.localId);
  const textNode = findDirectTextChild(textElement);
  if (!textNode) {
    throw new Error(`Text segment ${targetSegment.localId} has no text node`);
  }

  const deleteLength = op.deleteLength ?? 0;
  const insertionOffset = clampOffset(op.position?.charOffset ?? targetSegment.text.length, targetSegment.text.length);
  const replacementEnd = clampOffset(insertionOffset + deleteLength, targetSegment.text.length);
  const newText =
    targetSegment.text.slice(0, insertionOffset)
    + op.text
    + targetSegment.text.slice(replacementEnd);

  const steps: MutationStep[] = [{
    kind: "xml.setText",
    part,
    node: {
      kind: "node",
      partUri: runSource.partUri,
      nodeId: textNode.id,
      stability: "source-anchored",
    },
    value: newText,
  }];

  const needsPreserve = needsPreserveWhitespace(newText);
  const hasPreserveAttr = textElement.attributes.some(
    (attribute) =>
      attribute.prefix === "xml"
      && attribute.localName === "space"
      && attribute.value === "preserve",
  );

  if (needsPreserve && !hasPreserveAttr) {
    steps.push({
      kind: "xml.setAttribute",
      part,
      node: nodeRefForNodeId(runSource.partUri, textElement.id),
      name: "space",
      namespace: XML_SPACE_NAMESPACE,
      prefix: "xml",
      value: "preserve",
    });
  } else if (!needsPreserve && hasPreserveAttr) {
    steps.push({
      kind: "xml.removeAttribute",
      part,
      node: nodeRefForNodeId(runSource.partUri, textElement.id),
      name: "space",
      namespace: XML_SPACE_NAMESPACE,
    });
  }

  return steps;
}

// ---- splitParagraph ---------------------------------------------------------

function compileSplitParagraph(
  op: SplitParagraphOp,
  model: SemanticModel,
): MutationStep[] {
  const paragraph = resolveEntity(model, op.target, "paragraph");
  const paragraphSource = primarySource(paragraph);
  const part = partRef(paragraphSource);
  const runs = model.runs(op.target);
  const styleId = paragraph.raw().styleId;

  const pendingParagraphId = `pending:splitParagraph:${op.id}`;
  const newParagraphRef: NodeRef = {
    kind: "node",
    partUri: paragraphSource.partUri,
    nodeId: pendingParagraphId,
    stability: "session-generated",
  };

  const steps: MutationStep[] = [{
    kind: "xml.insertNode",
    part,
    position: { kind: "after", node: nodeRef(paragraphSource) },
    content: buildParagraphElement(styleId),
    assignId: pendingParagraphId,
  }];

  if (runs.length === 0 || op.at.runIndex >= runs.length) {
    return steps;
  }

  for (let index = op.at.runIndex; index < runs.length; index += 1) {
    const run = runs[index];
    const runSource = primarySource(run);
    const runElement = requireSourceElement(model, runSource, "run");

    if (index === op.at.runIndex) {
      const splitRun = splitRunElement(runElement, op.at.charOffset);

      if (splitRun.beforeRun) {
        steps.push({
          kind: "xml.replaceNode",
          part,
          node: nodeRef(runSource),
          content: splitRun.beforeRun,
        });
      } else {
        steps.push({
          kind: "xml.removeNode",
          part,
          node: nodeRef(runSource),
        });
      }

      if (splitRun.afterRun) {
        steps.push({
          kind: "xml.insertNode",
          part,
          position: { kind: "append", parent: newParagraphRef },
          content: splitRun.afterRun,
        });
      }

      continue;
    }

    steps.push({
      kind: "xml.insertNode",
      part,
      position: { kind: "append", parent: newParagraphRef },
      content: serializeSourceElement(runElement),
    });
    steps.push({
      kind: "xml.removeNode",
      part,
      node: nodeRef(runSource),
    });
  }

  return steps;
}

// ---- mergeParagraphs --------------------------------------------------------

function compileMergeParagraphs(
  op: MergeParagraphsOp,
  model: SemanticModel,
): MutationStep[] {
  const first = resolveEntity(model, op.first, "paragraph");
  const second = resolveEntity(model, op.second, "paragraph");
  const firstSource = primarySource(first);
  const secondSource = primarySource(second);
  const part = partRef(firstSource);

  const steps: MutationStep[] = [];

  for (const run of model.runs(op.second)) {
    const runSource = primarySource(run);
    const runElement = requireSourceElement(model, runSource, "run");
    steps.push({
      kind: "xml.insertNode",
      part,
      position: { kind: "append", parent: nodeRef(firstSource) },
      content: serializeSourceElement(runElement),
    });
  }

  steps.push({
    kind: "xml.removeNode",
    part,
    node: nodeRef(secondSource),
  });

  return steps;
}

// ---- insertParagraph --------------------------------------------------------

function compileInsertParagraph(
  op: InsertParagraphOp,
  model: SemanticModel,
): MutationStep[] {
  const anchor = resolveEntity(model, op.relativeTo, "paragraph");
  const source = primarySource(anchor);
  const part = partRef(source);

  return [{
    kind: "xml.insertNode",
    part,
    position: { kind: op.position, node: nodeRef(source) },
    content: buildParagraphElement(op.styleId),
  }];
}

// ---- setParagraphStyle ------------------------------------------------------

function compileSetParagraphStyle(
  op: SetParagraphStyleOp,
  model: SemanticModel,
): MutationStep[] {
  const paragraph = resolveEntity(model, op.target, "paragraph");
  const source = primarySource(paragraph);
  const paragraphElement = requireSourceElement(model, source, "paragraph");
  const paragraphProperties = findDirectChildElement(paragraphElement, "pPr", "w");
  const part = partRef(source);

  if (!paragraphProperties) {
    if (!op.styleId) {
      return [];
    }

    return [{
      kind: "xml.insertNode",
      part,
      position: { kind: "prepend", parent: nodeRef(source) },
      content: buildParagraphPropertiesElement(op.styleId),
    }];
  }

  const styleElement = findDirectChildElement(paragraphProperties, "pStyle", "w");

  if (!op.styleId) {
    if (!styleElement) {
      return [];
    }

    const steps: MutationStep[] = [{
      kind: "xml.removeNode",
      part,
      node: nodeRefForNodeId(source.partUri, styleElement.id),
    }];

    const remainingChildren = paragraphProperties.children.filter(
      (child) => child.kind === "element" && child.id !== styleElement.id,
    );
    if (remainingChildren.length === 0) {
      steps.push({
        kind: "xml.removeNode",
        part,
        node: nodeRefForNodeId(source.partUri, paragraphProperties.id),
      });
    }

    return steps;
  }

  if (styleElement) {
    return [{
      kind: "xml.setAttribute",
      part,
      node: nodeRefForNodeId(source.partUri, styleElement.id),
      name: "val",
      namespace: WORDPROCESSINGML_NAMESPACE,
      prefix: "w",
      value: op.styleId,
    }];
  }

  return [{
    kind: "xml.insertNode",
    part,
    position: { kind: "append", parent: nodeRefForNodeId(source.partUri, paragraphProperties.id) },
    content: buildParagraphStyleElement(op.styleId),
  }];
}

// ---- toggleBold -------------------------------------------------------------

function compileToggleBold(
  op: ToggleBoldOp,
  model: SemanticModel,
): MutationStep[] {
  const run = resolveEntity(model, op.target, "run");
  const source = primarySource(run);
  const runElement = requireSourceElement(model, source, "run");
  const part = partRef(source);
  const runProperties = findDirectChildElement(runElement, "rPr", "w");
  const boldElement = runProperties
    ? findDirectChildElement(runProperties, "b", "w")
    : undefined;

  if (op.value) {
    if (!runProperties) {
      return [{
        kind: "xml.insertNode",
        part,
        position: { kind: "prepend", parent: nodeRef(source) },
        content: buildRunPropertiesElement(true),
      }];
    }

    if (!boldElement) {
      return [{
        kind: "xml.insertNode",
        part,
        position: { kind: "append", parent: nodeRefForNodeId(source.partUri, runProperties.id) },
        content: buildBoldElement(),
      }];
    }

    return [{
      kind: "xml.setAttribute",
      part,
      node: nodeRefForNodeId(source.partUri, boldElement.id),
      name: "val",
      namespace: WORDPROCESSINGML_NAMESPACE,
      prefix: "w",
      value: "1",
    }];
  }

  if (!boldElement) {
    return [];
  }

  return [{
    kind: "xml.removeNode",
    part,
    node: nodeRefForNodeId(source.partUri, boldElement.id),
  }];
}

// ---- Shared helpers ---------------------------------------------------------

function resolveEntity<K extends EntityKind>(
  model: SemanticModel,
  ref: EntityRef,
  expectedKind: K,
): Entity<K> {
  const entity = model.entity(ref);
  if (!entity) {
    throw new Error(`Entity not found: ${ref.id}`);
  }
  if (entity.kind !== expectedKind) {
    throw new Error(`Expected ${expectedKind} entity, got ${entity.kind}: ${ref.id}`);
  }
  return entity as Entity<K>;
}

function primarySource(entity: Entity): SourceRef {
  if (entity.sourceRefs.length === 0) {
    throw new Error(`Entity ${entity.ref.id} has no source refs`);
  }
  return entity.sourceRefs[0];
}

function partRef(source: SourceRef): PartRef {
  return { kind: "part", uri: source.partUri };
}

function nodeRef(source: SourceRef): NodeRef {
  return nodeRefForNodeId(source.partUri, source.nodeId);
}

function nodeRefForNodeId(partUri: string, nodeId: string): NodeRef {
  return {
    kind: "node",
    partUri,
    nodeId,
    stability: "source-anchored",
  };
}

function isTextSegment(
  segment: InlineSegment,
): segment is InlineSegment & { segmentKind: "text"; text: string; localId: string } {
  return segment.segmentKind === "text";
}

function resolveTargetTextSegment(
  textSegments: readonly (InlineSegment & { segmentKind: "text"; text: string; localId: string })[],
  position: InsertTextOp["position"],
) {
  const requestedIndex = position?.segmentIndex ?? (textSegments.length - 1);
  const boundedIndex = Math.max(0, Math.min(requestedIndex, textSegments.length - 1));
  return textSegments[boundedIndex];
}

function resolveTextElement(
  model: SemanticModel,
  partUri: string,
  elementNodeId: string,
): XmlElementNode {
  return requireSourceElement(
    model,
    createSourceRef(partUri, elementNodeId),
    "text segment element",
  );
}

function clampOffset(offset: number, maxLength: number): number {
  if (!Number.isFinite(offset)) {
    return maxLength;
  }
  return Math.max(0, Math.min(Math.trunc(offset), maxLength));
}

function needsPreserveWhitespace(text: string): boolean {
  return text.startsWith(" ") || text.endsWith(" ") || text.includes("  ");
}

function splitRunElement(
  runElement: XmlElementNode,
  charOffset: number,
): {
  beforeRun?: SerializedXmlElement;
  afterRun?: SerializedXmlElement;
} {
  const runProperties = findDirectChildElement(runElement, "rPr", "w");
  const beforeChildren: SerializedXmlNode[] = [];
  const afterChildren: SerializedXmlNode[] = [];
  let remainingOffset = Math.max(0, Math.trunc(charOffset));

  for (const child of runElement.children) {
    if (child.kind !== "element") {
      continue;
    }

    if (child.localName === "rPr" && child.prefix === "w") {
      continue;
    }

    if (isTextBearingRunChild(child)) {
      const textValue = getElementTextValue(child);
      const textLength = textValue.length;

      if (remainingOffset <= 0) {
        afterChildren.push(serializeSourceElement(child));
        continue;
      }

      if (remainingOffset >= textLength) {
        beforeChildren.push(serializeSourceElement(child));
        remainingOffset -= textLength;
        continue;
      }

      const beforeText = textValue.slice(0, remainingOffset);
      const afterText = textValue.slice(remainingOffset);
      remainingOffset = 0;

      if (beforeText.length > 0) {
        beforeChildren.push(cloneTextElementWithValue(child, beforeText));
      }
      if (afterText.length > 0) {
        afterChildren.push(cloneTextElementWithValue(child, afterText));
      }
      continue;
    }

    if (remainingOffset > 0) {
      beforeChildren.push(serializeSourceElement(child));
    } else {
      afterChildren.push(serializeSourceElement(child));
    }
  }

  return {
    ...(beforeChildren.length > 0
      ? { beforeRun: buildRunElementFromChildren(runElement, runProperties, beforeChildren) }
      : {}),
    ...(afterChildren.length > 0
      ? { afterRun: buildRunElementFromChildren(runElement, runProperties, afterChildren) }
      : {}),
  };
}

function buildRunElementFromChildren(
  runElement: XmlElementNode,
  runProperties: XmlElementNode | undefined,
  contentChildren: readonly SerializedXmlNode[],
): SerializedXmlElement {
  const children: SerializedXmlNode[] = [];

  if (runProperties) {
    children.push(serializeSourceElement(runProperties));
  }

  children.push(...contentChildren);

  return {
    kind: "element",
    name: runElement.localName,
    ...(runElement.namespaceUri ? { namespace: runElement.namespaceUri } : {}),
    ...(runElement.prefix ? { prefix: runElement.prefix } : {}),
    ...(runElement.attributes.length > 0
      ? {
          attributes: runElement.attributes.map((attribute) => ({
            name: attribute.localName,
            value: attribute.value,
            ...(attribute.namespaceUri ? { namespace: attribute.namespaceUri } : {}),
            ...(attribute.prefix ? { prefix: attribute.prefix } : {}),
          })),
        }
      : {}),
    children,
  };
}

function isTextBearingRunChild(element: XmlElementNode): boolean {
  return element.prefix === "w"
    && (
      element.localName === "t"
      || element.localName === "delText"
      || element.localName === "instrText"
    );
}

function getElementTextValue(element: XmlElementNode): string {
  return element.children
    .filter((child): child is XmlTextNode => child.kind === "text")
    .map((child) => child.value)
    .join("");
}

function buildTextElement(text: string): SerializedXmlElement {
  return {
    kind: "element",
    name: "t",
    prefix: "w",
    ...(needsPreserveWhitespace(text)
      ? {
          attributes: [{
            name: "space",
            value: "preserve",
            namespace: XML_SPACE_NAMESPACE,
            prefix: "xml",
          }],
        }
      : {}),
    children: [{ kind: "text", value: text }],
  };
}

function buildParagraphElement(styleId?: string): SerializedXmlElement {
  return {
    kind: "element",
    name: "p",
    prefix: "w",
    ...(styleId ? { children: [buildParagraphPropertiesElement(styleId)] } : {}),
  };
}

function buildParagraphPropertiesElement(styleId: string): SerializedXmlElement {
  return {
    kind: "element",
    name: "pPr",
    prefix: "w",
    children: [buildParagraphStyleElement(styleId)],
  };
}

function buildParagraphStyleElement(styleId: string): SerializedXmlElement {
  return {
    kind: "element",
    name: "pStyle",
    prefix: "w",
    attributes: [{
      name: "val",
      value: styleId,
      namespace: WORDPROCESSINGML_NAMESPACE,
      prefix: "w",
    }],
  };
}

function buildRunPropertiesElement(includeBold: boolean): SerializedXmlElement {
  return {
    kind: "element",
    name: "rPr",
    prefix: "w",
    ...(includeBold ? { children: [buildBoldElement()] } : {}),
  };
}

function buildBoldElement(): SerializedXmlElement {
  return {
    kind: "element",
    name: "b",
    prefix: "w",
  };
}
