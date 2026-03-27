// ---------------------------------------------------------------------------
// Part byte resolution — single source of truth for resolving raw bytes
// of a package part, regardless of how the session was opened.
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlPart, BinaryPart } from "../types/package.js";
import { getArchiveBytesIfAvailable } from "./session.js";
import { resolveEntryBytes } from "../opc/package-loader.js";
import { serializeXmlDocument } from "../xml/serializer.js";

const UTF8_ENCODER = new TextEncoder();

/**
 * Resolve the raw bytes for an XML part.
 *
 * Checks (in order): cached originalBytes, materialized/generated source,
 * archive-slice with in-memory archive. Throws if the part hasn't been
 * materialized on a lazy session.
 */
export function resolvePartBytes(
  part: XmlPart,
  session: PackageSession,
): Uint8Array {
  if (part.treeState.kind === "mutated") {
    return UTF8_ENCODER.encode(serializeXmlDocument(part.treeState.tree));
  }

  if (part.originalBytes) return part.originalBytes;

  if (part.source.kind === "materialized" || part.source.kind === "generated") {
    return part.source.bytes;
  }

  if (part.source.kind === "archive-slice") {
    const archiveBytes = getArchiveBytesIfAvailable(session);
    if (archiveBytes) {
      return resolveEntryBytes(archiveBytes, session.originalZip, part.source.entryId);
    }
    throw new Error(
      `Part ${part.uri} has not been materialized — ` +
      `call ready("structure") before accessing view data on lazy sessions`,
    );
  }

  throw new Error(`Cannot resolve bytes for part ${part.uri}`);
}

/**
 * Resolve bytes for a binary part.
 *
 * Returns undefined if the bytes cannot be resolved synchronously
 * (e.g. unmaterialized archive-slice on a lazy session).
 */
export function resolveBinaryPartBytes(
  part: BinaryPart,
  session: PackageSession,
): Uint8Array | undefined {
  if (part.materializedBytes) return part.materializedBytes;

  if (part.source.kind === "materialized") return part.source.bytes;
  if (part.source.kind === "generated") return part.source.bytes;

  if (part.source.kind === "archive-slice") {
    const archiveBytes = getArchiveBytesIfAvailable(session);
    if (archiveBytes) {
      return resolveEntryBytes(archiveBytes, session.originalZip, part.source.entryId);
    }
  }

  return undefined;
}
