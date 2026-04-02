// ---------------------------------------------------------------------------
// PackageSession — internal mutable session state
// ---------------------------------------------------------------------------

import type { PackageSession, SessionStatus, ReadyStage } from '../types/session.js';
import type { ArchiveByteSource, AsyncArchiveReader } from '../types/package.js';
import { fastOpen, fastOpenAsync } from '../opc/package-loader.js';
import { inflateEntryAsync } from '../opc/zip-reader.js';
import { nextRevision } from './revision.js';
import {
  indexFirstPaintShellParts,
  indexRenderShellParts,
  indexRenderShellSupportParts,
  indexXmlParts,
  indexPartOnDemand,
} from '../xml/index-integration.js';
import {
  startFastOpenSpan,
  startAdvanceToFirstPaintShellSpan,
  startAdvanceToRenderShellSpan,
  startAdvanceToStructureSpan,
  startMaterializeXmlSpan,
  startIndexXmlPartsSpan,
  markFirstPaintShellReady,
  markRenderShellReady,
  markStructureReady,
  recordXmlPartsMaterialized,
} from '../perf.js';

let sessionCounter = 0;

/** Create a PackageSession from an in-memory archive byte source. */
export function createSession(source: ArchiveByteSource): PackageSession {
  const endFastOpen = startFastOpenSpan();
  const { zip, parts, contentTypes, relationships, mainDocumentUri, diagnostics } = fastOpen(source);
  endFastOpen();

  return {
    sessionId: `session-${sessionCounter++}`,
    originalArchive: source,
    originalZip: zip,
    currentRevision: nextRevision(),
    mainDocumentUri,
    parts,
    relationships,
    contentTypes,
    diagnostics,
    currentStage: 'fast-open',
  };
}

/**
 * Create a PackageSession from an async reader (Blob/range-reader).
 * Only reads the zip central directory and metadata entries — no content parts
 * are materialized. Content bytes are read lazily via the async reader.
 */
export async function createSessionAsync(
  reader: AsyncArchiveReader,
  originalSource: ArchiveByteSource,
): Promise<PackageSession> {
  const endFastOpen = startFastOpenSpan();
  const { zip, parts, contentTypes, relationships, mainDocumentUri, diagnostics } = await fastOpenAsync(reader);
  endFastOpen();

  return {
    sessionId: `session-${sessionCounter++}`,
    originalArchive: originalSource,
    originalZip: zip,
    currentRevision: nextRevision(),
    mainDocumentUri,
    parts,
    relationships,
    contentTypes,
    diagnostics,
    currentStage: 'fast-open',
    asyncReader: reader,
  };
}

const STAGE_ORDER: ReadyStage[] = ['fast-open', 'first-paint-shell', 'render-shell', 'structure'];

/** Advance the session to a deeper ready stage. */
export async function advanceToStage(session: PackageSession, stage: ReadyStage, signal?: AbortSignal): Promise<void> {
  const currentIdx = STAGE_ORDER.indexOf(session.currentStage);
  const targetIdx = STAGE_ORDER.indexOf(stage);

  if (targetIdx <= currentIdx) return; // already at or past this stage

  // Advance through each intermediate stage in order
  if (currentIdx < 1 && targetIdx >= 1) {
    await advanceToFirstPaintShell(session, signal);
  }
  if (currentIdx < 2 && targetIdx >= 2) {
    await advanceToRenderShell(session, signal);
  }
  if (currentIdx < 3 && targetIdx >= 3) {
    await advanceToStructure(session, signal);
  }
}

/**
 * Parts materialized before first paint.
 *
 * The preview-first critical path should only pull the main document bytes.
 * Styles, numbering, and settings are intentionally deferred to the later
 * render-shell stage so the first visible paint is not blocked on support
 * parts that the preview path does not require.
 */
const FIRST_PAINT_SHELL_PART_URIS = new Set(['/word/document.xml']);

/**
 * Support parts needed for exact style-aware render-shell projection.
 *
 * These are materialized only after the preview window has already painted.
 */
const RENDER_SHELL_SUPPORT_PART_URIS = new Set(['/word/styles.xml', '/word/numbering.xml', '/word/settings.xml']);

/**
 * Advance to first-paint-shell: materialize critical-path XML bytes and index
 * only the main document part.
 */
async function advanceToFirstPaintShell(session: PackageSession, signal?: AbortSignal): Promise<void> {
  const endFirstPaintShell = startAdvanceToFirstPaintShellSpan();
  try {
    if (session.asyncReader) {
      await materializeXmlParts(session, FIRST_PAINT_SHELL_PART_URIS, signal);
    }

    const endIndex = startIndexXmlPartsSpan();
    try {
      indexFirstPaintShellParts(session, signal);
    } finally {
      endIndex();
    }

    session.currentStage = 'first-paint-shell';
    markFirstPaintShellReady();
  } finally {
    endFirstPaintShell();
  }
}

/**
 * Advance to render-shell: index supporting XML parts needed for style-aware
 * paginated rendering after the first visible window has painted.
 */
async function advanceToRenderShell(session: PackageSession, signal?: AbortSignal): Promise<void> {
  const endRenderShell = startAdvanceToRenderShellSpan();
  try {
    if (session.asyncReader) {
      await materializeXmlParts(session, RENDER_SHELL_SUPPORT_PART_URIS, signal);
    }

    const endIndex = startIndexXmlPartsSpan();
    try {
      indexRenderShellParts(session, signal);
      indexRenderShellSupportParts(session, signal);
    } finally {
      endIndex();
    }

    session.currentStage = 'render-shell';
    markRenderShellReady();
  } finally {
    endRenderShell();
  }
}

/** Build XML lexical indexes for package-critical and major typed-view parts. */
async function advanceToStructure(session: PackageSession, signal?: AbortSignal): Promise<void> {
  const endStructure = startAdvanceToStructureSpan();
  try {
    // For lazy sessions, materialize remaining XML part bytes before indexing
    if (session.asyncReader) {
      await materializeXmlParts(session, undefined, signal);
    }

    const endIndex = startIndexXmlPartsSpan();
    try {
      indexXmlParts(session, signal);
    } finally {
      endIndex();
    }

    session.currentStage = 'structure';
    markStructureReady();
  } finally {
    endStructure();
  }
}

/**
 * For lazy sessions, read and inflate XML part entries from the async reader.
 * If `filterUris` is provided, only parts whose URI is in the set are materialized.
 * Otherwise, all XML parts are materialized.
 * Binary parts remain unmaterialized — their bytes are read on demand.
 */
async function materializeXmlParts(
  session: PackageSession,
  filterUris?: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  const reader = session.asyncReader;
  if (!reader) return;

  const endMaterialize = startMaterializeXmlSpan();
  const zip = session.originalZip;
  let materializedCount = 0;

  for (const [uri, part] of session.parts) {
    if (signal?.aborted) {
      endMaterialize();
      throw new DOMException('Aborted', 'AbortError');
    }

    if (part.kind !== 'xml') continue;
    if (part.originalBytes) continue;
    if (filterUris && !filterUris.has(uri)) continue;

    const source = part.source;
    if (source.kind === 'archive-slice') {
      const entry = zip.entryById.get(source.entryId);
      if (entry) {
        part.originalBytes = await inflateEntryAsync(reader, entry);
        part.source = { kind: 'materialized', bytes: part.originalBytes };
        materializedCount++;
      }
    }
  }

  recordXmlPartsMaterialized(materializedCount);
  endMaterialize();
}

/**
 * Materialize specific XML parts for background enrichment.
 *
 * Unlike advanceToRenderShell/advanceToStructure, this does NOT change the
 * session stage. It materializes and indexes only the requested parts so
 * enrichment executors can read annotation/header/footer content without
 * requiring the full structure stage.
 */
export async function materializePartsForEnrichment(
  session: PackageSession,
  partUris: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  // Materialize bytes for lazy sessions
  if (session.asyncReader) {
    await materializeXmlParts(session, partUris, signal);
  }

  // Index each requested part so views can use it
  for (const uri of partUris) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const part = session.parts.get(uri);
    if (part && part.kind === 'xml' && !part.lexicalIndex) {
      indexPartOnDemand(part, session, signal);
    }
  }
}

/** Compute current session status. */
export function getSessionStatus(session: PackageSession): SessionStatus {
  let xmlPartCount = 0;
  let binaryPartCount = 0;
  let indexedXmlPartCount = 0;
  let hydratedXmlPartCount = 0;

  for (const part of session.parts.values()) {
    if (part.kind === 'xml') {
      xmlPartCount++;
      if (part.lexicalIndex || part.documentBodyFastIndex) indexedXmlPartCount++;
      if (part.treeState.kind !== 'indexed-only') hydratedXmlPartCount++;
    } else {
      binaryPartCount++;
    }
  }

  return {
    sessionId: session.sessionId,
    currentRevision: session.currentRevision,
    currentStage: session.currentStage,
    diagnostics: [...session.diagnostics],
    metrics: {
      partCount: session.parts.size,
      xmlPartCount,
      binaryPartCount,
      indexedXmlPartCount,
      hydratedXmlPartCount,
    },
  };
}

/** Check if any part in the session is dirty. */
export function isSessionDirty(session: PackageSession): boolean {
  for (const part of session.parts.values()) {
    if (part.dirty) return true;
  }
  return false;
}

/**
 * Get the raw archive bytes from a memory-backed session.
 * Throws for lazy sessions — callers should use the async reader instead.
 */
export function getArchiveBytes(session: PackageSession): Uint8Array {
  const src = session.originalArchive;
  if (src.kind === 'memory') return src.bytes;

  throw new Error(
    `getArchiveBytes() called on a lazy session (source kind: "${src.kind}") — ` +
      `use session.asyncReader for lazy entry access`,
  );
}

/**
 * Get archive bytes if available (memory-backed), or undefined for lazy sessions.
 * Used by code that can handle both paths.
 */
export function getArchiveBytesIfAvailable(session: PackageSession): Uint8Array | undefined {
  const src = session.originalArchive;
  return src.kind === 'memory' ? src.bytes : undefined;
}
