// ---------------------------------------------------------------------------
// EntityHandle — the lazy live view implementation
//
// Each entity handle is a stable object identified by its EntityRef. It
// lazily extracts raw properties from source XML, caching results keyed
// on the session's current revision for automatic invalidation.
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef } from "../identity/types.js";
import type { EntityKind, Entity, RawPropertiesForKind } from "../entities/types.js";
import type { GraphContext } from "./types.js";
import { entityScope } from "../diagnostics/types.js";

/**
 * Concrete implementation of a semantic entity.
 *
 * **Phase 2 lifetime contract:**
 * - Handles are valid within a single graph generation (between rebuilds)
 * - After `model.rebuild()`, all previously returned handles are stale —
 *   callers must re-query from the model using EntityRef IDs
 * - Cache EntityRef values (strings), not entity objects, if you need
 *   references that survive mutation + rebuild
 * - Stable live handles across mutations are a Phase 5+ concern
 *
 * **Within a generation:**
 * - Lazy extraction: raw properties are extracted on first access
 * - Cache invalidation: re-extracts when session revision advances
 */
export class EntityHandle<K extends EntityKind> implements Entity<K> {
  readonly ref: EntityRef;
  readonly kind: K;
  readonly sourceRefs: readonly SourceRef[];
  readonly storyId: string | undefined;
  readonly parentRef: EntityRef | undefined;

  private _childRefList: EntityRef[];
  private _cachedRaw: RawPropertiesForKind[K] | undefined;
  private _rawRevision: string | undefined;
  private _deleted = false;
  private readonly _ctx: GraphContext;
  private readonly _rawOverride: RawPropertiesForKind[K] | undefined;

  constructor(
    ref: EntityRef,
    kind: K,
    sourceRefs: readonly SourceRef[],
    storyId: string | undefined,
    parentRef: EntityRef | undefined,
    ctx: GraphContext,
    rawOverride?: RawPropertiesForKind[K],
  ) {
    this.ref = ref;
    this.kind = kind;
    this.sourceRefs = sourceRefs;
    this.storyId = storyId;
    this.parentRef = parentRef;
    this._childRefList = [];
    this._ctx = ctx;
    this._rawOverride = rawOverride;
  }

  raw(): RawPropertiesForKind[K] {
    if (this._deleted) {
      throw new Error(`Entity ${this.ref.id} has been deleted`);
    }

    if (this._rawOverride !== undefined) {
      return this._rawOverride;
    }

    const currentRev = this._ctx.currentRevision();
    if (this._cachedRaw !== undefined && this._rawRevision === currentRev) {
      return this._cachedRaw;
    }

    const extractor = this._ctx.extractors.get(this.kind);
    if (!extractor) {
      // Thin entity — return empty object
      this._cachedRaw = {} as RawPropertiesForKind[K];
      this._rawRevision = currentRev;
      return this._cachedRaw;
    }

    const element = this._ctx.resolveElementByEntityRef(this.ref.id, this.sourceRefs[0]);
    if (!element) {
      this._ctx.diagnostics.warning(
        "EXTRACTION_ERROR",
        entityScope(this.ref),
        `Could not resolve source element for ${this.kind} entity ${this.ref.id}`,
      );
      this._cachedRaw = {} as RawPropertiesForKind[K];
      this._rawRevision = currentRev;
      return this._cachedRaw;
    }

    this._cachedRaw = extractor(element) as RawPropertiesForKind[K];
    this._rawRevision = currentRev;
    return this._cachedRaw;
  }

  childRefs(): readonly EntityRef[] {
    return this._childRefList;
  }

  isDeleted(): boolean {
    return this._deleted;
  }

  /** @internal — used by graph construction to add children. */
  addChildRef(childRef: EntityRef): void {
    this._childRefList.push(childRef);
  }

  /** @internal — used by graph construction to set children in bulk. */
  setChildRefs(refs: EntityRef[]): void {
    this._childRefList = refs;
  }

  /** @internal — mark as deleted when source XML is removed. */
  markDeleted(): void {
    this._deleted = true;
    this._cachedRaw = undefined;
  }

  /** @internal — invalidate cached raw properties (e.g., after mutation). */
  invalidateCache(): void {
    this._cachedRaw = undefined;
    this._rawRevision = undefined;
  }
}
