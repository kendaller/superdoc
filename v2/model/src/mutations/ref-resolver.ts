// ---------------------------------------------------------------------------
// Ref resolution — resolve serializable refs to concrete in-memory objects
//
// Handles pending refs (intra-transaction references to not-yet-existing nodes),
// triggers on-demand hydration, and validates ref validity.
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlPart } from "../types/package.js";
import type { XmlNode, XmlElementNode, XmlDocumentNode } from "../types/xml.js";
import type { PartRef, NodeRef, ChildPosition } from "./types.js";

const PENDING_PREFIX = "pending:";

// ---- Error type -----------------------------------------------------------

import type { MutationErrorKind } from "./types.js";

export class MutationError extends Error {
  constructor(
    public readonly errorKind: MutationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "MutationError";
  }
}

// ---- Ref resolution -------------------------------------------------------

/** Resolve a PartRef to a concrete XmlPart, or throw MutationError. */
export function resolvePartRef(
  session: PackageSession,
  ref: PartRef,
): XmlPart {
  const part = session.parts.get(ref.uri);
  if (!part) {
    throw new MutationError("ref-not-found", `Part not found: ${ref.uri}`);
  }
  if (part.kind !== "xml") {
    throw new MutationError("structural-violation", `Part is not XML: ${ref.uri}`);
  }
  return part;
}

/**
 * Resolve a NodeRef to a concrete XmlNode.
 * Handles pending refs by looking up the resolved ID in pendingRefs.
 * Validates that ref.partUri matches the part being resolved against.
 */
export function resolveNodeRef(
  part: XmlPart,
  ref: NodeRef,
  pendingRefs: Map<string, string>,
): XmlNode {
  // Enforce the serializable addressing contract: the ref's partUri
  // must match the part we're resolving against.
  if (ref.partUri !== part.uri) {
    throw new MutationError(
      "ref-not-found",
      `NodeRef targets part "${ref.partUri}" but was resolved against part "${part.uri}"`,
    );
  }

  const nodeId = resolvePendingId(ref.nodeId, pendingRefs);

  if (!part.nodeIndex) {
    throw new MutationError("internal-error", `No node index for part: ${part.uri}`);
  }

  const node = part.nodeIndex.byId.get(nodeId);
  if (!node) {
    throw new MutationError("ref-not-found", `Node not found: ${nodeId} in part ${part.uri}`);
  }
  return node;
}

/** Resolve a NodeRef to an XmlElementNode specifically. */
export function resolveElementRef(
  part: XmlPart,
  ref: NodeRef,
  pendingRefs: Map<string, string>,
): XmlElementNode {
  const node = resolveNodeRef(part, ref, pendingRefs);
  if (node.kind !== "element") {
    throw new MutationError(
      "structural-violation",
      `Expected element node, got ${node.kind}: ${ref.nodeId}`,
    );
  }
  return node;
}

// ---- Position resolution --------------------------------------------------

/** Resolved insertion position: a parent element and the index to insert at. */
export type ResolvedPosition = {
  parent: XmlElementNode;
  index: number;
};

/**
 * Resolve a ChildPosition to a concrete parent element and insertion index.
 * Throws MutationError for invalid or unresolvable positions.
 */
export function resolveChildPosition(
  part: XmlPart,
  _tree: XmlDocumentNode,
  position: ChildPosition,
  pendingRefs: Map<string, string>,
): ResolvedPosition {
  switch (position.kind) {
    case "before":
    case "after": {
      return resolveSiblingPosition(part, position, pendingRefs);
    }
    case "at-index": {
      const parent = resolveElementRef(part, position.parent, pendingRefs);
      if (position.index < 0 || position.index > parent.children.length) {
        throw new MutationError(
          "invalid-position",
          `Index ${position.index} out of range [0, ${parent.children.length}] in ${position.parent.nodeId}`,
        );
      }
      return { parent, index: position.index };
    }
    case "append": {
      const parent = resolveElementRef(part, position.parent, pendingRefs);
      return { parent, index: parent.children.length };
    }
    case "prepend": {
      const parent = resolveElementRef(part, position.parent, pendingRefs);
      return { parent, index: 0 };
    }
  }
}

// ---- Internal helpers -----------------------------------------------------

function resolveSiblingPosition(
  part: XmlPart,
  position: { kind: "before" | "after"; node: NodeRef },
  pendingRefs: Map<string, string>,
): ResolvedPosition {
  // Enforce the partUri contract on sibling refs too
  if (position.node.partUri !== part.uri) {
    throw new MutationError(
      "ref-not-found",
      `NodeRef targets part "${position.node.partUri}" but was resolved against part "${part.uri}"`,
    );
  }

  const siblingId = resolvePendingId(position.node.nodeId, pendingRefs);
  const nodeIndex = part.nodeIndex!;

  const parentId = nodeIndex.parentOf.get(siblingId);
  if (parentId === undefined) {
    // Top-level node — document-level insertion not supported in Phase 1
    throw new MutationError(
      "structural-violation",
      `Cannot insert ${position.kind} a top-level document child: ${siblingId}`,
    );
  }

  const parent = nodeIndex.byId.get(parentId);
  if (!parent || parent.kind !== "element") {
    throw new MutationError("internal-error", `Parent node is not an element: ${parentId}`);
  }

  const childIdx = nodeIndex.childIndexOf.get(siblingId);
  if (childIdx === undefined) {
    throw new MutationError("internal-error", `No child index for node: ${siblingId}`);
  }

  const insertIndex = position.kind === "before" ? childIdx : childIdx + 1;
  return { parent: parent as XmlElementNode, index: insertIndex };
}

function resolvePendingId(
  nodeId: string,
  pendingRefs: Map<string, string>,
): string {
  if (!nodeId.startsWith(PENDING_PREFIX)) return nodeId;

  const label = nodeId.slice(PENDING_PREFIX.length);
  const resolved = pendingRefs.get(label);
  if (resolved === undefined) {
    throw new MutationError(
      "ref-not-found",
      `Pending ref not yet created: ${nodeId}`,
    );
  }
  return resolved;
}
