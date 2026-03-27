// ---------------------------------------------------------------------------
// XML step appliers — apply individual XML mutation steps to the tree
//
// Each applier modifies the tree in place, updates the NodeIndex, and
// returns a StepEffect describing what changed. Validation errors throw
// MutationError, which the engine catches for rollback.
// ---------------------------------------------------------------------------

import type { XmlPart } from "../types/package.js";
import type { XmlDocumentNode, XmlElementNode } from "../types/xml.js";
import type {
  XmlMutationStep,
  StepEffect,
  XmlInsertNodeStep,
  XmlRemoveNodeStep,
  XmlReplaceNodeStep,
  XmlSetTextStep,
  XmlSetAttributeStep,
  XmlRemoveAttributeStep,
} from "./types.js";
import type { PackageSession } from "../types/session.js";
import { materializeNode, collectNodeIds } from "./materialize.js";
import {
  resolvePartRef,
  resolveNodeRef,
  resolveElementRef,
  resolveChildPosition,
  MutationError,
} from "./ref-resolver.js";
import {
  addSubtreeToIndex,
  removeSubtreeFromIndex,
  reindexChildren,
} from "./node-index.js";
import { ensureHydratedWithIndex } from "./engine-hydration.js";

/** Context passed to step appliers. */
export type StepContext = {
  session: PackageSession;
  pendingRefs: Map<string, string>;
  nextNodeId: () => string;
};

/**
 * Apply a single XML mutation step.
 * Returns a StepEffect and optionally the created node ID (for assignId).
 */
export function applyStep(
  step: XmlMutationStep,
  ctx: StepContext,
): { effect: StepEffect; createdNodeId?: string } {
  switch (step.kind) {
    case "xml.insertNode":
      return applyInsertNode(step, ctx);
    case "xml.removeNode":
      return applyRemoveNode(step, ctx);
    case "xml.replaceNode":
      return applyReplaceNode(step, ctx);
    case "xml.setText":
      return applySetText(step, ctx);
    case "xml.setAttribute":
      return applySetAttribute(step, ctx);
    case "xml.removeAttribute":
      return applyRemoveAttribute(step, ctx);
  }
}

// ---- Individual step appliers ---------------------------------------------

function applyInsertNode(
  step: XmlInsertNodeStep,
  ctx: StepContext,
): { effect: StepEffect; createdNodeId?: string } {
  const part = resolveAndHydrate(step.part.uri, ctx);
  const tree = getPartTree(part);
  const { parent, index } = resolveChildPosition(part, tree, step.position, ctx.pendingRefs);

  const newNode = materializeNode(step.content, ctx.nextNodeId);
  parent.children.splice(index, 0, newNode);

  const nodeIndex = part.nodeIndex!;
  addSubtreeToIndex(nodeIndex, newNode, parent.id, index);
  reindexChildren(nodeIndex, parent.children, index + 1);

  return {
    effect: {
      touchedPartUris: [part.uri],
      createdNodeIds: collectNodeIds(newNode),
      removedNodeIds: [],
      packageMetadataChanged: false,
    },
    createdNodeId: newNode.id,
  };
}

function applyRemoveNode(
  step: XmlRemoveNodeStep,
  ctx: StepContext,
): { effect: StepEffect } {
  const part = resolveAndHydrate(step.part.uri, ctx);
  const node = resolveNodeRef(part, step.node, ctx.pendingRefs);
  const nodeIndex = part.nodeIndex!;

  const parentId = nodeIndex.parentOf.get(node.id);
  if (parentId === undefined) {
    throw new MutationError(
      "structural-violation",
      `Cannot remove a top-level document child: ${node.id}`,
    );
  }

  const parent = nodeIndex.byId.get(parentId);
  if (!parent || parent.kind !== "element") {
    throw new MutationError("internal-error", `Parent is not an element: ${parentId}`);
  }

  const childIdx = nodeIndex.childIndexOf.get(node.id);
  if (childIdx === undefined) {
    throw new MutationError("internal-error", `No child index for: ${node.id}`);
  }

  const removedIds = collectNodeIds(node);
  (parent as XmlElementNode).children.splice(childIdx, 1);

  removeSubtreeFromIndex(nodeIndex, node);
  reindexChildren(nodeIndex, (parent as XmlElementNode).children, childIdx);

  return {
    effect: {
      touchedPartUris: [part.uri],
      createdNodeIds: [],
      removedNodeIds: removedIds,
      packageMetadataChanged: false,
    },
  };
}

function applyReplaceNode(
  step: XmlReplaceNodeStep,
  ctx: StepContext,
): { effect: StepEffect; createdNodeId?: string } {
  const part = resolveAndHydrate(step.part.uri, ctx);
  const oldNode = resolveNodeRef(part, step.node, ctx.pendingRefs);
  const nodeIndex = part.nodeIndex!;

  const parentId = nodeIndex.parentOf.get(oldNode.id);
  if (parentId === undefined) {
    throw new MutationError(
      "structural-violation",
      `Cannot replace a top-level document child: ${oldNode.id}`,
    );
  }

  const parent = nodeIndex.byId.get(parentId);
  if (!parent || parent.kind !== "element") {
    throw new MutationError("internal-error", `Parent is not an element: ${parentId}`);
  }

  const childIdx = nodeIndex.childIndexOf.get(oldNode.id);
  if (childIdx === undefined) {
    throw new MutationError("internal-error", `No child index for: ${oldNode.id}`);
  }

  const removedIds = collectNodeIds(oldNode);
  const newNode = materializeNode(step.content, ctx.nextNodeId);

  (parent as XmlElementNode).children[childIdx] = newNode;

  removeSubtreeFromIndex(nodeIndex, oldNode);
  addSubtreeToIndex(nodeIndex, newNode, parentId, childIdx);

  return {
    effect: {
      touchedPartUris: [part.uri],
      createdNodeIds: collectNodeIds(newNode),
      removedNodeIds: removedIds,
      packageMetadataChanged: false,
    },
    createdNodeId: newNode.id,
  };
}

function applySetText(
  step: XmlSetTextStep,
  ctx: StepContext,
): { effect: StepEffect } {
  const part = resolveAndHydrate(step.part.uri, ctx);
  const node = resolveNodeRef(part, step.node, ctx.pendingRefs);

  if (node.kind !== "text") {
    throw new MutationError(
      "structural-violation",
      `Expected text node for setText, got ${node.kind}: ${step.node.nodeId}`,
    );
  }

  node.value = step.value;

  return {
    effect: {
      touchedPartUris: [part.uri],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: false,
    },
  };
}

function applySetAttribute(
  step: XmlSetAttributeStep,
  ctx: StepContext,
): { effect: StepEffect } {
  const part = resolveAndHydrate(step.part.uri, ctx);
  const element = resolveElementRef(part, step.node, ctx.pendingRefs);

  const existing = findAttribute(element, step.name, step.namespace);
  if (existing) {
    existing.value = step.value;
    // Update prefix if explicitly provided (allows correcting/setting prefix)
    if (step.prefix !== undefined) {
      existing.prefix = step.prefix;
    }
  } else {
    element.attributes.push({
      id: ctx.nextNodeId(),
      prefix: step.prefix,
      localName: step.name,
      namespaceUri: step.namespace,
      value: step.value,
    });
  }

  // Ensure the element has a matching xmlns declaration for the prefix.
  // Without this, the serializer emits foo:attr="val" with no xmlns:foo,
  // which is not well-formed namespace usage.
  if (step.prefix && step.namespace) {
    ensureNamespaceDecl(element, step.prefix, step.namespace, ctx.nextNodeId);
  }

  return {
    effect: {
      touchedPartUris: [part.uri],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: false,
    },
  };
}

function applyRemoveAttribute(
  step: XmlRemoveAttributeStep,
  ctx: StepContext,
): { effect: StepEffect } {
  const part = resolveAndHydrate(step.part.uri, ctx);
  const element = resolveElementRef(part, step.node, ctx.pendingRefs);

  const idx = element.attributes.findIndex(
    (a) => a.localName === step.name && (a.namespaceUri ?? undefined) === (step.namespace ?? undefined),
  );
  if (idx === -1) {
    throw new MutationError(
      "ref-not-found",
      `Attribute "${step.name}" not found on element ${step.node.nodeId}`,
    );
  }
  element.attributes.splice(idx, 1);

  return {
    effect: {
      touchedPartUris: [part.uri],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: false,
    },
  };
}

// ---- Shared helpers -------------------------------------------------------

/** Resolve a part URI and ensure it's hydrated with a NodeIndex. */
function resolveAndHydrate(partUri: string, ctx: StepContext): XmlPart {
  const part = resolvePartRef(ctx.session, { kind: "part", uri: partUri });
  ensureHydratedWithIndex(part, ctx.session);
  return part;
}

/** Get the tree from a fully-hydrated or mutated part. */
function getPartTree(part: XmlPart): XmlDocumentNode {
  if (part.treeState.kind === "fully-hydrated" || part.treeState.kind === "mutated") {
    return part.treeState.tree;
  }
  throw new MutationError(
    "hydration-failure",
    `Part ${part.uri} is not hydrated (state: ${part.treeState.kind})`,
  );
}

function findAttribute(
  element: XmlElementNode,
  name: string,
  namespace?: string,
) {
  return element.attributes.find(
    (a) => a.localName === name && (a.namespaceUri ?? undefined) === (namespace ?? undefined),
  );
}

/**
 * Ensure an element has a namespace declaration for the given prefix + URI.
 * If a matching declaration already exists, this is a no-op.
 */
function ensureNamespaceDecl(
  element: XmlElementNode,
  prefix: string,
  uri: string,
  nextId: () => string,
): void {
  const exists = element.namespaceDecls.some(
    (d) => d.prefix === prefix && d.uri === uri,
  );
  if (!exists) {
    element.namespaceDecls.push({ id: nextId(), prefix, uri });
  }
}
