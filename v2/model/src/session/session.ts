// ---------------------------------------------------------------------------
// PackageSession — internal mutable session state
// ---------------------------------------------------------------------------

import type {
  PackageSession,
  SessionStatus,
  ReadyStage,
} from "../types/session.js";
import type { ArchiveByteSource, AsyncArchiveReader } from "../types/package.js";
import { fastOpen, fastOpenAsync } from "../opc/package-loader.js";
import { inflateEntryAsync } from "../opc/zip-reader.js";
import { nextRevision } from "./revision.js";
import { indexXmlParts } from "../xml/index-integration.js";
import {
  startFastOpenSpan,
  startAdvanceToStructureSpan,
  startMaterializeXmlSpan,
  startIndexXmlPartsSpan,
  markStructureReady,
  recordXmlPartsMaterialized,
} from "../perf.js";

let sessionCounter = 0;

/** Create a PackageSession from an in-memory archive byte source. */
export function createSession(source: ArchiveByteSource): PackageSession {
  const endFastOpen = startFastOpenSpan();
  const { zip, parts, contentTypes, relationships, mainDocumentUri, diagnostics } =
    fastOpen(source);
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
    currentStage: "fast-open",
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
  const { zip, parts, contentTypes, relationships, mainDocumentUri, diagnostics } =
    await fastOpenAsync(reader);
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
    currentStage: "fast-open",
    asyncReader: reader,
  };
}

/** Advance the session to a deeper ready stage. */
export async function advanceToStage(
  session: PackageSession,
  stage: ReadyStage,
): Promise<void> {
  const stageOrder: ReadyStage[] = ["fast-open", "structure"];

  const currentIdx = stageOrder.indexOf(session.currentStage);
  const targetIdx = stageOrder.indexOf(stage);

  if (targetIdx <= currentIdx) return; // already at or past this stage

  if (currentIdx < 1 && targetIdx >= 1) {
    await advanceToStructure(session);
  }
}

/** Build XML lexical indexes for package-critical and major typed-view parts. */
async function advanceToStructure(session: PackageSession): Promise<void> {
  const endStructure = startAdvanceToStructureSpan();

  // For lazy sessions, pre-materialize XML part bytes before indexing
  if (session.asyncReader) {
    await materializeXmlParts(session);
  }

  const endIndex = startIndexXmlPartsSpan();
  indexXmlParts(session);
  endIndex();

  session.currentStage = "structure";
  markStructureReady();
  endStructure();
}

/**
 * For lazy sessions, read and inflate all XML part entries from the async reader.
 * After this, each XML part has `originalBytes` set and can be accessed synchronously.
 * Binary parts remain unmaterialized — their bytes are read on demand.
 */
async function materializeXmlParts(session: PackageSession): Promise<void> {
  const reader = session.asyncReader;
  if (!reader) return;

  const endMaterialize = startMaterializeXmlSpan();
  const zip = session.originalZip;
  let materializedCount = 0;

  for (const part of session.parts.values()) {
    if (part.kind !== "xml") continue;
    if (part.originalBytes) continue;

    const source = part.source;
    if (source.kind === "archive-slice") {
      const entry = zip.entryById.get(source.entryId);
      if (entry) {
        part.originalBytes = await inflateEntryAsync(reader, entry);
        part.source = { kind: "materialized", bytes: part.originalBytes };
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
    if (part.kind === "xml") {
      xmlPartCount++;
      if (part.lexicalIndex) indexedXmlPartCount++;
      if (part.treeState.kind !== "indexed-only") hydratedXmlPartCount++;
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
  if (src.kind === "memory") return src.bytes;

  throw new Error(
    `getArchiveBytes() called on a lazy session (source kind: "${src.kind}") — ` +
    `use session.asyncReader for lazy entry access`,
  );
}

/**
 * Get archive bytes if available (memory-backed), or undefined for lazy sessions.
 * Used by code that can handle both paths.
 */
export function getArchiveBytesIfAvailable(
  session: PackageSession,
): Uint8Array | undefined {
  const src = session.originalArchive;
  return src.kind === "memory" ? src.bytes : undefined;
}
