// ---------------------------------------------------------------------------
// Custom ZIP writer
//
// Supports two modes:
//   1. Copy-through: reuse original compressed bytes for unchanged entries
//   2. New entry: deflate and write fresh bytes for dirty/new parts
//
// Produces a valid ZIP archive with central directory and EOCD.
// ---------------------------------------------------------------------------

import { deflateSync } from "fflate";
import type { ZipEntrySnapshot } from "../types/zip.js";

// ---- ZIP format constants -------------------------------------------------

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const CD_ENTRY_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const EOCD_SIZE = 22;
const ZIP_VERSION = 20;

// ---- Public types ---------------------------------------------------------

export type ZipWriteEntry =
  | ZipCopyThroughEntry
  | ZipNewEntry;

/** Reuse original compressed bytes from the source archive. */
export type ZipCopyThroughEntry = {
  kind: "copy-through";
  entry: ZipEntrySnapshot;
  /** The full original archive bytes (we slice from localHeaderOffset). */
  archiveBytes: Uint8Array;
};

/** Write new (or modified) uncompressed bytes. */
export type ZipNewEntry = {
  kind: "new";
  name: string;
  uncompressedBytes: Uint8Array;
  compress?: boolean;
};

// ---- Public API -----------------------------------------------------------

/** Build a complete ZIP archive from a list of write entries. */
export function buildZipArchive(
  entries: ZipWriteEntry[],
  archiveComment?: Uint8Array,
): Uint8Array {
  const localRecords: LocalRecord[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const record = buildLocalRecord(entry, offset);
    localRecords.push(record);
    chunks.push(record.bytes!);
    offset += record.bytes!.length;
  }

  const centralDirOffset = offset;
  for (const record of localRecords) {
    const cdEntry = buildCentralDirectoryEntry(record);
    chunks.push(cdEntry);
    offset += cdEntry.length;
  }

  const centralDirSize = offset - centralDirOffset;
  chunks.push(buildEocd(localRecords.length, centralDirSize, centralDirOffset, archiveComment));

  return concatUint8Arrays(chunks);
}

/**
 * Build a ZIP archive as a pull-based ReadableStream.
 *
 * Entries are written one at a time — only one entry's data is held
 * in memory at a time, plus the small per-entry metadata needed for the
 * central directory written at the end.
 */
export function buildZipArchiveStream(
  entries: ZipWriteEntry[],
  archiveComment?: Uint8Array,
): ReadableStream<Uint8Array> {
  return buildStream(entries.length, (i) => entries[i], archiveComment);
}

/**
 * Build a ZIP archive as a pull-based ReadableStream with async entry resolution.
 *
 * Unlike `buildZipArchiveStream`, entries are not pre-collected — the
 * `resolveEntry` callback is invoked once per pull, so only one entry's
 * payload is in memory at a time.
 */
export function buildZipArchiveStreamAsync(
  entryCount: number,
  resolveEntry: (index: number) => Promise<ZipWriteEntry>,
  archiveComment?: Uint8Array,
): ReadableStream<Uint8Array> {
  return buildStream(entryCount, resolveEntry, archiveComment);
}

// ---- Shared stream builder ------------------------------------------------

/**
 * Shared ReadableStream builder used by both sync and async variants.
 * The `resolveEntry` callback can return a value or a Promise — the
 * pull() handler awaits it either way.
 */
function buildStream(
  entryCount: number,
  resolveEntry: (index: number) => ZipWriteEntry | Promise<ZipWriteEntry>,
  archiveComment?: Uint8Array,
): ReadableStream<Uint8Array> {
  const localRecords: LocalRecord[] = [];
  let entryIdx = 0;
  let offset = 0;
  let phase: "entries" | "central-dir" | "done" = "entries";
  let cdIdx = 0;
  let centralDirOffset = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === "entries") {
        if (entryIdx < entryCount) {
          const entry = await resolveEntry(entryIdx++);
          const record = buildLocalRecord(entry, offset);
          localRecords.push(record);
          offset += record.bytes!.length;
          controller.enqueue(record.bytes!);
          // Release payload bytes — central directory only needs metadata
          record.bytes = undefined;
        } else {
          centralDirOffset = offset;
          phase = "central-dir";
        }
      }

      if (phase === "central-dir") {
        if (cdIdx < localRecords.length) {
          const cdEntry = buildCentralDirectoryEntry(localRecords[cdIdx++]);
          offset += cdEntry.length;
          controller.enqueue(cdEntry);
        } else {
          const centralDirSize = offset - centralDirOffset;
          controller.enqueue(buildEocd(localRecords.length, centralDirSize, centralDirOffset, archiveComment));
          controller.close();
          phase = "done";
        }
      }
    },
  });
}

// ---- Local record types ---------------------------------------------------

type LocalRecord = {
  name: string;
  nameBytes: Uint8Array;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  extraFields?: Uint8Array;
  comment?: Uint8Array;
  /** Raw local-header + payload bytes. Cleared to `undefined` in the stream
   *  path after enqueueing, to release memory before the central directory. */
  bytes: Uint8Array | undefined;
};

// ---- Local record builder -------------------------------------------------

function buildLocalRecord(entry: ZipWriteEntry, offset: number): LocalRecord {
  return entry.kind === "copy-through"
    ? buildCopyThroughLocal(entry, offset)
    : buildNewLocal(entry, offset);
}

function buildCopyThroughLocal(
  entry: ZipCopyThroughEntry,
  offset: number,
): LocalRecord {
  const { archiveBytes, entry: snap } = entry;
  const view = new DataView(
    archiveBytes.buffer,
    archiveBytes.byteOffset,
    archiveBytes.byteLength,
  );

  const localNameLen = view.getUint16(snap.localHeaderOffset + 26, true);
  const localExtraLen = view.getUint16(snap.localHeaderOffset + 28, true);
  const localTotalSize =
    LOCAL_HEADER_SIZE + localNameLen + localExtraLen + snap.compressedSize;

  const localBytes = archiveBytes.slice(
    snap.localHeaderOffset,
    snap.localHeaderOffset + localTotalSize,
  );

  return {
    name: snap.name,
    nameBytes: new TextEncoder().encode(snap.name),
    compressionMethod: snap.compressionMethod,
    crc32: snap.crc32,
    compressedSize: snap.compressedSize,
    uncompressedSize: snap.uncompressedSize,
    localHeaderOffset: offset,
    extraFields: snap.extraFields,
    comment: snap.comment,
    bytes: localBytes,
  };
}

function buildNewLocal(entry: ZipNewEntry, offset: number): LocalRecord {
  const { name, uncompressedBytes } = entry;
  const shouldCompress = entry.compress !== false;

  const crc32 = computeCrc32(uncompressedBytes);
  let compressedBytes: Uint8Array;
  let compressionMethod: number;

  if (shouldCompress && uncompressedBytes.length > 0) {
    compressedBytes = deflateSync(uncompressedBytes);
    // Only use deflate if it actually saves space
    if (compressedBytes.length < uncompressedBytes.length) {
      compressionMethod = 8;
    } else {
      compressedBytes = uncompressedBytes;
      compressionMethod = 0;
    }
  } else {
    compressedBytes = uncompressedBytes;
    compressionMethod = 0;
  }

  const nameBytes = new TextEncoder().encode(name);
  const headerSize = LOCAL_HEADER_SIZE + nameBytes.length;
  const totalSize = headerSize + compressedBytes.length;
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true);      // version needed
  view.setUint16(6, 0, true);                // general purpose flags
  view.setUint16(8, compressionMethod, true);
  view.setUint16(10, 0, true);               // last mod time
  view.setUint16(12, 0, true);               // last mod date
  view.setUint32(14, crc32, true);
  view.setUint32(18, compressedBytes.length, true);
  view.setUint32(22, uncompressedBytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);               // extra field length

  bytes.set(nameBytes, LOCAL_HEADER_SIZE);
  bytes.set(compressedBytes, headerSize);

  return {
    name,
    nameBytes,
    compressionMethod,
    crc32,
    compressedSize: compressedBytes.length,
    uncompressedSize: uncompressedBytes.length,
    localHeaderOffset: offset,
    bytes,
  };
}

// ---- Central directory ----------------------------------------------------

function buildCentralDirectoryEntry(record: LocalRecord): Uint8Array {
  const extraLen = record.extraFields?.length ?? 0;
  const commentLen = record.comment?.length ?? 0;
  const size = CD_ENTRY_HEADER_SIZE + record.nameBytes.length + extraLen + commentLen;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, CENTRAL_DIR_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true);       // version made by
  view.setUint16(6, ZIP_VERSION, true);       // version needed
  view.setUint16(8, 0, true);                 // general purpose flags
  view.setUint16(10, record.compressionMethod, true);
  view.setUint16(12, 0, true);                // last mod time
  view.setUint16(14, 0, true);                // last mod date
  view.setUint32(16, record.crc32, true);
  view.setUint32(20, record.compressedSize, true);
  view.setUint32(24, record.uncompressedSize, true);
  view.setUint16(28, record.nameBytes.length, true);
  view.setUint16(30, extraLen, true);
  view.setUint16(32, commentLen, true);
  view.setUint16(34, 0, true);                // disk number start
  view.setUint16(36, 0, true);                // internal file attributes
  view.setUint32(38, 0, true);                // external file attributes
  view.setUint32(42, record.localHeaderOffset, true);

  bytes.set(record.nameBytes, CD_ENTRY_HEADER_SIZE);
  if (record.extraFields) {
    bytes.set(record.extraFields, CD_ENTRY_HEADER_SIZE + record.nameBytes.length);
  }
  if (record.comment) {
    bytes.set(record.comment, CD_ENTRY_HEADER_SIZE + record.nameBytes.length + extraLen);
  }

  return bytes;
}

// ---- EOCD -----------------------------------------------------------------

function buildEocd(
  entryCount: number,
  centralDirSize: number,
  centralDirOffset: number,
  archiveComment?: Uint8Array,
): Uint8Array {
  const commentLen = archiveComment?.length ?? 0;
  const bytes = new Uint8Array(EOCD_SIZE + commentLen);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, EOCD_SIGNATURE, true);
  view.setUint16(4, 0, true);  // disk number
  view.setUint16(6, 0, true);  // disk with central dir
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirSize, true);
  view.setUint32(16, centralDirOffset, true);
  view.setUint16(20, commentLen, true);

  if (archiveComment) {
    bytes.set(archiveComment, EOCD_SIZE);
  }

  return bytes;
}

// ---- CRC-32 ---------------------------------------------------------------

const CRC_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
}

function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- Utility --------------------------------------------------------------

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr.length;

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
