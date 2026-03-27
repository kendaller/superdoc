// ---------------------------------------------------------------------------
// Base utilities for typed views
//
// Typed views are lazy, package-backed helpers. They do NOT replace the
// generic model — they provide typed access on top of it.
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlPart, PartUri, PackagePart } from "../types/package.js";
import type {
  HydratedRegionIndex,
  XmlDocumentNode,
  XmlElementNode,
  XmlLexicalIndex,
  XmlNode,
  XmlStructuralRecord,
} from "../types/xml.js";
import { indexPartOnDemand } from "../xml/index-integration.js";
import { hydrateDocument, hydrateRegion } from "../xml/hydrator.js";
import { resolvePartBytes } from "../session/part-bytes.js";
import { nextRevision } from "../session/revision.js";
import { getRootElement } from "./tree-helpers.js";

// Re-export tree helpers so existing import paths still work
export {
  getRootElement,
  findChildElements,
  findChildElement,
  getAttr,
  getTextContent,
} from "./tree-helpers.js";

// ---- Indexing & hydration -------------------------------------------------

/** Ensure an XML part is indexed. Returns the part (for chaining). */
export function ensureIndexed(
  part: XmlPart,
  session: PackageSession,
): XmlPart {
  if (!part.lexicalIndex) {
    indexPartOnDemand(part, session);
  }
  return part;
}

/** Ensure an XML part is fully hydrated. Returns the document tree. */
export function ensureHydrated(
  part: XmlPart,
  session: PackageSession,
): XmlDocumentNode {
  if (part.treeState.kind === "fully-hydrated" || part.treeState.kind === "mutated") {
    return part.treeState.tree;
  }

  // Save partially-hydrated regions before full hydration replaces them
  const previousRegions =
    part.treeState.kind === "partially-hydrated"
      ? part.treeState.hydratedRegions
      : undefined;

  const bytes = resolvePartBytes(part, session);
  const declaration = part.lexicalIndex?.declaration;
  const tree = hydrateDocument(bytes, part.uri, declaration);

  // Graft previously-hydrated (possibly mutated) region nodes into the new tree
  if (previousRegions) {
    graftRegionsIntoTree(tree, previousRegions, part);
  }

  part.treeState = { kind: "fully-hydrated", tree };
  part.originalBytes = bytes;

  return tree;
}

/**
 * Get boundary structural records from the lexical index.
 * Returns an ordered list of boundary elements — no hydration needed.
 */
export function getBoundaryRecords(
  part: XmlPart,
  session: PackageSession,
): XmlStructuralRecord[] {
  ensureIndexed(part, session);
  if (!part.lexicalIndex) return [];

  return part.lexicalIndex.indexedNodeIds
    .map((id) => part.lexicalIndex!.recordsById.get(id)!)
    .filter((r) => r.role === "boundary");
}

/**
 * Hydrate a single boundary region of an XML part.
 * Returns the top-level element from that region, or undefined.
 * Stores the hydrated region in the part's tree state for reuse.
 */
export function hydratePartRegion(
  part: XmlPart,
  session: PackageSession,
  regionId: string,
): XmlElementNode | undefined {
  // If already fully hydrated or mutated, find the element by its span in the full tree
  if (part.treeState.kind === "fully-hydrated" || part.treeState.kind === "mutated") {
    return findElementByRegionId(part, regionId);
  }

  // Check if this region was already hydrated
  if (part.treeState.kind === "partially-hydrated") {
    const existing = part.treeState.hydratedRegions.get(regionId);
    if (existing) {
      return existing.tree.find((n): n is XmlElementNode => n.kind === "element");
    }
  }

  // Hydrate just this region
  const index = part.lexicalIndex;
  if (!index) return undefined;

  const region = index.regions.find((r) => r.id === regionId);
  if (!region) return undefined;

  const bytes = resolvePartBytes(part, session);
  const rootOpenTag = extractRootOpenTag(bytes, index);
  const hydrated = hydrateRegion(bytes, part.uri, regionId, region.span, undefined, rootOpenTag);

  // Update tree state to partially-hydrated
  if (part.treeState.kind === "indexed-only") {
    part.treeState = {
      kind: "partially-hydrated",
      hydratedRegions: new Map([[regionId, hydrated]]),
    };
  } else if (part.treeState.kind === "partially-hydrated") {
    part.treeState.hydratedRegions.set(regionId, hydrated);
  }

  return hydrated.tree.find((n): n is XmlElementNode => n.kind === "element");
}

// ---- Mutation support -----------------------------------------------------

/**
 * Mark a part as dirty and advance the session revision.
 *
 * For partially-hydrated parts, also marks all hydrated regions dirty
 * so that splice-save will serialize them. This is the safe default —
 * callers who want finer control can use markRegionDirty() instead.
 */
export function markPartDirty(
  part: PackagePart,
  session: PackageSession,
): void {
  part.dirty = true;
  if (part.kind === "xml" && part.treeState.kind === "partially-hydrated") {
    for (const region of part.treeState.hydratedRegions.values()) {
      region.dirty = true;
    }
  }
  session.currentRevision = nextRevision();
}

/**
 * Mark a specific hydrated region as dirty.
 * Also sets the part-level dirty flag so save knows something changed.
 */
export function markRegionDirty(
  part: XmlPart,
  session: PackageSession,
  regionId: string,
): void {
  if (part.treeState.kind === "partially-hydrated") {
    const region = part.treeState.hydratedRegions.get(regionId);
    if (region) {
      region.dirty = true;
    }
  }
  part.dirty = true;
  session.currentRevision = nextRevision();
}

// ---- Part access ----------------------------------------------------------

/** Get an XML part by URI, or undefined if not found/not XML. */
export function getXmlPart(
  session: PackageSession,
  uri: PartUri,
): XmlPart | undefined {
  const part = session.parts.get(uri);
  if (!part || part.kind !== "xml") return undefined;
  return part;
}

/**
 * Convenience: hydrate a part and return its root element.
 * Eliminates the repeated `ensureHydrated(part, session) + getRootElement` pattern.
 */
export function getPartRoot(
  part: XmlPart,
  session: PackageSession,
): XmlElementNode | undefined {
  const tree = ensureHydrated(part, session);
  return getRootElement(tree);
}

// ---- Internal helpers -----------------------------------------------------

/**
 * Extract the root element's opening tag bytes (including namespace declarations).
 * Used as the wrapper for region hydration so prefixes are in scope.
 */
function extractRootOpenTag(
  bytes: Uint8Array,
  index: XmlLexicalIndex,
): Uint8Array | undefined {
  if (!index.rootElementId) return undefined;
  const rootRecord = index.recordsById.get(index.rootElementId);
  if (!rootRecord) return undefined;

  const start = rootRecord.fullSpan.startByte;
  // Scan forward from the root element's start to find the first `>`
  let end = start;
  while (end < bytes.length && bytes[end] !== 0x3e /* > */) {
    end++;
  }
  end++; // include the `>`
  return bytes.slice(start, end);
}

/**
 * Replace elements in the full tree with their previously-hydrated versions.
 * This preserves any in-memory mutations made to partially-hydrated regions
 * when transitioning to a fully-hydrated tree.
 */
function graftRegionsIntoTree(
  tree: XmlDocumentNode,
  regions: HydratedRegionIndex,
  part: XmlPart,
): void {
  const index = part.lexicalIndex;
  if (!index) return;

  for (const [regionId, region] of regions) {
    // Find the matching region definition to get the anchor span
    const regionDef = index.regions.find((r) => r.id === regionId);
    if (!regionDef?.anchorNodeId) continue;

    const record = index.recordsById.get(regionDef.anchorNodeId);
    if (!record) continue;

    // Find the element from the region's hydrated tree
    const regionElement = region.tree.find(
      (n): n is XmlElementNode => n.kind === "element",
    );
    if (!regionElement) continue;

    // Find and replace the matching element in the full tree by span
    replaceElementBySpan(
      tree.children,
      record.fullSpan.startByte,
      record.fullSpan.endByte,
      regionElement,
    );
  }
}

/**
 * Walk the tree to find an element matching the given span and replace it
 * with the provided replacement node.
 */
function replaceElementBySpan(
  nodes: XmlNode[],
  startByte: number,
  endByte: number,
  replacement: XmlElementNode,
): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (
      node.kind === "element" &&
      node.sourceSpan?.startByte === startByte &&
      node.sourceSpan?.endByte === endByte
    ) {
      nodes[i] = replacement;
      return true;
    }
    if (node.kind === "element") {
      if (replaceElementBySpan(node.children, startByte, endByte, replacement)) {
        return true;
      }
    }
  }
  return false;
}

function findElementByRegionId(
  part: XmlPart,
  regionId: string,
): XmlElementNode | undefined {
  if (part.treeState.kind !== "fully-hydrated" && part.treeState.kind !== "mutated") return undefined;
  const index = part.lexicalIndex;
  if (!index) return undefined;

  const region = index.regions.find((r) => r.id === regionId);
  if (!region?.anchorNodeId) return undefined;

  const record = index.recordsById.get(region.anchorNodeId);
  if (!record) return undefined;

  // Search the full tree for an element matching the record's span
  return findElementBySpan(
    part.treeState.tree.children,
    record.fullSpan.startByte,
    record.fullSpan.endByte,
  );
}

function findElementBySpan(
  nodes: XmlNode[],
  startByte: number,
  endByte: number,
): XmlElementNode | undefined {
  for (const node of nodes) {
    if (
      node.kind === "element" &&
      node.sourceSpan?.startByte === startByte &&
      node.sourceSpan?.endByte === endByte
    ) {
      return node;
    }
    if (node.kind === "element") {
      const found = findElementBySpan(node.children, startByte, endByte);
      if (found) return found;
    }
  }
  return undefined;
}
