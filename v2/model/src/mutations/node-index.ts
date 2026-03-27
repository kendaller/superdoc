// ---------------------------------------------------------------------------
// NodeIndex — O(1) lookup index for nodes in hydrated/mutated XML parts
//
// Built once on full hydration, updated incrementally by step appliers.
// Enables fast ref resolution without repeated tree walks.
// ---------------------------------------------------------------------------

import type { XmlDocumentNode, XmlNode, NodeIndex } from "../types/xml.js";

/** Build a fresh NodeIndex from a fully-hydrated document tree. */
export function buildNodeIndex(tree: XmlDocumentNode): NodeIndex {
  const index: NodeIndex = {
    byId: new Map(),
    parentOf: new Map(),
    childIndexOf: new Map(),
  };

  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    indexNodeRecursive(index, child, undefined, i);
  }

  return index;
}

/** Deep-clone a NodeIndex (for rollback snapshots). */
export function cloneNodeIndex(index: NodeIndex): NodeIndex {
  return {
    byId: new Map(index.byId),
    parentOf: new Map(index.parentOf),
    childIndexOf: new Map(index.childIndexOf),
  };
}

// ---- Incremental updates --------------------------------------------------

/** Add a node and all its descendants to the index. */
export function addSubtreeToIndex(
  index: NodeIndex,
  node: XmlNode,
  parentId: string | undefined,
  childIndex: number,
): void {
  indexNodeRecursive(index, node, parentId, childIndex);
}

/** Remove a node and all its descendants from the index. */
export function removeSubtreeFromIndex(index: NodeIndex, node: XmlNode): void {
  removeNodeRecursive(index, node);
}

/**
 * Recompute childIndexOf for all children of a parent starting at a given index.
 * Called after insertions/removals shift sibling positions.
 */
export function reindexChildren(
  index: NodeIndex,
  children: XmlNode[],
  startFrom: number,
): void {
  for (let i = startFrom; i < children.length; i++) {
    index.childIndexOf.set(children[i].id, i);
  }
}

// ---- Internal helpers -----------------------------------------------------

function indexNodeRecursive(
  index: NodeIndex,
  node: XmlNode,
  parentId: string | undefined,
  childIndex: number,
): void {
  index.byId.set(node.id, node);
  index.parentOf.set(node.id, parentId);
  index.childIndexOf.set(node.id, childIndex);

  if (node.kind === "element") {
    for (let i = 0; i < node.children.length; i++) {
      indexNodeRecursive(index, node.children[i], node.id, i);
    }
  }
}

function removeNodeRecursive(index: NodeIndex, node: XmlNode): void {
  index.byId.delete(node.id);
  index.parentOf.delete(node.id);
  index.childIndexOf.delete(node.id);

  if (node.kind === "element") {
    for (const child of node.children) {
      removeNodeRecursive(index, child);
    }
  }
}
