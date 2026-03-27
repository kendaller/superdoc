// ---------------------------------------------------------------------------
// Custom ZIP central-directory reader
//
// Parses the ZIP central directory to build a ZipSnapshot with full metadata.
// Entry payloads are NOT inflated here — that happens lazily via inflateEntry.
// ---------------------------------------------------------------------------

import { inflateSync } from "fflate";
import type { ZipSnapshot, ZipEntrySnapshot } from "../types/zip.js";
import type { AsyncArchiveReader } from "../types/package.js";

// ---- ZIP format constants -------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;
const CD_ENTRY_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

// ---- Public API -----------------------------------------------------------

/** Parse the ZIP central directory from raw archive bytes (synchronous). */
export function parseZipSnapshot(bytes: Uint8Array): ZipSnapshot {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes, view);
  const { entryCount, centralDirOffset, archiveComment } =
    parseEocd(bytes, view, eocd);

  return parseCentralDirectory(bytes, view, centralDirOffset, entryCount, archiveComment);
}

/** Inflate (decompress) a single entry's payload from the archive bytes. */
export function inflateEntry(
  bytes: Uint8Array,
  entry: ZipEntrySnapshot,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { dataStart } = readLocalHeader(view, entry.localHeaderOffset);
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  return decompressPayload(compressed, entry);
}

// ---- Async (Blob/range-reader) variants -----------------------------------

/**
 * Parse the ZIP central directory from an async reader.
 * Only reads the archive tail (~64KB) and the central directory range —
 * no entry payloads are touched.
 */
export async function parseZipSnapshotAsync(
  reader: AsyncArchiveReader,
): Promise<ZipSnapshot> {
  // Read the tail to locate EOCD
  const tailSize = Math.min(reader.size, EOCD_MIN_SIZE + EOCD_MAX_COMMENT);
  const tailStart = reader.size - tailSize;
  const tailBytes = await reader.read(tailStart, reader.size);
  const tailView = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength);

  const eocdRel = findEndOfCentralDirectory(tailBytes, tailView);
  const { entryCount, centralDirOffset, archiveComment } =
    parseEocd(tailBytes, tailView, eocdRel);

  // Resolve central directory bytes (may overlap with our tail buffer)
  let cdBytes: Uint8Array;
  let cdBase: number;

  if (centralDirOffset >= tailStart) {
    cdBytes = tailBytes;
    cdBase = tailStart;
  } else {
    cdBytes = await reader.read(centralDirOffset, reader.size);
    cdBase = centralDirOffset;
  }

  const cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);
  const relativeOffset = centralDirOffset - cdBase;

  return parseCentralDirectory(cdBytes, cdView, relativeOffset, entryCount, archiveComment, cdBase);
}

/**
 * Inflate a single entry by reading only that entry's bytes from an async reader.
 * Reads the local header (~30 bytes), then the compressed payload — nothing else.
 */
export async function inflateEntryAsync(
  reader: AsyncArchiveReader,
  entry: ZipEntrySnapshot,
): Promise<Uint8Array> {
  const headerBytes = await reader.read(
    entry.localHeaderOffset,
    entry.localHeaderOffset + LOCAL_HEADER_SIZE,
  );
  const hv = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  const { dataStart } = readLocalHeader(hv, 0, entry.localHeaderOffset);

  const compressed = await reader.read(dataStart, dataStart + entry.compressedSize);
  return decompressPayload(compressed, entry);
}

/**
 * Read the raw local file header + data for a single entry from an async reader.
 * Used for copy-through in save — returns the raw bytes (no inflation).
 */
export async function readRawEntryAsync(
  reader: AsyncArchiveReader,
  entry: ZipEntrySnapshot,
): Promise<Uint8Array> {
  const headerBytes = await reader.read(
    entry.localHeaderOffset,
    entry.localHeaderOffset + LOCAL_HEADER_SIZE,
  );
  const hv = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  const localNameLen = hv.getUint16(26, true);
  const localExtraLen = hv.getUint16(28, true);
  const totalSize = LOCAL_HEADER_SIZE + localNameLen + localExtraLen + entry.compressedSize;

  return reader.read(entry.localHeaderOffset, entry.localHeaderOffset + totalSize);
}

// ---- Shared parsing -------------------------------------------------------

type EocdData = {
  entryCount: number;
  centralDirOffset: number;
  archiveComment?: Uint8Array;
};

/** Extract EOCD fields from the bytes at the given offset. */
function parseEocd(
  bytes: Uint8Array,
  view: DataView,
  eocdOffset: number,
): EocdData {
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const commentLength = view.getUint16(eocdOffset + 20, true);
  const archiveComment =
    commentLength > 0
      ? bytes.slice(eocdOffset + EOCD_MIN_SIZE, eocdOffset + EOCD_MIN_SIZE + commentLength)
      : undefined;

  return { entryCount, centralDirOffset, archiveComment };
}

/**
 * Parse all central directory entries starting at `startOffset` within `bytes`.
 *
 * @param absoluteBase - When parsing from a sub-buffer (async path), the
 *   absolute archive offset that byte 0 of `bytes` corresponds to. Used
 *   to compute correct `centralDirectoryOffset` values. Defaults to 0.
 */
function parseCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
  startOffset: number,
  entryCount: number,
  archiveComment: Uint8Array | undefined,
  absoluteBase = 0,
): ZipSnapshot {
  const entries: ZipEntrySnapshot[] = [];
  const entryOrder: string[] = [];
  const entryById = new Map<string, ZipEntrySnapshot>();
  let offset = startOffset;

  for (let i = 0; i < entryCount; i++) {
    const sig = view.getUint32(offset, true);
    if (sig !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(
        `Invalid central directory signature at offset ${offset}: 0x${sig.toString(16)}`,
      );
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameBytes = bytes.slice(
      offset + CD_ENTRY_HEADER_SIZE,
      offset + CD_ENTRY_HEADER_SIZE + nameLength,
    );
    const name = new TextDecoder().decode(nameBytes);

    const extraFields =
      extraLength > 0
        ? bytes.slice(
            offset + CD_ENTRY_HEADER_SIZE + nameLength,
            offset + CD_ENTRY_HEADER_SIZE + nameLength + extraLength,
          )
        : undefined;

    const comment =
      commentLen > 0
        ? bytes.slice(
            offset + CD_ENTRY_HEADER_SIZE + nameLength + extraLength,
            offset + CD_ENTRY_HEADER_SIZE + nameLength + extraLength + commentLen,
          )
        : undefined;

    const entryId = `entry:${i}:${name}`;
    const entry: ZipEntrySnapshot = {
      entryId,
      name,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      centralDirectoryOffset: absoluteBase + offset,
      comment,
      extraFields,
    };

    entries.push(entry);
    entryOrder.push(entryId);
    entryById.set(entryId, entry);

    offset += CD_ENTRY_HEADER_SIZE + nameLength + extraLength + commentLen;
  }

  return { entries, entryOrder, entryById, archiveComment };
}

// ---- Local header reading -------------------------------------------------

type LocalHeaderInfo = {
  dataStart: number;
};

/**
 * Read a local file header and return the data start offset.
 *
 * @param viewOffset - The offset within the DataView where the header starts.
 *   Defaults to localHeaderOffset.
 * @param absoluteOffset - The absolute archive offset of the header.
 *   Used in the returned dataStart. Defaults to viewOffset.
 */
function readLocalHeader(
  view: DataView,
  viewOffset: number,
  absoluteOffset?: number,
): LocalHeaderInfo {
  const absOff = absoluteOffset ?? viewOffset;
  const sig = view.getUint32(viewOffset, true);
  if (sig !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(
      `Invalid local header signature at offset ${absOff}: 0x${sig.toString(16)}`,
    );
  }
  const localNameLength = view.getUint16(viewOffset + 26, true);
  const localExtraLength = view.getUint16(viewOffset + 28, true);
  return { dataStart: absOff + LOCAL_HEADER_SIZE + localNameLength + localExtraLength };
}

// ---- Decompression --------------------------------------------------------

function decompressPayload(
  compressed: Uint8Array,
  entry: ZipEntrySnapshot,
): Uint8Array {
  if (entry.compressionMethod === 0) return compressed.slice();
  if (entry.compressionMethod === 8) return inflateSync(compressed);

  throw new Error(
    `Unsupported compression method ${entry.compressionMethod} for entry "${entry.name}"`,
  );
}

// ---- EOCD search ----------------------------------------------------------

/** Scan backwards from the end of the archive to find the EOCD signature. */
function findEndOfCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
): number {
  const maxScan = Math.min(bytes.length, EOCD_MIN_SIZE + EOCD_MAX_COMMENT);
  const searchStart = bytes.length - EOCD_MIN_SIZE;

  for (let i = searchStart; i >= bytes.length - maxScan; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      return i;
    }
  }

  throw new Error("Could not find ZIP end-of-central-directory record");
}
