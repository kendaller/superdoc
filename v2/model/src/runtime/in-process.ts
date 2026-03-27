// ---------------------------------------------------------------------------
// In-process adapter — for Node/Bun CLI usage
//
// Uses the same conceptual handle/session contract but runs everything
// in-process without worker transport. This is the default for CLI usage.
// ---------------------------------------------------------------------------

import type { DocumentHandle } from "../types/session.js";
import type { ArchiveByteSource } from "../types/package.js";
import { open } from "../session/open.js";

/**
 * Open a document in-process.
 * This is simply a re-export of open() — but named to make the
 * architecture explicit and consistent with the worker path.
 */
export async function openInProcess(
  source: Uint8Array | Blob | ArchiveByteSource,
): Promise<DocumentHandle> {
  return open(source);
}
