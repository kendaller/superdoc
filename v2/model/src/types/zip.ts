// ---------------------------------------------------------------------------
// ZIP archive types
// ---------------------------------------------------------------------------

/** Immutable snapshot of a ZIP archive's central directory. */
export type ZipSnapshot = {
  entries: ZipEntrySnapshot[];
  entryOrder: string[];
  /** O(1) entry lookup by entryId. */
  entryById: Map<string, ZipEntrySnapshot>;
  archiveComment?: Uint8Array;
};

/** Metadata for a single ZIP entry, captured from the central directory. */
export type ZipEntrySnapshot = {
  entryId: string;
  name: string;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  centralDirectoryOffset?: number;
  comment?: Uint8Array;
  extraFields?: Uint8Array;
};
