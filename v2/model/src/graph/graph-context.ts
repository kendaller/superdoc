// ---------------------------------------------------------------------------
// GraphContext factory — creates the session-level context for entity handles
//
// Element resolution uses a direct element cache keyed by entity ref ID,
// populated during graph construction. Each cache entry tracks the session
// revision at which it was stored, so entries from before a mutation are
// automatically treated as stale.
// ---------------------------------------------------------------------------

import type { SourceRef } from "../identity/types.js";
import type { XmlElementNode } from "../types/xml.js";
import type { PackageSession } from "../types/session.js";
import type { ExtractorRegistry } from "../extract/types.js";
import type { DiagnosticBag } from "../diagnostics/diagnostic-bag.js";
import type { GraphContext } from "./types.js";
import { ensureHydratedWithIndex } from "../mutations/engine-hydration.js";

/**
 * Create a GraphContext that provides lazy element resolution
 * and cache invalidation tied to the session's revision.
 */
export function createGraphContext(
  session: PackageSession,
  extractors: ExtractorRegistry,
  diagnostics: DiagnosticBag,
): GraphContext {
  // Entity-keyed element cache with per-entry revision tracking.
  const elementCache = new Map<string, XmlElementNode>();
  const elementCacheRevisions = new Map<string, string>();

  return {
    session,
    extractors,
    diagnostics,

    currentRevision(): string {
      return session.currentRevision;
    },

    cacheElement(entityRefId: string, element: XmlElementNode): void {
      elementCache.set(entityRefId, element);
      elementCacheRevisions.set(entityRefId, session.currentRevision);
    },

    resolveElementByEntityRef(
      entityRefId: string,
      sourceRef: SourceRef,
    ): XmlElementNode | undefined {
      // Per-entry revision check: only use if cached at current revision
      const cachedRev = elementCacheRevisions.get(entityRefId);
      if (cachedRev === session.currentRevision) {
        const cached = elementCache.get(entityRefId);
        if (cached) return cached;
      }

      // Fallback to generic resolution via nodeIndex
      return this.resolveElement(sourceRef);
    },

    resolveElement(sourceRef: SourceRef): XmlElementNode | undefined {
      const part = session.parts.get(sourceRef.partUri);
      if (!part || part.kind !== "xml") return undefined;

      ensureHydratedWithIndex(part, session);

      if (part.nodeIndex) {
        const node = part.nodeIndex.byId.get(sourceRef.nodeId);
        if (node && "localName" in node) {
          return node as XmlElementNode;
        }
      }

      return undefined;
    },

    clearElementCache(): void {
      elementCache.clear();
      elementCacheRevisions.clear();
    },
  };
}
