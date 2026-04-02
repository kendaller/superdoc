// ---------------------------------------------------------------------------
// Source-anchor helpers for layout projection
//
// Both the semantic-model path and the render-shell path need to derive the
// same stable, source-backed identity for a given XML element. This module is
// the single source of truth for that normalization.
// ---------------------------------------------------------------------------

import type { SourceRef } from '../../identity/types.js';
import type { SourceSpan, XmlElementNode } from '../../types/xml.js';
import { makeNodeId } from '../../xml/node-id.js';

/**
 * Source-backed identity anchor for projected layout blocks.
 *
 * `partUri` identifies the OPC part. `nodeId` identifies the source element
 * within that part.
 */
export type SourceAnchor = {
  readonly partUri: string;
  readonly nodeId: string;
  readonly sourceNodePath?: string;
};

const CANONICAL_NODE_ID_PATTERN = /^(.*):[^:]+:(\d+)-(\d+)$/;

/**
 * Convert a semantic-model source ref to a projection source anchor.
 */
export function sourceRefToSourceAnchor(sourceRef: SourceRef): SourceAnchor {
  return {
    partUri: sourceRef.partUri,
    nodeId: sourceRef.nodeId,
    ...(sourceRef.sourceNodePath ? { sourceNodePath: sourceRef.sourceNodePath } : {}),
  };
}

/**
 * Convert a raw XML element to a projection source anchor.
 *
 * Region-hydrated render-shell elements may use wrapper-relative spans, so
 * their `sourceSpan` cannot be trusted as a stable cross-path identifier.
 * Prefer the element's existing ID, which is what the semantic graph stores,
 * and only synthesize a replacement when an ID is genuinely missing.
 */
export function elementToSourceAnchor(element: XmlElementNode, partUri: string, sourceNodePath?: string): SourceAnchor {
  return {
    partUri,
    nodeId: resolveCanonicalNodeId(element, partUri),
    ...(sourceNodePath ? { sourceNodePath } : {}),
  };
}

/**
 * Build a source anchor directly from a source span, without requiring a
 * hydrated XmlElementNode. Used by the preview-shell projection path.
 */
export function sourceSpanToSourceAnchor(partUri: string, sourceSpan: SourceSpan, sourceNodePath?: string): SourceAnchor {
  return {
    partUri,
    nodeId: makeNodeId(partUri, 'element', sourceSpan),
    ...(sourceNodePath ? { sourceNodePath } : {}),
  };
}

/**
 * Convert a source anchor to a deterministic, DOM-safe token.
 *
 * The token is human-readable and stable across projection paths. Canonical
 * node IDs collapse to `{sanitizedPartUri}_{start}_{end}`. Non-canonical IDs
 * fall back to `{sanitizedPartUri}_{sanitizedNodeId}`.
 */
export function stableSourceToken(anchor: SourceAnchor): string {
  if (anchor.sourceNodePath) {
    return sanitizeIdentifierPart(anchor.sourceNodePath);
  }

  const canonicalMatch = CANONICAL_NODE_ID_PATTERN.exec(anchor.nodeId);
  if (canonicalMatch) {
    const [, partUri, startByte, endByte] = canonicalMatch;
    return joinTokenParts(sanitizeIdentifierPart(partUri), startByte, endByte);
  }

  return joinTokenParts(sanitizeIdentifierPart(anchor.partUri), sanitizeIdentifierPart(anchor.nodeId));
}

function resolveCanonicalNodeId(element: XmlElementNode, partUri: string): string {
  if (element.id) {
    return element.id;
  }

  if (element.sourceSpan) {
    return makeNodeId(partUri, 'element', element.sourceSpan);
  }

  return element.id;
}

function sanitizeIdentifierPart(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  return sanitized || 'node';
}

function joinTokenParts(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('_');
}
