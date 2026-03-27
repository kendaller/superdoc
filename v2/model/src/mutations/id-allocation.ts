// ---------------------------------------------------------------------------
// Deterministic ID allocation
//
// Scans existing session state to allocate collision-free IDs for
// relationships, annotations, paragraphs, and media files. All functions
// are pure scans — no randomness, no UUIDs — making them deterministic
// given the same session state.
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlElementNode } from "../types/xml.js";
import { ensureHydrated } from "../word/view-base.js";
import { getRootElement } from "../word/tree-helpers.js";

// ---- Relationship IDs -----------------------------------------------------

/**
 * Allocate the next relationship ID for a relationship owner.
 *
 * Scans existing relationships for the owner, finds the max numeric suffix
 * among `rId{N}` keys, and returns `rId{max+1}`.
 */
export function allocateRelationshipId(
  session: PackageSession,
  ownerUri: string,
): string {
  const existingRels =
    ownerUri === "/"
      ? session.relationships.packageRelationships
      : session.relationships.partRelationships.get(ownerUri);

  let maxN = 0;

  if (existingRels) {
    for (const id of existingRels.keys()) {
      const n = parseRIdNumeric(id);
      if (n > maxN) maxN = n;
    }
  }

  return `rId${maxN + 1}`;
}

/** Extract the numeric suffix from an rId string (e.g. "rId7" -> 7). */
function parseRIdNumeric(id: string): number {
  const match = /^rId(\d+)$/.exec(id);
  return match ? parseInt(match[1], 10) : 0;
}

// ---- Annotation IDs -------------------------------------------------------

/**
 * Allocate the next annotation ID (comment, footnote, endnote).
 *
 * Hydrates the annotation part, scans all elements matching
 * `elementLocalName` for `w:id` attributes, and returns `max + 1`.
 */
export function allocateAnnotationId(
  session: PackageSession,
  partUri: string,
  elementLocalName: string,
): string {
  const part = session.parts.get(partUri);
  if (!part || part.kind !== "xml") return "0";

  const tree = ensureHydrated(part, session);
  const root = getRootElement(tree);
  if (!root) return "0";

  let maxId = -1;

  walkElements(root, (el) => {
    if (el.localName === elementLocalName) {
      const idAttr = el.attributes.find(
        (a) => a.localName === "id" && (a.prefix === "w" || a.prefix === undefined),
      );
      if (idAttr) {
        const n = parseInt(idAttr.value, 10);
        if (!isNaN(n) && n > maxId) maxId = n;
      }
    }
  });

  return String(maxId + 1);
}

// ---- Paragraph IDs --------------------------------------------------------

/**
 * Allocate the next paragraph ID (8-char uppercase hex, collision-free).
 *
 * Scans all paragraphs in the main document part for `w14:paraId` attributes,
 * collects existing values, and returns the next hex value that avoids collisions.
 */
export function allocateParagraphId(session: PackageSession): string {
  const existing = collectExistingParaIds(session);

  // Start from max+1 (or 0 if none exist)
  let candidate = 0;
  for (const hex of existing) {
    const n = parseInt(hex, 16);
    if (!isNaN(n) && n >= candidate) candidate = n + 1;
  }

  // Find next value that doesn't collide (should be immediate in most cases)
  while (existing.has(toParaIdHex(candidate))) {
    candidate++;
  }

  return toParaIdHex(candidate);
}

/** Format a number as an 8-char uppercase hex string. */
function toParaIdHex(n: number): string {
  return n.toString(16).toUpperCase().padStart(8, "0");
}

/** Collect all existing w14:paraId values from the main document part. */
function collectExistingParaIds(session: PackageSession): Set<string> {
  const ids = new Set<string>();

  const part = session.parts.get(session.mainDocumentUri);
  if (!part || part.kind !== "xml") return ids;

  const tree = ensureHydrated(part, session);
  const root = getRootElement(tree);
  if (!root) return ids;

  walkElements(root, (el) => {
    const paraId = el.attributes.find(
      (a) => a.localName === "paraId" && a.prefix === "w14",
    );
    if (paraId) {
      ids.add(paraId.value.toUpperCase());
    }
  });

  return ids;
}

// ---- Media filenames ------------------------------------------------------

/**
 * Allocate the next media filename (e.g. `image3.png`).
 *
 * Scans `session.parts` for URIs matching `word/media/image{N}.{ext}`,
 * finds the max N, and returns `image{N+1}.{extension}`.
 */
export function allocateMediaFilename(
  session: PackageSession,
  extension: string,
): string {
  let maxN = 0;

  for (const uri of session.parts.keys()) {
    const match = /\/word\/media\/image(\d+)\.\w+$/.exec(uri);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxN) maxN = n;
    }
  }

  return `image${maxN + 1}.${extension}`;
}

// ---- Tree walking ---------------------------------------------------------

/** Walk all element nodes in a subtree, calling `fn` for each. */
function walkElements(
  node: XmlElementNode,
  fn: (el: XmlElementNode) => void,
): void {
  fn(node);
  for (const child of node.children) {
    if (child.kind === "element") {
      walkElements(child, fn);
    }
  }
}
