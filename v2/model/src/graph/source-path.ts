// ---------------------------------------------------------------------------
// Source node path computation
//
// Builds xpath-like paths for XML elements to serve as stable join keys
// with the raw-surface analysis layer. Format: "w:body/w:p[3]/w:r[2]"
//
// Paths are:
// - rooted at the meaningful story or part container (`w:body`, `w:hdr`, ...)
// - indexed among same-name siblings only
// - deterministic for a given XML tree
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";

/**
 * Qualified element name used in xpath-like paths.
 */
export function qualifiedName(element: XmlElementNode): string {
  return element.prefix
    ? `${element.prefix}:${element.localName}`
    : element.localName;
}

/**
 * Compute a child path under a known parent element/path.
 *
 * Example:
 *   parentPath = "w:body"
 *   child = <w:p> second paragraph
 *   result = "w:body/w:p[2]"
 */
export function computeChildPath(
  parentElement: XmlElementNode,
  parentPath: string,
  childElement: XmlElementNode,
): string {
  return `${parentPath}/${computePathSegment(parentElement, childElement)}`;
}

/**
 * Compute a full path to `targetElement` by walking from a known root.
 *
 * Returns `undefined` if the target is not reachable from the root.
 */
export function computePathFromRoot(
  rootElement: XmlElementNode,
  rootPath: string,
  targetElement: XmlElementNode,
): string | undefined {
  if (rootElement === targetElement) {
    return rootPath;
  }

  return findPathInSubtree(rootElement, rootPath, targetElement);
}

function findPathInSubtree(
  currentElement: XmlElementNode,
  currentPath: string,
  targetElement: XmlElementNode,
): string | undefined {
  for (const child of currentElement.children) {
    if (child.kind !== "element") {
      continue;
    }

    const childPath = computeChildPath(currentElement, currentPath, child);
    if (child === targetElement) {
      return childPath;
    }

    const descendantPath = findPathInSubtree(child, childPath, targetElement);
    if (descendantPath !== undefined) {
      return descendantPath;
    }
  }

  return undefined;
}

function computePathSegment(
  parentElement: XmlElementNode,
  childElement: XmlElementNode,
): string {
  const siblingIndex = findSameNameSiblingIndex(parentElement, childElement);
  return `${qualifiedName(childElement)}[${siblingIndex}]`;
}

function findSameNameSiblingIndex(
  parentElement: XmlElementNode,
  targetElement: XmlElementNode,
): number {
  let siblingIndex = 0;

  for (const child of parentElement.children) {
    if (child.kind !== "element") {
      continue;
    }

    if (hasSameQualifiedName(child, targetElement)) {
      siblingIndex += 1;
    }

    if (child === targetElement) {
      return siblingIndex;
    }
  }

  return 1;
}

function hasSameQualifiedName(
  left: XmlElementNode,
  right: XmlElementNode,
): boolean {
  return left.localName === right.localName && left.prefix === right.prefix;
}
