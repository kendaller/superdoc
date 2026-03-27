// ---------------------------------------------------------------------------
// EntityRef ID generator
//
// Produces deterministic, session-scoped entity IDs.
// Format: "e:{kind}:{index}" — e.g. "e:paragraph:0", "e:run:5"
// ---------------------------------------------------------------------------

import type { EntityRef } from "../identity/types.js";
import { createEntityRef } from "../identity/types.js";

/**
 * Session-scoped entity ref generator.
 * Each kind gets its own counter for human-readable, deterministic IDs.
 */
export class RefGenerator {
  private readonly _counters = new Map<string, number>();

  next(kind: string): EntityRef {
    const current = this._counters.get(kind) ?? 0;
    this._counters.set(kind, current + 1);
    return createEntityRef(`e:${kind}:${current}`);
  }

  reset(): void {
    this._counters.clear();
  }
}
