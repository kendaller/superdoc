// ---------------------------------------------------------------------------
// Save path — no-op round-trip and dirty rebuild
// ---------------------------------------------------------------------------

import type { PackageSession, SaveOptions, SaveResult } from "../types/session.js";
import type { XmlPart, PackagePart } from "../types/package.js";
import type { ZipEntrySnapshot } from "../types/zip.js";
import type { HydratedRegionIndex } from "../types/xml.js";
import { isSessionDirty, getArchiveBytesIfAvailable } from "./session.js";
import { buildZipArchive, buildZipArchiveStream, buildZipArchiveStreamAsync } from "../opc/zip-writer.js";
import type { ZipWriteEntry } from "../opc/zip-writer.js";
import { readRawEntryAsync, inflateEntryAsync } from "../opc/zip-reader.js";
import { serializeXmlDocument, serializeNode } from "../xml/serializer.js";
import { resolvePartBytes, resolveBinaryPartBytes } from "./part-bytes.js";
import { serializeContentTypes } from "../opc/content-types.js";

// ---- Constants ------------------------------------------------------------

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ---- Types ----------------------------------------------------------------

type SaveTarget = "bytes" | "blob" | "stream";

/** Pre-computed plan for a single ZIP entry during rebuild. */
type EntryPlan = {
  /** ZIP entry name (without leading slash). */
  entryName: string;
  /** Original ZIP entry, or undefined for parts added after open. */
  zipEntry: ZipEntrySnapshot | undefined;
  partUri: string;
  part: PackagePart | undefined;
  isDirty: boolean;
};

// ---- Public API -----------------------------------------------------------

/**
 * Save the package to the requested target format.
 *
 * - If nothing is dirty -> return exact original archive bytes (no-op save).
 * - If any part is dirty -> rebuild the archive with copy-through for
 *   unchanged entries and fresh bytes for dirty parts.
 *
 * For lazy sessions (blob/range-reader), dirty saves are inherently async
 * because copy-through entries must be read from the async reader.
 * The function returns a Promise<SaveResult> in that case.
 */
export function savePackage(
  session: PackageSession,
  options?: SaveOptions,
): SaveResult | Promise<SaveResult> {
  const mode = options?.mode ?? "auto";
  const target: SaveTarget = options?.target ?? "bytes";

  // No-op fast path: return original bytes unchanged.
  // Skip if new parts were added — they must be written via rebuild.
  if (mode !== "rebuild" && !isSessionDirty(session) && !hasNewParts(session)) {
    return returnOriginalBytes(session, target);
  }

  // Dirty save: rebuild the archive
  // For lazy sessions, copy-through entries need async reads
  if (session.asyncReader) {
    return rebuildArchiveAsync(session, target);
  }

  return rebuildArchive(session, target);
}

/** Check if any parts exist that were not in the original ZIP archive. */
function hasNewParts(session: PackageSession): boolean {
  const originalNames = new Set(session.originalZip.entries.map((e) => "/" + e.name));
  for (const uri of session.parts.keys()) {
    if (!originalNames.has(uri)) return true;
  }
  return false;
}

// ---- Entry plan builder ---------------------------------------------------

/** Result of building an entry plan. */
type EntryPlanResult = {
  plan: EntryPlan[];
  /** True when parts exist that were not in the original ZIP archive. */
  hasNewParts: boolean;
};

/**
 * Build a plan array describing every ZIP entry in the output archive.
 *
 * 1. Walk `zip.entryOrder` to include all original entries (with copy-through
 *    for unchanged, fresh bytes for dirty).
 * 2. Append entries for any parts in `session.parts` that have no
 *    corresponding original ZIP entry (new parts added after open).
 * 3. When new parts exist, regenerate [Content_Types].xml to include them.
 */
function buildEntryPlan(session: PackageSession): EntryPlanResult {
  const zip = session.originalZip;
  const plan: EntryPlan[] = [];
  const coveredUris = new Set<string>();

  // Phase 1: original ZIP entries
  for (const entryId of zip.entryOrder) {
    const zipEntry = zip.entryById.get(entryId)!;
    const partUri = "/" + zipEntry.name;
    const part = session.parts.get(partUri);
    coveredUris.add(partUri);

    plan.push({
      entryName: zipEntry.name,
      zipEntry,
      partUri,
      part,
      isDirty: part?.dirty ?? false,
    });
  }

  // Phase 2: new parts not in the original archive
  const newPartEntries: EntryPlan[] = [];
  for (const [uri, part] of session.parts) {
    if (coveredUris.has(uri)) continue;
    newPartEntries.push({
      entryName: uri.startsWith("/") ? uri.slice(1) : uri,
      zipEntry: undefined,
      partUri: uri,
      part,
      isDirty: true,
    });
  }

  const hasNewParts = newPartEntries.length > 0;

  // When new parts exist, mark [Content_Types].xml for regeneration
  // so the new parts are properly registered in the output archive.
  if (hasNewParts) {
    const ctItem = plan.find((item) => item.entryName === "[Content_Types].xml");
    if (ctItem) ctItem.isDirty = true;
    plan.push(...newPartEntries);
  }

  return { plan, hasNewParts };
}

// ---- Dirty-entry resolution -----------------------------------------------

/**
 * Resolve a dirty or new entry into a fresh ZipWriteEntry.
 *
 * Handles three cases:
 * - [Content_Types].xml: regenerated from the session's content types model
 * - XML parts: serialized from tree or spliced from original bytes
 * - Binary parts: resolved from materialized/generated bytes
 *
 * Returns `undefined` when the part is a dirty binary whose bytes cannot
 * be resolved synchronously (e.g. lazy session, not yet materialized).
 * Callers handle the fallback (async inflate or copy-through).
 */
function resolveDirtyEntry(
  item: EntryPlan,
  session: PackageSession,
): ZipWriteEntry | undefined {
  const name = item.entryName;

  // [Content_Types].xml is not a PackagePart — regenerate from the model
  if (name === "[Content_Types].xml") {
    const xml = serializeContentTypes(session.contentTypes);
    return { kind: "new", name, uncompressedBytes: new TextEncoder().encode(xml) };
  }

  const part = item.part;
  if (!part) return undefined;

  if (part.kind === "xml") {
    return { kind: "new", name, uncompressedBytes: getXmlPartBytes(part, session) };
  }

  const bytes = resolveBinaryPartBytes(part, session);
  if (bytes) {
    return { kind: "new", name, uncompressedBytes: bytes };
  }

  return undefined;
}

// ---- No-op save -----------------------------------------------------------

function returnOriginalBytes(
  session: PackageSession,
  target: SaveTarget,
): SaveResult | Promise<SaveResult> {
  const archiveBytes = getArchiveBytesIfAvailable(session);

  // For lazy (blob/range-reader) sessions, return the blob directly
  if (!archiveBytes) {
    const src = session.originalArchive;
    if (target === "blob" && src.kind === "blob") {
      return src.blob;
    }
    // For other targets on lazy sessions, read from async reader
    // This is a no-op save so nothing is dirty — we need the original bytes
    if (session.asyncReader) {
      const reader = session.asyncReader;
      if (target === "stream") {
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            const bytes = await reader.read(0, reader.size);
            controller.enqueue(bytes);
            controller.close();
          },
        });
      }
      if (target === "blob") {
        // Read full archive and wrap as Blob (e.g. range-reader sessions)
        return reader
          .read(0, reader.size)
          .then((bytes) => new Blob([bytes as BlobPart], { type: DOCX_MIME }));
      }
      // "bytes" target — read the entire archive
      return reader.read(0, reader.size);
    }
    throw new Error("Cannot resolve archive bytes for save");
  }

  if (target === "blob") {
    return new Blob([archiveBytes as BlobPart], { type: DOCX_MIME });
  }

  if (target === "stream") {
    return new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>) {
        controller.enqueue(archiveBytes);
        controller.close();
      },
    });
  }

  return archiveBytes;
}

// ---- Dirty save (memory-backed) -------------------------------------------

function rebuildArchive(session: PackageSession, target: SaveTarget): SaveResult {
  // Safe: only called for memory-backed sessions (async sessions take the rebuildArchiveAsync path)
  const archiveBytes = getArchiveBytesIfAvailable(session)!;
  const zip = session.originalZip;
  const { plan } = buildEntryPlan(session);

  const writeEntries: ZipWriteEntry[] = plan.map((item) => {
    if (item.isDirty || !item.zipEntry) {
      const resolved = resolveDirtyEntry(item, session);
      if (resolved) return resolved;
      if (!item.zipEntry) {
        throw new Error(`New part ${item.partUri} has no resolvable bytes`);
      }
    }
    return { kind: "copy-through" as const, entry: item.zipEntry, archiveBytes };
  });

  if (target === "stream") {
    return buildZipArchiveStream(writeEntries, zip.archiveComment);
  }

  const result = buildZipArchive(writeEntries, zip.archiveComment);

  if (target === "blob") {
    return new Blob([result as BlobPart], { type: DOCX_MIME });
  }

  return result;
}

// ---- Dirty save (async / lazy session) ------------------------------------

/**
 * Rebuild archive for lazy sessions.
 *
 * - target "stream": returns a truly lazy ReadableStream — copy-through
 *   entries are read from the async reader one at a time during pull(),
 *   so only one entry's bytes are in memory at a time.
 * - target "bytes"/"blob": collects all entries (async), then builds
 *   the archive synchronously. These targets inherently need full memory.
 */
function rebuildArchiveAsync(
  session: PackageSession,
  target: SaveTarget,
): SaveResult | Promise<SaveResult> {
  if (target === "stream") {
    return rebuildArchiveLazyStream(session);
  }

  // For bytes/blob: collect entries, then build synchronously
  return collectWriteEntries(session).then((entries) => {
    const zip = session.originalZip;
    const result = buildZipArchive(entries, zip.archiveComment);
    if (target === "blob") {
      return new Blob([result as BlobPart], { type: DOCX_MIME });
    }
    return result;
  });
}

/**
 * Build a lazy streaming archive for lazy sessions.
 *
 * Walks entryOrder once — dirty entries are substituted in-place.
 * Copy-through entries are read from the async reader one per pull().
 */
function rebuildArchiveLazyStream(session: PackageSession): ReadableStream<Uint8Array> {
  // Safe: only called from rebuildArchiveAsync, which is gated on session.asyncReader
  const asyncReader = session.asyncReader!;
  const zip = session.originalZip;
  const { plan } = buildEntryPlan(session);

  // Pre-resolve dirty entries into concrete ZipWriteEntry values.
  // Copy-through entries are left as deferred and resolved lazily during pull().
  type ResolvedPlan =
    | { resolved: true; entry: ZipWriteEntry }
    | { resolved: false; zipEntry: ZipEntrySnapshot };

  const resolvedPlan: ResolvedPlan[] = plan.map((item) => {
    if (item.isDirty || !item.zipEntry) {
      const resolved = resolveDirtyEntry(item, session);
      if (resolved) return { resolved: true, entry: resolved };
      if (!item.zipEntry) {
        throw new Error(`New part ${item.partUri} has no resolvable bytes`);
      }
    }
    return { resolved: false, zipEntry: item.zipEntry };
  });

  const resolveEntry = async (index: number): Promise<ZipWriteEntry> => {
    const rp = resolvedPlan[index];
    if (rp.resolved) return rp.entry;

    const rawBytes = await readRawEntryAsync(asyncReader, rp.zipEntry);
    return {
      kind: "copy-through",
      entry: { ...rp.zipEntry, localHeaderOffset: 0 },
      archiveBytes: rawBytes,
    } as ZipWriteEntry;
  };

  return buildZipArchiveStreamAsync(resolvedPlan.length, resolveEntry, zip.archiveComment);
}

/** Collect all ZipWriteEntries for a lazy session rebuild (bytes/blob targets). */
async function collectWriteEntries(
  session: PackageSession,
): Promise<ZipWriteEntry[]> {
  // Safe: only called from rebuildArchiveAsync, which is gated on session.asyncReader
  const reader = session.asyncReader!;
  const { plan } = buildEntryPlan(session);
  const entries: ZipWriteEntry[] = [];

  for (const item of plan) {
    if (item.isDirty || !item.zipEntry) {
      const resolved = resolveDirtyEntry(item, session);
      if (resolved) {
        entries.push(resolved);
        continue;
      }
      if (!item.zipEntry) {
        throw new Error(`New part ${item.partUri} has no resolvable bytes`);
      }
      // Dirty binary not yet materialized — inflate from async reader
      if (item.part?.source.kind === "archive-slice") {
        const inflated = await inflateEntryAsync(reader, item.zipEntry);
        entries.push({ kind: "new", name: item.zipEntry.name, uncompressedBytes: inflated });
        continue;
      }
    }

    // Unchanged entry — copy raw compressed bytes from the async reader
    const rawBytes = await readRawEntryAsync(reader, item.zipEntry);
    entries.push({
      kind: "copy-through",
      entry: { ...item.zipEntry, localHeaderOffset: 0 },
      archiveBytes: rawBytes,
    } as ZipWriteEntry);
  }

  return entries;
}

// ---- XML part serialization -----------------------------------------------

function getXmlPartBytes(
  part: XmlPart,
  session: PackageSession,
): Uint8Array {
  // Full tree available (hydrated or mutated): serialize from it
  if (part.treeState.kind === "fully-hydrated" || part.treeState.kind === "mutated") {
    const xmlString = serializeXmlDocument(part.treeState.tree);
    return new TextEncoder().encode(xmlString);
  }

  // If partially hydrated, splice modified regions into original bytes
  if (part.treeState.kind === "partially-hydrated" && part.originalBytes) {
    return spliceRegions(part.originalBytes, part.treeState.hydratedRegions);
  }

  // Fall back to generic byte resolution (handles originalBytes,
  // materialized, generated, and archive-slice sources).
  return resolvePartBytes(part, session);
}

/**
 * Splice dirty hydrated regions into original bytes.
 *
 * Only regions with the `dirty` flag are serialized and spliced.
 * Read-only hydrated regions are left as their original bytes,
 * preserving lexical fidelity. Processes regions from back-to-front
 * so earlier offsets remain valid.
 */
function spliceRegions(
  originalBytes: Uint8Array,
  regions: HydratedRegionIndex,
): Uint8Array {
  // Only splice regions that were actually mutated
  const dirtyRegions = [...regions.values()].filter((r) => r.dirty);
  if (dirtyRegions.length === 0) return originalBytes;

  // Sort by startByte descending so splicing doesn't shift earlier offsets
  dirtyRegions.sort((a, b) => b.span.startByte - a.span.startByte);

  let result = originalBytes;
  for (const region of dirtyRegions) {
    const serialized = new TextEncoder().encode(
      region.tree.map((n) => serializeNode(n)).join(""),
    );
    result = spliceBytes(
      result,
      region.span.startByte,
      region.span.endByte,
      serialized,
    );
  }
  return result;
}

/** Replace bytes[start..end) with replacement. */
function spliceBytes(
  source: Uint8Array,
  start: number,
  end: number,
  replacement: Uint8Array,
): Uint8Array {
  const before = source.slice(0, start);
  const after = source.slice(end);
  const result = new Uint8Array(before.length + replacement.length + after.length);
  result.set(before, 0);
  result.set(replacement, before.length);
  result.set(after, before.length + replacement.length);
  return result;
}
