// ---------------------------------------------------------------------------
// Render-shell feeder — implements ProjectionFeeder over raw XML nodes
//
// Walks the hydrated XML tree from BodyChildDescriptors and uses the same
// property extractors that the semantic model uses internally. This lets the
// windowed projection path reuse the shared projector cores without
// requiring a full entity graph.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from '../../types/xml.js';
import type { DrawingRawProperties } from '../../entities/types.js';
import type { ProjectionFeeder, FeederNode, FeederNodeKind, RawPropertiesForFeederKind } from './feeder.js';
import type { SourceAnchor } from './source-anchor.js';
import type { FieldRegionMap } from './paragraph-classifier.js';
import { elementToSourceAnchor } from './source-anchor.js';
import { extractParagraphProperties } from '../../extract/paragraph.js';
import { extractRunProperties } from '../../extract/run.js';
import { extractTableProperties, extractTableRowProperties, extractTableCellProperties } from '../../extract/table.js';
import { extractSectionProperties } from '../../extract/section.js';
import { extractDrawingProperties } from '../../extract/drawing.js';
import { computeChildPath, computePathFromRoot } from '../../graph/source-path.js';
import { findChildElement, findChildElements } from '../../word/tree-helpers.js';

// ---- Element stash ----------------------------------------------------------

/**
 * Closure-scoped map from FeederNode to its backing XmlElementNode.
 * This avoids polluting the public FeederNode type while allowing the
 * feeder's traversal methods to access the raw XML tree.
 */
const elementMap = new WeakMap<FeederNode, XmlElementNode>();
const anchorMap = new WeakMap<XmlElementNode, SourceAnchor>();

function stashElement(node: FeederNode, element: XmlElementNode): void {
  elementMap.set(node, element);
}

function stashAnchor(element: XmlElementNode, anchor: SourceAnchor): void {
  anchorMap.set(element, anchor);
}

function getElement(node: FeederNode): XmlElementNode {
  const element = elementMap.get(node);
  if (!element) {
    throw new Error('FeederNode has no stashed XmlElementNode');
  }

  return element;
}

// ---- Field region stash -----------------------------------------------------

/**
 * Side-channel for attaching a FieldRegionMap to a paragraph FeederNode.
 * The classifier runs in window-project.ts before calling the feeder's
 * paragraphRuns(), and the feeder uses the stashed map to skip instruction
 * runs. This keeps the ProjectionFeeder interface unchanged.
 */
const fieldRegionsMap = new WeakMap<FeederNode, FieldRegionMap>();

/** Attach a field-region classification to a paragraph FeederNode. */
export function stashFieldRegions(node: FeederNode<'paragraph'>, regions: FieldRegionMap): void {
  fieldRegionsMap.set(node, regions);
}

/** Retrieve a previously stashed field-region classification. */
export function getStashedFieldRegions(node: FeederNode<'paragraph'>): FieldRegionMap | undefined {
  return fieldRegionsMap.get(node);
}

// ---- Node factory -----------------------------------------------------------

function makeNode<K extends FeederNodeKind>(
  kind: K,
  element: XmlElementNode,
  partUri: string,
  extractor: (el: XmlElementNode) => RawPropertiesForFeederKind[K],
  sourceAnchor?: SourceAnchor,
): FeederNode<K> {
  let cached: RawPropertiesForFeederKind[K] | undefined;
  const anchor = sourceAnchor ?? getOrCreateSourceAnchor(element, partUri);
  const node: FeederNode<K> = {
    kind,
    sourceAnchor: anchor,
    raw() {
      if (!cached) {
        cached = extractor(element);
      }
      return cached;
    },
  };

  stashElement(node as FeederNode, element);
  stashAnchor(element, anchor);
  return node;
}

function getOrCreateSourceAnchor(element: XmlElementNode, partUri: string): SourceAnchor {
  const existingAnchor = anchorMap.get(element);
  if (existingAnchor) {
    return existingAnchor;
  }

  const anchor = elementToSourceAnchor(element, partUri);
  stashAnchor(element, anchor);
  return anchor;
}

// ---- Public factory ---------------------------------------------------------

/**
 * Create a ProjectionFeeder that operates over raw XML element nodes.
 *
 * This is used by the windowed projection path to project body children
 * from the render-shell surface without building a semantic entity graph.
 *
 * @param partUri - The package part URI (e.g., "/word/document.xml").
 * @param resolveRelTarget - Optional relationship resolver for image/hyperlink
 *   resolution. Maps (partUri, relationshipId) → target URI.
 */
export function createRenderShellFeeder(
  partUri: string,
  resolveRelTarget?: (sourcePartUri: string, relId: string) => string | undefined,
): ProjectionFeeder {
  return {
    paragraphRuns(node: FeederNode<'paragraph'>): FeederNode<'run'>[] {
      const element = getElement(node);
      const fieldRegions = getStashedFieldRegions(node);
      const runs: FeederNode<'run'>[] = [];
      collectRunsFromElement(element, runs, partUri, node.sourceAnchor.sourceNodePath, fieldRegions?.instructionRunIds);
      return runs;
    },

    tableRows(node: FeederNode<'table'>): FeederNode<'tableRow'>[] {
      const element = getElement(node);
      return findChildElements(element, 'tr', 'w').map((rowElement) =>
        makeNode(
          'tableRow',
          rowElement,
          partUri,
          extractTableRowProperties,
          deriveChildAnchor(element, node.sourceAnchor.sourceNodePath, rowElement, partUri),
        ),
      );
    },

    tableCells(node: FeederNode<'tableRow'>): FeederNode<'tableCell'>[] {
      const element = getElement(node);
      return findChildElements(element, 'tc', 'w').map((cellElement) =>
        makeNode(
          'tableCell',
          cellElement,
          partUri,
          extractTableCellProperties,
          deriveChildAnchor(element, node.sourceAnchor.sourceNodePath, cellElement, partUri),
        ),
      );
    },

    cellContent(node: FeederNode<'tableCell'>): FeederNode<'paragraph' | 'table'>[] {
      const element = getElement(node);
      return collectBlockContent(element, partUri, node.sourceAnchor.sourceNodePath);
    },

    resolveDrawing(
      runNode: FeederNode<'run'>,
      drawingLocalId: string,
    ): { raw: DrawingRawProperties; imageSrc: string | undefined } | undefined {
      const runElement = getElement(runNode);

      for (const child of runElement.children) {
        if (child.kind !== 'element') {
          continue;
        }

        if (child.localName === 'drawing' && child.prefix === 'mc') {
          const choice = findChildElement(child, 'Choice', 'mc');
          if (choice) {
            for (const inner of choice.children) {
              if (
                inner.kind === 'element' &&
                inner.localName === 'drawing' &&
                inner.prefix === 'w' &&
                inner.id === drawingLocalId
              ) {
                return resolveDrawingElement(inner, partUri, resolveRelTarget);
              }
            }
          }
        }

        if (child.localName === 'drawing' && child.prefix === 'w' && child.id === drawingLocalId) {
          return resolveDrawingElement(child, partUri, resolveRelTarget);
        }
      }

      return undefined;
    },
  };
}

// ---- Helpers ----------------------------------------------------------------

function resolveDrawingElement(
  element: XmlElementNode,
  partUri: string,
  resolveRelTarget?: (sourcePartUri: string, relId: string) => string | undefined,
): { raw: DrawingRawProperties; imageSrc: string | undefined } {
  const raw = extractDrawingProperties(element);
  let imageSrc: string | undefined;

  if (raw.blipRelId && resolveRelTarget) {
    imageSrc = resolveRelTarget(partUri, raw.blipRelId);
  }

  return { raw, imageSrc };
}

/**
 * Collect block-level content nodes (paragraphs, tables) from a container
 * element. Content controls (w:sdt) are transparently unwrapped.
 */
function collectBlockContent(
  container: XmlElementNode,
  partUri: string,
  containerPath?: string,
): FeederNode<'paragraph' | 'table'>[] {
  const content: FeederNode<'paragraph' | 'table'>[] = [];

  for (const child of container.children) {
    if (child.kind !== 'element') {
      continue;
    }

    if (child.localName === 'p' && child.prefix === 'w') {
      content.push(
        makeNode(
          'paragraph',
          child,
          partUri,
          extractParagraphProperties,
          deriveChildAnchor(container, containerPath, child, partUri),
        ),
      );
      continue;
    }

    if (child.localName === 'tbl' && child.prefix === 'w') {
      content.push(
        makeNode(
          'table',
          child,
          partUri,
          extractTableProperties,
          deriveChildAnchor(container, containerPath, child, partUri),
        ),
      );
      continue;
    }

    if (child.localName === 'sdt' && child.prefix === 'w') {
      const sdtContent = findChildElement(child, 'sdtContent', 'w');
      if (!sdtContent) {
        continue;
      }

      const sdtContentPath = deriveDescendantPath(container, containerPath, sdtContent);

      for (const innerChild of sdtContent.children) {
        if (innerChild.kind !== 'element') {
          continue;
        }

        if (innerChild.localName === 'p' && innerChild.prefix === 'w') {
          content.push(
            makeNode(
              'paragraph',
              innerChild,
              partUri,
              extractParagraphProperties,
              deriveChildAnchor(sdtContent, sdtContentPath, innerChild, partUri),
            ),
          );
        } else if (innerChild.localName === 'tbl' && innerChild.prefix === 'w') {
          content.push(
            makeNode(
              'table',
              innerChild,
              partUri,
              extractTableProperties,
              deriveChildAnchor(sdtContent, sdtContentPath, innerChild, partUri),
            ),
          );
        }
      }
    }
  }

  return content;
}

/**
 * Recursively collect run nodes from a paragraph-like element.
 *
 * Descends into transparent wrappers: hyperlinks, content controls,
 * and tracked change wrappers (w:ins, w:del, w:moveTo, w:moveFrom).
 */
function collectRunsFromElement(
  element: XmlElementNode,
  result: FeederNode<'run'>[],
  partUri: string,
  elementPath?: string,
  skipRunIds?: ReadonlySet<string>,
): void {
  for (const child of element.children) {
    if (child.kind !== 'element') {
      continue;
    }

    if (child.localName === 'r' && child.prefix === 'w') {
      if (skipRunIds?.has(child.id)) continue;
      result.push(
        makeNode('run', child, partUri, extractRunProperties, deriveChildAnchor(element, elementPath, child, partUri)),
      );
      continue;
    }

    if (child.localName === 'hyperlink' && child.prefix === 'w') {
      const hyperlinkPath = deriveChildPathIfKnown(element, elementPath, child);
      for (const hyperlinkChild of child.children) {
        if (hyperlinkChild.kind === 'element' && hyperlinkChild.localName === 'r' && hyperlinkChild.prefix === 'w') {
          if (skipRunIds?.has(hyperlinkChild.id)) continue;
          result.push(
            makeNode(
              'run',
              hyperlinkChild,
              partUri,
              extractRunProperties,
              deriveChildAnchor(child, hyperlinkPath, hyperlinkChild, partUri),
            ),
          );
        }
      }
      continue;
    }

    if (child.localName === 'sdt' && child.prefix === 'w') {
      const sdtContent = findChildElement(child, 'sdtContent', 'w');
      if (sdtContent) {
        collectRunsFromElement(
          sdtContent,
          result,
          partUri,
          deriveDescendantPath(element, elementPath, sdtContent),
          skipRunIds,
        );
      }
      continue;
    }

    if (
      child.prefix === 'w' &&
      (child.localName === 'ins' ||
        child.localName === 'del' ||
        child.localName === 'moveTo' ||
        child.localName === 'moveFrom')
    ) {
      const trackedChangePath = deriveChildPathIfKnown(element, elementPath, child);
      for (const trackedChild of child.children) {
        if (trackedChild.kind === 'element' && trackedChild.localName === 'r' && trackedChild.prefix === 'w') {
          if (skipRunIds?.has(trackedChild.id)) continue;
          result.push(
            makeNode(
              'run',
              trackedChild,
              partUri,
              extractRunProperties,
              deriveChildAnchor(child, trackedChangePath, trackedChild, partUri),
            ),
          );
        }
      }
    }
  }
}

/**
 * Create a FeederNode for a top-level body child element.
 *
 * This is the public entry point used by the windowed projection to wrap
 * BodyChildDescriptor elements as FeederNodes.
 */
export function bodyChildToFeederNode(
  element: XmlElementNode,
  partUri: string,
  sourceNodePath?: string,
): FeederNode<'paragraph'> | FeederNode<'table'> | undefined {
  if (element.localName === 'p' && element.prefix === 'w') {
    return makeNode(
      'paragraph',
      element,
      partUri,
      extractParagraphProperties,
      elementToSourceAnchor(element, partUri, sourceNodePath),
    );
  }

  if (element.localName === 'tbl' && element.prefix === 'w') {
    return makeNode(
      'table',
      element,
      partUri,
      extractTableProperties,
      elementToSourceAnchor(element, partUri, sourceNodePath),
    );
  }

  return undefined;
}

/**
 * Create a FeederNode<"section"> from a raw sectPr element.
 */
export function sectionElementToFeederNode(
  element: XmlElementNode,
  partUri: string,
  sourceNodePath?: string,
): FeederNode<'section'> {
  return makeNode(
    'section',
    element,
    partUri,
    extractSectionProperties,
    elementToSourceAnchor(element, partUri, sourceNodePath),
  );
}

function deriveChildAnchor(
  parentElement: XmlElementNode,
  parentPath: string | undefined,
  childElement: XmlElementNode,
  partUri: string,
): SourceAnchor {
  return elementToSourceAnchor(childElement, partUri, deriveChildPathIfKnown(parentElement, parentPath, childElement));
}

function deriveChildPathIfKnown(
  parentElement: XmlElementNode,
  parentPath: string | undefined,
  childElement: XmlElementNode,
): string | undefined {
  if (!parentPath) {
    return undefined;
  }

  return computeChildPath(parentElement, parentPath, childElement);
}

function deriveDescendantPath(
  rootElement: XmlElementNode,
  rootPath: string | undefined,
  descendantElement: XmlElementNode,
): string | undefined {
  if (!rootPath) {
    return undefined;
  }

  return computePathFromRoot(rootElement, rootPath, descendantElement);
}
