// ---------------------------------------------------------------------------
// XML index integration — connects the indexer to PackageSession
//
// During the "structure" ready stage, indexes package-critical and
// major typed-view XML parts. Other parts remain indexed-only
// and can be indexed on demand.
// ---------------------------------------------------------------------------

import type { ReadyStage, PackageSession } from '../types/session.js';
import type { XmlPart } from '../types/package.js';
import { resolvePartBytes } from '../session/part-bytes.js';
import { buildLexicalIndex } from './indexer.js';
import type { BoundaryConfig } from './indexer.js';

// The main document is the only XML part indexed on the first-paint critical path.
const FIRST_PAINT_SHELL_INDEXED_PARTS = new Set(['/word/document.xml']);

// Support parts indexed during the later "render-shell" stage.
const RENDER_SHELL_SUPPORT_PARTS = new Set(['/word/styles.xml', '/word/numbering.xml', '/word/settings.xml']);

// Parts that should be indexed during the "structure" stage
const STRUCTURE_PARTS = new Set([
  '/word/document.xml',
  '/word/styles.xml',
  '/word/numbering.xml',
  '/word/settings.xml',
  '/word/comments.xml',
  '/word/footnotes.xml',
  '/word/endnotes.xml',
  '/word/fontTable.xml',
]);

// Boundary configs for specific parts
const BOUNDARY_CONFIGS: Record<string, BoundaryConfig> = {
  '/word/document.xml': {
    boundaryDepth: 2, // w:document > w:body > children are boundaries
    boundaryParents: new Set(['w:body']),
  },
  '/word/styles.xml': {
    boundaryDepth: 1, // w:styles > children are boundaries
  },
  '/word/comments.xml': {
    boundaryDepth: 1, // w:comments > w:comment are boundaries
  },
  '/word/footnotes.xml': {
    boundaryDepth: 1,
  },
  '/word/endnotes.xml': {
    boundaryDepth: 1,
  },
  '/word/numbering.xml': {
    boundaryDepth: 1,
  },
};

/**
 * Index only the critical-path XML parts needed for the "first-paint-shell" stage.
 * This keeps the pre-render stage focused on the main document body's boundary
 * index while leaving styles/numbering/settings for the later render-shell stage.
 */
export function indexRenderShellParts(session: PackageSession, signal?: AbortSignal): void {
  for (const [uri, part] of session.parts) {
    throwIfAborted(signal);
    if (part.kind !== 'xml') continue;
    if (!FIRST_PAINT_SHELL_INDEXED_PARTS.has(uri)) continue;
    indexSinglePart(part, session, 'first-paint-shell');
  }
}

/**
 * Index the support XML parts needed for style-aware render-shell access.
 */
export function indexRenderShellSupportParts(session: PackageSession, signal?: AbortSignal): void {
  for (const [uri, part] of session.parts) {
    throwIfAborted(signal);
    if (part.kind !== 'xml') continue;
    if (!RENDER_SHELL_SUPPORT_PARTS.has(uri)) continue;
    indexSinglePart(part, session, 'render-shell');
  }
}

/**
 * Index XML parts that are critical for the "structure" stage.
 * Non-critical parts remain indexed-only.
 */
export function indexXmlParts(session: PackageSession, signal?: AbortSignal): void {
  for (const [uri, part] of session.parts) {
    throwIfAborted(signal);
    if (part.kind !== 'xml') continue;

    const shouldIndex =
      STRUCTURE_PARTS.has(uri) ||
      uri.startsWith('/word/header') ||
      uri.startsWith('/word/footer') ||
      uri.startsWith('/word/theme/');

    if (!shouldIndex) continue;

    indexSinglePart(part, session, 'structure');
  }
}

/**
 * Index a single XML part on demand.
 * Can be called for parts not indexed during the structure stage.
 */
export function indexPartOnDemand(part: XmlPart, session: PackageSession, signal?: AbortSignal): void {
  if (part.lexicalIndex) return;
  throwIfAborted(signal);
  indexSinglePart(part, session, 'structure');
}

function indexSinglePart(part: XmlPart, session: PackageSession, stage: ReadyStage): void {
  if (part.lexicalIndex) return;

  try {
    const bytes = resolvePartBytes(part, session);
    part.originalBytes = bytes;

    const config = BOUNDARY_CONFIGS[part.uri] ?? { boundaryDepth: 1 };
    part.lexicalIndex = buildLexicalIndex(bytes, part.uri, config);
  } catch (err) {
    session.diagnostics.push({
      code: 'XML_INDEX_ERROR',
      severity: 'warning',
      stage,
      message: `Failed to index XML part ${part.uri}: ${err}`,
      partUri: part.uri,
    });
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}
