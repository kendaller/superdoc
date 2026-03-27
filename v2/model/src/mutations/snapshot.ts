// ---------------------------------------------------------------------------
// Transaction snapshots — capture and restore pre-mutation state for rollback
//
// Before applying any steps, the engine snapshots affected parts.
// On failure, all prior steps are rolled back by restoring the snapshot.
// ---------------------------------------------------------------------------

import type { XmlPart } from "../types/package.js";
import type { XmlTreeState, XmlDocumentNode, XmlNode, XmlElementNode } from "../types/xml.js";
import { buildNodeIndex } from "./node-index.js";

/** Captured state of a single XML part before mutation. */
export type PartSnapshot = {
  uri: string;
  treeState: XmlTreeState;
  dirty: boolean;
};

/** Capture a restorable snapshot of an XML part's current state. */
export function capturePartSnapshot(part: XmlPart): PartSnapshot {
  return {
    uri: part.uri,
    treeState: cloneTreeState(part.treeState),
    dirty: part.dirty,
  };
}

/**
 * Restore an XML part to a previously captured snapshot.
 *
 * The NodeIndex is rebuilt from the restored tree rather than cloned,
 * because it must point at the restored tree's node objects — not
 * the (now-detached) pre-rollback objects.
 */
export function restorePartSnapshot(part: XmlPart, snapshot: PartSnapshot): void {
  part.treeState = snapshot.treeState;
  part.dirty = snapshot.dirty;

  // Rebuild index from the restored tree so byId entries reference
  // the correct (restored) node objects.
  if (part.treeState.kind === "fully-hydrated" || part.treeState.kind === "mutated") {
    part.nodeIndex = buildNodeIndex(part.treeState.tree);
  } else {
    part.nodeIndex = undefined;
  }
}

// ---- Internal helpers -----------------------------------------------------

function cloneTreeState(state: XmlTreeState): XmlTreeState {
  switch (state.kind) {
    case "indexed-only":
      return { kind: "indexed-only" };
    case "partially-hydrated":
      // Deep clone the regions map and each region's tree
      return {
        kind: "partially-hydrated",
        hydratedRegions: new Map(
          [...state.hydratedRegions].map(([id, region]) => [
            id,
            {
              ...region,
              tree: region.tree.map(cloneNode),
            },
          ]),
        ),
      };
    case "fully-hydrated":
      return { kind: "fully-hydrated", tree: cloneDocumentNode(state.tree) };
    case "mutated":
      return { kind: "mutated", tree: cloneDocumentNode(state.tree) };
  }
}

function cloneDocumentNode(doc: XmlDocumentNode): XmlDocumentNode {
  return {
    ...doc,
    declaration: doc.declaration ? { ...doc.declaration } : undefined,
    children: doc.children.map((child) => cloneNode(child) as typeof child),
  };
}

function cloneNode(node: XmlNode): XmlNode {
  switch (node.kind) {
    case "element":
      return cloneElement(node);
    case "text":
      return { ...node };
    case "cdata":
      return { ...node };
    case "comment":
      return { ...node };
    case "pi":
      return { ...node };
  }
}

function cloneElement(el: XmlElementNode): XmlElementNode {
  return {
    ...el,
    attributes: el.attributes.map((a) => ({ ...a })),
    namespaceDecls: el.namespaceDecls.map((d) => ({ ...d })),
    children: el.children.map(cloneNode),
  };
}
