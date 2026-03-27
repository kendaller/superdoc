// ---------------------------------------------------------------------------
// Graph context and entity graph types
//
// GraphContext provides the session-level services that entity handles need
// for lazy extraction (session revision, element resolution, extractors).
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef } from "../identity/types.js";
import type { EntityKind, Entity } from "../entities/types.js";
import type { ExtractorRegistry } from "../extract/types.js";
import type { XmlElementNode } from "../types/xml.js";
import type { PackageSession } from "../types/session.js";
import type { DiagnosticBag } from "../diagnostics/diagnostic-bag.js";

/**
 * Session-level context shared by all entity handles.
 * Provides access to the source kernel for lazy extraction.
 */
export type GraphContext = {
  readonly session: PackageSession;
  readonly extractors: ExtractorRegistry;
  readonly diagnostics: DiagnosticBag;

  /** Current session revision for cache invalidation. */
  currentRevision(): string;

  /** Resolve an entity's source element. Prefers the element cache. */
  resolveElement(sourceRef: SourceRef): XmlElementNode | undefined;

  /**
   * Cache a direct element reference keyed by entity ref.
   * Avoids nodeId collision issues with region-hydrated elements
   * that can produce identical IDs for regions of the same byte length.
   */
  cacheElement(entityRefId: string, element: XmlElementNode): void;

  /** Resolve from the entity-keyed cache first. */
  resolveElementByEntityRef(entityRefId: string, sourceRef: SourceRef): XmlElementNode | undefined;

  /** Wipe the element cache for rebuild. */
  clearElementCache(): void;
};

/**
 * The entity graph — owns all entity handles and provides lookup.
 */
export type EntityGraph = {
  /** Look up any entity by ref. */
  get(ref: EntityRef): Entity | undefined;

  /** Look up entity by its source XML node. */
  getBySourceRef(sourceRef: SourceRef): Entity | undefined;

  /** All entities of a given kind. */
  allOfKind<K extends EntityKind>(kind: K): Entity<K>[];

  /** All story entity refs. */
  storyRefs(): readonly EntityRef[];

  /** Total entity count. */
  size(): number;

  /** Register an entity. */
  register(entity: Entity): void;

  /** Index a source ref → entity mapping. */
  indexSourceRef(sourceRef: SourceRef, ref: EntityRef): void;

  /** Wipe the entire graph for rebuild. */
  clear(): void;
};
