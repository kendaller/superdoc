// ---------------------------------------------------------------------------
// open() — public entry point
// ---------------------------------------------------------------------------

import type { DocumentHandle } from "../types/session.js";
import type { ArchiveByteSource, AsyncArchiveReader } from "../types/package.js";
import { createSession, createSessionAsync } from "./session.js";
import { createHandle } from "./handle.js";

/**
 * Open a .docx package and return a lightweight DocumentHandle.
 *
 * Accepts raw bytes (Uint8Array), a Blob, or a full ArchiveByteSource.
 *
 * - Uint8Array / memory source: parsed synchronously (fast-open).
 * - Blob / range-reader: only the zip central directory and metadata
 *   entries are read. Content parts are materialized lazily when
 *   ready("structure") is called.
 */
export async function open(
  source: Uint8Array | Blob | ArchiveByteSource,
): Promise<DocumentHandle> {
  // Uint8Array → synchronous memory path
  if (source instanceof Uint8Array) {
    const session = createSession({ kind: "memory", bytes: source });
    return createHandle(session);
  }

  // Blob (direct) → async lazy path
  if (source instanceof Blob) {
    const reader = createBlobReader(source);
    const archiveSource: ArchiveByteSource = { kind: "blob", blob: source, size: source.size };
    const session = await createSessionAsync(reader, archiveSource);
    return createHandle(session);
  }

  // ArchiveByteSource variants
  if (source.kind === "memory") {
    const session = createSession(source);
    return createHandle(session);
  }

  if (source.kind === "blob") {
    const reader = createBlobReader(source.blob);
    const session = await createSessionAsync(reader, source);
    return createHandle(session);
  }

  if (source.kind === "range-reader") {
    const reader: AsyncArchiveReader = {
      size: source.size,
      async read(start: number, end: number) {
        return source.read({ start, endExclusive: end });
      },
    };
    const session = await createSessionAsync(reader, source);
    return createHandle(session);
  }

  throw new Error(`Unsupported archive byte source`);
}

/** Create an AsyncArchiveReader from a Blob. */
function createBlobReader(blob: Blob): AsyncArchiveReader {
  return {
    size: blob.size,
    async read(start: number, end: number): Promise<Uint8Array> {
      const slice = blob.slice(start, end);
      return new Uint8Array(await slice.arrayBuffer());
    },
  };
}
