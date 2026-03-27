// ---------------------------------------------------------------------------
// OPC package types
// ---------------------------------------------------------------------------

import type { XmlLexicalIndex, XmlTreeState, NodeIndex } from "./xml.js";

/** Opaque part URI string (e.g. "/word/document.xml"). */
export type PartUri = string;

// ---- Byte sources ---------------------------------------------------------

/** How the original archive bytes are provided to the engine. */
export type ArchiveByteSource =
  | { kind: "memory"; bytes: Uint8Array }
  | { kind: "blob"; blob: Blob; size: number }
  | {
      kind: "range-reader";
      size: number;
      read(range?: { start: number; endExclusive: number }): Promise<Uint8Array>;
    };

/**
 * Async random-access reader for an archive.
 * Used for lazy Blob/range-reader sources that avoid full materialization.
 */
export type AsyncArchiveReader = {
  readonly size: number;
  read(start: number, end: number): Promise<Uint8Array>;
};

/** Where a single part's bytes come from. */
export type ByteSource =
  | { kind: "archive-slice"; entryId: string }
  | { kind: "materialized"; bytes: Uint8Array }
  | { kind: "generated"; bytes: Uint8Array };

// ---- Package parts --------------------------------------------------------

export type PackagePart = XmlPart | BinaryPart;

export type XmlPart = {
  kind: "xml";
  uri: PartUri;
  contentType: string;
  source: ByteSource;
  originalBytes?: Uint8Array;
  lexicalIndex?: XmlLexicalIndex;
  treeState: XmlTreeState;
  dirty: boolean;
  /** Present when treeState is "fully-hydrated" or "mutated". */
  nodeIndex?: NodeIndex;
};

export type BinaryPart = {
  kind: "binary";
  uri: PartUri;
  contentType: string;
  source: ByteSource;
  originalBytes?: Uint8Array;
  materializedBytes?: Uint8Array;
  dirty: boolean;
};

// ---- Relationships --------------------------------------------------------

export type RelationshipIndex = {
  packageRelationships: Map<string, RelationshipRecord>;
  partRelationships: Map<PartUri, Map<string, RelationshipRecord>>;
};

export type RelationshipRecord = {
  id: string;
  type: string;
  target: string;
  targetMode?: "Internal" | "External";
};

// ---- Content types --------------------------------------------------------

export type ContentTypesModel = {
  defaults: Map<string, string>;
  overrides: Map<PartUri, string>;
};
