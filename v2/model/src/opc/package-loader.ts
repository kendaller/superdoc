// ---------------------------------------------------------------------------
// OPC package loader — fast-open path
//
// Parses the ZIP archive, builds content types and relationships,
// and creates lazy PackagePart descriptors for all entries.
// ---------------------------------------------------------------------------

import type { ZipSnapshot, ZipEntrySnapshot } from "../types/zip.js";
import type {
  ArchiveByteSource,
  AsyncArchiveReader,
  ContentTypesModel,
  PackagePart,
  PartUri,
  RelationshipIndex,
  XmlPart,
  BinaryPart,
} from "../types/package.js";
import type { SessionDiagnostic } from "../types/session.js";
import {
  parseZipSnapshot,
  parseZipSnapshotAsync,
  inflateEntry,
  inflateEntryAsync,
} from "./zip-reader.js";
import { parseContentTypes, resolveContentType } from "./content-types.js";
import {
  parseRelationships,
  createRelationshipIndex,
  findRelationshipsByType,
  REL_TYPES,
} from "./relationships.js";

// ---- Public result type ---------------------------------------------------

export type FastOpenResult = {
  zip: ZipSnapshot;
  parts: Map<PartUri, PackagePart>;
  contentTypes: ContentTypesModel;
  relationships: RelationshipIndex;
  mainDocumentUri: PartUri;
  diagnostics: SessionDiagnostic[];
};

// ---- Shared helpers -------------------------------------------------------

/** Build a name → entry lookup map from the ZIP snapshot. */
function buildEntryLookup(zip: ZipSnapshot): Map<string, ZipEntrySnapshot> {
  const entryByName = new Map<string, ZipEntrySnapshot>();
  for (const entry of zip.entries) {
    entryByName.set(entry.name, entry);
  }
  return entryByName;
}

/** Validate that the required metadata entries exist and return them. */
function validateMetadataEntries(entryByName: Map<string, ZipEntrySnapshot>): {
  contentTypesEntry: ZipEntrySnapshot;
  rootRelsEntry: ZipEntrySnapshot;
} {
  const contentTypesEntry = entryByName.get("[Content_Types].xml");
  if (!contentTypesEntry) {
    throw new Error("Missing required [Content_Types].xml in package");
  }

  const rootRelsEntry = entryByName.get("_rels/.rels");
  if (!rootRelsEntry) {
    throw new Error("Missing required _rels/.rels in package");
  }

  return { contentTypesEntry, rootRelsEntry };
}

/** Resolve the main document part URI from the package-level relationships. */
function resolveMainDocumentUri(
  relationships: RelationshipIndex,
): PartUri {
  const docRels = findRelationshipsByType(
    relationships.packageRelationships,
    REL_TYPES.officeDocument,
  );
  if (docRels.length === 0) {
    throw new Error(
      "Could not resolve main document part — no officeDocument relationship found",
    );
  }
  return normalizePartUri(docRels[0].target);
}

/**
 * Parse all part-level .rels files and populate the relationship index.
 *
 * `inflateToString` is the only point of divergence between sync/async —
 * the caller provides the appropriate inflate+decode strategy.
 */
function buildPartRelationships(
  zip: ZipSnapshot,
  relationships: RelationshipIndex,
  inflateToString: (entry: ZipEntrySnapshot) => string,
  diagnostics: SessionDiagnostic[],
): void {
  for (const entry of zip.entries) {
    if (isRelationshipPart(entry.name)) {
      const ownerUri = getRelationshipOwner(entry.name);
      if (ownerUri && entry.name !== "_rels/.rels") {
        try {
          const xml = inflateToString(entry);
          const rels = parseRelationships(xml);
          relationships.partRelationships.set(normalizePartUri(ownerUri), rels);
        } catch (err) {
          diagnostics.push({
            code: "RELS_PARSE_ERROR",
            severity: "warning",
            stage: "fast-open",
            message: `Failed to parse relationships: ${entry.name} — ${err}`,
            partUri: normalizePartUri(ownerUri),
          });
        }
      }
    }
  }
}

/**
 * Async variant of part-level .rels parsing.
 *
 * Kept separate because the inflate callback is async and we must await
 * each entry sequentially (entries may share underlying read state).
 */
async function buildPartRelationshipsAsync(
  zip: ZipSnapshot,
  relationships: RelationshipIndex,
  inflateToString: (entry: ZipEntrySnapshot) => Promise<string>,
  diagnostics: SessionDiagnostic[],
): Promise<void> {
  for (const entry of zip.entries) {
    if (isRelationshipPart(entry.name)) {
      const ownerUri = getRelationshipOwner(entry.name);
      if (ownerUri && entry.name !== "_rels/.rels") {
        try {
          const xml = await inflateToString(entry);
          const rels = parseRelationships(xml);
          relationships.partRelationships.set(normalizePartUri(ownerUri), rels);
        } catch (err) {
          diagnostics.push({
            code: "RELS_PARSE_ERROR",
            severity: "warning",
            stage: "fast-open",
            message: `Failed to parse relationships: ${entry.name} — ${err}`,
            partUri: normalizePartUri(ownerUri),
          });
        }
      }
    }
  }
}

/** Create lazy PackagePart descriptors for all content entries. */
function buildPackageParts(
  zip: ZipSnapshot,
  contentTypes: ContentTypesModel,
  diagnostics: SessionDiagnostic[],
): Map<PartUri, PackagePart> {
  const parts = new Map<PartUri, PackagePart>();

  for (const entry of zip.entries) {
    // Skip relationship parts and [Content_Types].xml — they are metadata
    if (isRelationshipPart(entry.name) || entry.name === "[Content_Types].xml") {
      continue;
    }

    const uri = normalizePartUri(entry.name);
    const ct = resolveContentType(contentTypes, uri);

    if (!ct) {
      diagnostics.push({
        code: "UNKNOWN_CONTENT_TYPE",
        severity: "warning",
        stage: "fast-open",
        message: `No content type found for "${uri}"`,
        partUri: uri,
      });
    }

    const isXml = isXmlContentType(ct);

    if (isXml) {
      const part: XmlPart = {
        kind: "xml",
        uri,
        contentType: ct ?? "application/xml",
        source: { kind: "archive-slice", entryId: entry.entryId },
        treeState: { kind: "indexed-only" },
        dirty: false,
      };
      parts.set(uri, part);
    } else {
      const part: BinaryPart = {
        kind: "binary",
        uri,
        contentType: ct ?? "application/octet-stream",
        source: { kind: "archive-slice", entryId: entry.entryId },
        dirty: false,
      };
      parts.set(uri, part);
    }
  }

  return parts;
}

// ---- Shared fast-open orchestration ----------------------------------------

/** Validated metadata required for the fast-open path. */
type FastOpenMetadata = {
  contentTypesEntry: ZipEntrySnapshot;
  rootRelsEntry: ZipEntrySnapshot;
  diagnostics: SessionDiagnostic[];
};

/** Steps 2: validate ZIP metadata entries. Shared by sync and async paths. */
function prepareFastOpen(zip: ZipSnapshot): FastOpenMetadata {
  const entryByName = buildEntryLookup(zip);
  const { contentTypesEntry, rootRelsEntry } = validateMetadataEntries(entryByName);
  return { contentTypesEntry, rootRelsEntry, diagnostics: [] };
}

/** Steps 5–7: resolve main doc, build parts. Shared by sync and async paths. */
function finalizeFastOpen(
  zip: ZipSnapshot,
  contentTypes: ContentTypesModel,
  relationships: RelationshipIndex,
  diagnostics: SessionDiagnostic[],
): FastOpenResult {
  const mainDocumentUri = resolveMainDocumentUri(relationships);
  const parts = buildPackageParts(zip, contentTypes, diagnostics);
  return { zip, parts, contentTypes, relationships, mainDocumentUri, diagnostics };
}

// ---- Public API -----------------------------------------------------------

/** Execute the fast-open path: ZIP parse → OPC metadata → lazy part descriptors. */
export function fastOpen(source: ArchiveByteSource): FastOpenResult {
  if (source.kind !== "memory") {
    throw new Error(
      `ArchiveByteSource kind "${source.kind}" not yet supported — only "memory" is implemented`,
    );
  }

  const bytes = source.bytes;
  const zip = parseZipSnapshot(bytes);
  const { contentTypesEntry, rootRelsEntry, diagnostics } = prepareFastOpen(zip);

  const inflateToString = (entry: ZipEntrySnapshot): string =>
    inflateAndDecode(bytes, entry);

  const contentTypes = parseContentTypes(inflateToString(contentTypesEntry));
  const relationships = createRelationshipIndex();
  relationships.packageRelationships = parseRelationships(inflateToString(rootRelsEntry));
  buildPartRelationships(zip, relationships, inflateToString, diagnostics);

  return finalizeFastOpen(zip, contentTypes, relationships, diagnostics);
}

/**
 * Async fast-open path for Blob/range-reader sources.
 * Reads only the zip central directory and metadata entries — no content parts.
 */
export async function fastOpenAsync(reader: AsyncArchiveReader): Promise<FastOpenResult> {
  const zip = await parseZipSnapshotAsync(reader);
  const { contentTypesEntry, rootRelsEntry, diagnostics } = prepareFastOpen(zip);

  const inflateToString = async (entry: ZipEntrySnapshot): Promise<string> =>
    new TextDecoder("utf-8").decode(await inflateEntryAsync(reader, entry));

  const contentTypes = parseContentTypes(await inflateToString(contentTypesEntry));
  const relationships = createRelationshipIndex();
  relationships.packageRelationships = parseRelationships(await inflateToString(rootRelsEntry));
  await buildPartRelationshipsAsync(zip, relationships, inflateToString, diagnostics);

  return finalizeFastOpen(zip, contentTypes, relationships, diagnostics);
}

// ---- Entry access helpers -------------------------------------------------

/** Inflate a ZIP entry and decode its bytes as UTF-8 text. */
function inflateAndDecode(bytes: Uint8Array, entry: ZipEntrySnapshot): string {
  const raw = inflateEntry(bytes, entry);
  return new TextDecoder("utf-8").decode(raw);
}

/** Get the raw bytes for a ZIP entry (for the package loader to resolve ByteSource). */
export function resolveEntryBytes(
  archiveBytes: Uint8Array,
  zip: ZipSnapshot,
  entryId: string,
): Uint8Array {
  const entry = zip.entryById.get(entryId);
  if (!entry) throw new Error(`ZIP entry not found: ${entryId}`);
  return inflateEntry(archiveBytes, entry);
}

// ---- Internals ------------------------------------------------------------

function normalizePartUri(uri: string): PartUri {
  const normalized = uri.startsWith("/") ? uri : "/" + uri;
  return normalized;
}

function isRelationshipPart(name: string): boolean {
  return name.endsWith(".rels") && name.includes("_rels/");
}

/**
 * Derive the owner part URI from a relationship part path.
 * E.g., "word/_rels/document.xml.rels" → "word/document.xml"
 */
function getRelationshipOwner(relsPath: string): string | undefined {
  // Pattern: {dir}/_rels/{filename}.rels → {dir}/{filename}
  const match = relsPath.match(/^(.*)_rels\/(.+)\.rels$/);
  if (!match) return undefined;
  return match[1] + match[2];
}

function isXmlContentType(ct: string | undefined): boolean {
  if (!ct) return false;
  return ct.endsWith("+xml") || ct.endsWith("/xml") || ct.startsWith("application/xml");
}
