// ---------------------------------------------------------------------------
// EntityGraph — owns all entity handles and provides lookup
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef } from "../identity/types.js";
import type { Entity, EntityKind } from "../entities/types.js";
import { isStoryKind } from "../entities/types.js";
import type { EntityGraph as IEntityGraph } from "./types.js";

export class EntityGraphImpl implements IEntityGraph {
  private readonly _byRef = new Map<string, Entity>();
  private readonly _bySourceRef = new Map<string, EntityRef>();
  private readonly _byKind = new Map<EntityKind, Entity[]>();
  private readonly _storyRefs: EntityRef[] = [];

  get(ref: EntityRef): Entity | undefined {
    return this._byRef.get(ref.id);
  }

  getBySourceRef(sourceRef: SourceRef): Entity | undefined {
    const key = sourceRefKey(sourceRef);
    const ref = this._bySourceRef.get(key);
    return ref ? this._byRef.get(ref.id) : undefined;
  }

  allOfKind<K extends EntityKind>(kind: K): Entity<K>[] {
    return (this._byKind.get(kind) ?? []) as Entity<K>[];
  }

  storyRefs(): readonly EntityRef[] {
    return this._storyRefs;
  }

  size(): number {
    return this._byRef.size;
  }

  register(entity: Entity): void {
    this._byRef.set(entity.ref.id, entity);

    // Index by kind
    let kindList = this._byKind.get(entity.kind);
    if (!kindList) {
      kindList = [];
      this._byKind.set(entity.kind, kindList);
    }
    kindList.push(entity);

    // Track story refs
    if (isStoryKind(entity.kind)) {
      this._storyRefs.push(entity.ref);
    }
  }

  indexSourceRef(sourceRef: SourceRef, ref: EntityRef): void {
    this._bySourceRef.set(sourceRefKey(sourceRef), ref);
  }

  clear(): void {
    this._byRef.clear();
    this._bySourceRef.clear();
    this._byKind.clear();
    this._storyRefs.length = 0;
  }
}

function sourceRefKey(ref: SourceRef): string {
  return `${ref.partUri}#${ref.nodeId}`;
}
