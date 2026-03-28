// ---------------------------------------------------------------------------
// PackageSession — internal mutable session state
// ---------------------------------------------------------------------------

import type { PackageSession, SessionStatus, ReadyStage } from '../types/session.js';
import type { ArchiveByteSource, AsyncArchiveReader } from '../types/package.js';
import { fastOpen, fastOpenAsync } from '../opc/package-loader.js';
import { inflateEntryAsync } from '../opc/zip-reader.js';
import { nextRevision } from './revision.js';
import { indexRenderShellParts, indexXmlParts } from '../xml/index-integration.js';
import {
  startFastOpenSpan,
  startAdvanceToRenderShellSpan,
  startAdvanceToStructureSpan,
  startMaterializeXmlSpan,
  startIndexXmlPartsSpan,
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

const STAGE_ORDER: ReadyStage[] = ['fast-open', 'render-shell', 'structure'];

/** Advance the session to a deeper ready stage. */
export async function advanceToStage(session: PackageSession, stage: ReadyStage, signal?: AbortSignal): Promise<void> {
  const currentIdx = STAGE_ORDER.indexOf(session.currentStage);
  const targetIdx = STAGE_ORDER.indexOf(stage);

  if (targetIdx <= currentIdx) return; // already at or past this stage

  // Advance through each intermediate stage in order
  if (currentIdx < 1 && targetIdx >= 1) {
    await advanceToRenderShell(session, signal);
  }
  if (currentIdx < 2 && targetIdx >= 2) {
    await advanceToStructure(session, signal);
  }
}

/** Parts needed for render-shell stage (critical path only). */
const RENDER_SHELL_PART_URIS = new Set([
  '/word/document.xml',
  '/word/styles.xml',
  '/word/numbering.xml',
  '/word/settings.xml',
]);

/**
 * Advance to render-shell: materialize and index only the critical-path parts
 * needed for first-window paginated render.
 */
async function advanceToRenderShell(session: PackageSession, signal?: AbortSignal): Promise<void> {
  const endRenderShell = startAdvanceToRenderShellSpan();
  try {
    // For lazy sessions, materialize only the render-shell parts
    if (session.asyncReader) {
      await materializeXmlParts(session, RENDER_SHELL_PART_URIS, signal);
    }

    const endIndex = startIndexXmlPartsSpan();
    try {
      indexRenderShellParts(session, signal);
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

/** Compute current session status. */
export function getSessionStatus(session: PackageSession): SessionStatus {
  let xmlPartCount = 0;
  let binaryPartCount = 0;
  let indexedXmlPartCount = 0;
  let hydratedXmlPartCount = 0;

  for (const part of session.parts.values()) {
    if (part.kind === 'xml') {
      xmlPartCount++;
      if (part.lexicalIndex) indexedXmlPartCount++;
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
