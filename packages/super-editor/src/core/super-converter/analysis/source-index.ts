// ---------------------------------------------------------------------------
// Source Index
// ---------------------------------------------------------------------------
// Pre-traversal indexed DOM walk over parsed XML objects (from xml-js).
// Produces a WeakMap<object, V1SourceAnchor> keyed by the XML element objects
// that handlers will later receive.
//
// CRITICAL: This must be built over the carbonCopy'd objects (the deep clone
// created at line 116 of docxImporter.js), NOT over converter.convertedXml.
// The handler traversal operates on the cloned objects.
//
// CRITICAL: This must run BEFORE preProcessNodesForFldChar() mutates the tree.
// ---------------------------------------------------------------------------

import { buildAnchorId, toPathSignature } from './source-anchor.js';
import type { V1SourceAnchor, V1SourceIndex, V1StoryKind } from './provenance-types.js';

/** XML element shape from xml-js (non-compact format). */
type XmlJsElement = {
  name?: string;
  type?: string;
  attributes?: Record<string, string>;
  elements?: XmlJsElement[];
  text?: string;
};

type PathSegment = {
  formattedName: string;
  siblingIndex: number;
};

/**
 * Build a pre-traversal source index for a single XML part.
 *
 * Walks the parsed XML DOM tree (xml-js objects) and records the xpathLikePath
 * for every element node. The result is a WeakMap keyed by the XML element
 * objects themselves, enabling O(1) lookup during handler traversal.
 *
 * @param rootElements - The top-level elements array (e.g., `json.elements`)
 * @param partUri - The OOXML part URI (e.g., `word/document.xml`)
 * @param storyKind - The story kind for anchors produced from this part
 */
export function buildSourceIndex(rootElements: XmlJsElement[], partUri: string, storyKind: V1StoryKind): V1SourceIndex {
  const anchorMap = new WeakMap<object, V1SourceAnchor>();

  walkElements(rootElements, [], partUri, storyKind, anchorMap);

  return {
    getAnchorId(node: object): string | undefined {
      return anchorMap.get(node)?.anchorId;
    },
    getAnchor(node: object): V1SourceAnchor | undefined {
      return anchorMap.get(node);
    },
  };
}

/**
 * Recursive DOM walker that indexes every element in the tree.
 *
 * Tracks sibling indices per parent (same algorithm as PathState in raw-surface)
 * to produce xpathLikePath values that exactly match SAX-based scanning.
 */
function walkElements(
  elements: XmlJsElement[],
  parentPath: PathSegment[],
  partUri: string,
  storyKind: V1StoryKind,
  anchorMap: WeakMap<object, V1SourceAnchor>,
): void {
  // Count siblings by name at this level (same algorithm as PathState.pushElement)
  const siblingCounts = new Map<string, number>();

  for (const el of elements) {
    if (!el.name) continue; // skip text nodes

    const formattedName = el.name; // xml-js uses document-literal prefixes (e.g., `w:p`)
    const siblingIndex = (siblingCounts.get(formattedName) ?? 0) + 1;
    siblingCounts.set(formattedName, siblingIndex);

    const currentPath: PathSegment[] = [...parentPath, { formattedName, siblingIndex }];
    const xpathLikePath = formatIndexedPath(partUri, currentPath);
    const pathSignature = toPathSignature(xpathLikePath);
    const anchorId = buildAnchorId(partUri, xpathLikePath);

    anchorMap.set(el, {
      anchorId,
      partUri,
      xpathLikePath,
      pathSignature,
      qname: formattedName,
      storyKind,
    });

    // Recurse into children
    if (el.elements?.length) {
      walkElements(el.elements, currentPath, partUri, storyKind, anchorMap);
    }
  }
}

/** Format an indexed xpath-like path from segments (matches raw-surface format). */
function formatIndexedPath(partUri: string, segments: PathSegment[]): string {
  const parts = segments.map((s) => `${s.formattedName}[${s.siblingIndex}]`);
  return `${partUri}::/${parts.join('/')}`;
}
