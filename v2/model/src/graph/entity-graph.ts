// ---------------------------------------------------------------------------
// EntityGraph — owns all entity handles and provides lookup
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef } from '../identity/types.js';
import type { Entity, EntityKind } from '../entities/types.js';
import { isStoryKind } from '../entities/types.js';
import type { EntityGraph as IEntityGraph } from './types.js';

export class EntityGraphImpl implements IEntityGraph {
  private readonly _byRef = new Map<string, Entity>();
  private readonly _bySourceRefPath = new Map<string, EntityRef>();
  private readonly _bySourceRefExact = new Map<string, EntityRef>();
  private readonly _bySourceRefLoose = new Map<string, EntityRef>();
  private readonly _byKind = new Map<EntityKind, Entity[]>();
  private readonly _storyRefs: EntityRef[] = [];

  get(ref: EntityRef): Entity | undefined {
    return this._byRef.get(ref.id);
  }

  getBySourceRef(sourceRef: SourceRef): Entity | undefined {
    const ref =
      (sourceRef.sourceNodePath ? this._bySourceRefPath.get(sourceRefPathKey(sourceRef)) : undefined) ??
      this._bySourceRefExact.get(sourceRefExactKey(sourceRef)) ??
      this._bySourceRefLoose.get(sourceRefLooseKey(sourceRef));
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
    if (sourceRef.sourceNodePath) {
      this._bySourceRefPath.set(sourceRefPathKey(sourceRef), ref);
    }
    this._bySourceRefExact.set(sourceRefExactKey(sourceRef), ref);
    this._bySourceRefLoose.set(sourceRefLooseKey(sourceRef), ref);
  }

  clear(): void {
    this._byRef.clear();
    this._bySourceRefPath.clear();
    this._bySourceRefExact.clear();
    this._bySourceRefLoose.clear();
    this._byKind.clear();
    this._storyRefs.length = 0;
  }
}

function sourceRefLooseKey(ref: SourceRef): string {
  return `${ref.partUri}#${ref.nodeId}`;
}

function sourceRefPathKey(ref: SourceRef): string {
  return `${ref.partUri}#${ref.sourceNodePath}`;
}

function sourceRefExactKey(ref: SourceRef): string {
  if (!ref.sourceNodePath) {
    return sourceRefLooseKey(ref);
  }

  return `${sourceRefPathKey(ref)}#${ref.nodeId}`;
}
