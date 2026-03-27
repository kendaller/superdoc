// ---------------------------------------------------------------------------
// Hydration helper for the mutation engine
//
// Ensures an XML part is fully hydrated with a NodeIndex before mutation.
// Separated from engine.ts to avoid circular imports with ref-resolver.
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlPart } from "../types/package.js";
import { ensureHydrated } from "../word/view-base.js";
import { buildNodeIndex } from "./node-index.js";

/**
 * Ensure an XML part is fully hydrated and has a NodeIndex.
 * If already mutated, just ensure the index exists.
 * If partially or un-hydrated, fully hydrate first.
 */
export function ensureHydratedWithIndex(
  part: XmlPart,
  session: PackageSession,
): void {
  if (part.treeState.kind === "mutated") {
    if (!part.nodeIndex) {
      part.nodeIndex = buildNodeIndex(part.treeState.tree);
    }
    return;
  }

  // ensureHydrated transitions to "fully-hydrated" if not already
  ensureHydrated(part, session);

  if (!part.nodeIndex && part.treeState.kind === "fully-hydrated") {
    part.nodeIndex = buildNodeIndex(part.treeState.tree);
  }
}
