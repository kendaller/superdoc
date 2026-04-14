// ---------------------------------------------------------------------------
// SemanticModel — the canonical read/query API for the semantic document model
//
// This is the primary application-facing surface. All consumers (layout
// projection, analysis, document-api, UI) access document content through
// this API rather than reaching through to word views or the XML layer.
//
// The model is constructed lazily:
//   - Tier 0 (stories + body children) is built eagerly on creation
//   - Tier 1 (block internals) is built on demand when children are accessed
//   - Property extraction happens lazily with revision-based cache invalidation
// ---------------------------------------------------------------------------

import type { EntityRef, SourceRef } from './identity/types.js';
import type {
  Entity,
  EntityKind,
  StoryEntity,
  ParagraphEntity,
  RunEntity,
  TableEntity,
  TableRowEntity,
  TableCellEntity,
  StyleEntity,
  NumberingDefinitionEntity,
  BookmarkEntity,
  SectionEntity,
} from './entities/types.js';
// isStoryKind used indirectly via isContainerKind at file bottom
import type { InlineSegment } from './entities/inline-segments.js';
import type { Diagnostic } from './diagnostics/types.js';
import type { XmlElementNode, XmlNode } from './types/xml.js';
import { DiagnosticBag } from './diagnostics/diagnostic-bag.js';
import type { PackageSession, PackageViews } from './types/session.js';
import type { RelationshipRecord } from './types/package.js';
import { EntityGraphImpl } from './graph/entity-graph.js';
import { EntityHandle } from './graph/entity-handle.js';
import { createGraphContext } from './graph/graph-context.js';
import { constructTier0 } from './graph/construct-tier-0.js';
import {
  expandParagraph,
  expandTable,
  expandTableRow,
  expandTableCell,
  expandContentControl,
} from './graph/construct-tier-1.js';
import { createExtractorRegistry } from './extract/registry.js';
import type { RefGenerator } from './graph/ref-generator.js';
import type { GraphContext, EntityGraph } from './graph/types.js';
import { ensureHydratedWithIndex } from './mutations/engine-hydration.js';
import { resolveRelationshipTarget as resolveRelationshipTargetFromOpc } from './opc/relationships.js';

/**
 * The semantic document model.
 *
 * Provides the canonical read/query API for all document content.
 * Constructed from a PackageSession after ready("structure").
 */
export class SemanticModel {
  private readonly _graph: EntityGraph;
  private readonly _ctx: GraphContext;
  private _refs: RefGenerator;
  private readonly _diagnostics: DiagnosticBag;
  private readonly _expandedEntities = new Set<string>();
  private readonly _session: PackageSession;
  private readonly _views: PackageViews;

  /**
   * Access the underlying PackageSession.
   *
   * Needed by the editing controller to pass to `applySemanticOperation`.
   * This is an internal API — product code should use the editing controller.
   */
  get session(): PackageSession {
    return this._session;
  }

  constructor(session: PackageSession, views: PackageViews) {
    this._session = session;
    this._views = views;
    this._diagnostics = new DiagnosticBag();
    const extractors = createExtractorRegistry();
    this._ctx = createGraphContext(session, extractors, this._diagnostics);
    this._graph = new EntityGraphImpl();
    this._refs = constructTier0(views, session, this._graph, this._ctx);
  }

  /**
   * Rebuild the semantic graph from the current session state.
   * Call after mutations through the substrate to get a fresh read model.
   *
   * This is the Phase 2 coherence strategy: full rebuild, not incremental
   * patching. Stable live handles across mutations are a Phase 5+ concern.
   */
  rebuild(options: { replayExpandedEntities?: boolean } = {}): void {
    const previouslyExpandedEntityIds = [...this._expandedEntities];
    this._graph.clear();
    this._ctx.clearElementCache();
    this._expandedEntities.clear();
    this._diagnostics.clear();
    this._refs = constructTier0(this._views, this._session, this._graph, this._ctx);
    if (options.replayExpandedEntities !== false) {
      this.replayExpandedEntities(previouslyExpandedEntityIds);
    }
  }

  // ---- Story enumeration ----------------------------------------------------

  /** All story entities in the document. */
  stories(): StoryEntity[] {
    return this._graph
      .storyRefs()
      .map((ref) => this._graph.get(ref) as StoryEntity)
      .filter(Boolean);
  }

  /** Get a specific story by its entity ref. */
  story(ref: EntityRef): StoryEntity | undefined {
    const entity = this._graph.get(ref);
    if (!entity) return undefined;
    if (
      entity.kind === 'mainStory' ||
      entity.kind === 'headerStory' ||
      entity.kind === 'footerStory' ||
      entity.kind === 'footnoteStory' ||
      entity.kind === 'endnoteStory' ||
      entity.kind === 'commentStory' ||
      entity.kind === 'textboxStory'
    ) {
      return entity as StoryEntity;
    }
    return undefined;
  }

  /** Get the main story. */
  mainStory(): StoryEntity | undefined {
    const stories = this._graph.allOfKind('mainStory');
    return stories[0];
  }

  // ---- Block entity access --------------------------------------------------

  /** Get structural block entities within a story (paragraphs, tables, etc.). */
  blockEntities(storyOrParentRef: EntityRef): Entity[] {
    const parent = this._graph.get(storyOrParentRef);
    if (!parent) return [];
    return this.resolveChildEntities(parent);
  }

  /** Count of block entities (does not trigger tier-1 expansion). */
  blockEntityCount(storyOrParentRef: EntityRef): number {
    const parent = this._graph.get(storyOrParentRef);
    if (!parent) return 0;
    return parent.childRefs().length;
  }

  // ---- Paragraph access -----------------------------------------------------

  /** Get runs within a paragraph, including runs inside hyperlinks and inline SDTs. */
  runs(paragraphRef: EntityRef): RunEntity[] {
    const para = this.ensureExpanded(paragraphRef);
    if (!para || para.kind !== 'paragraph') return [];

    const result: RunEntity[] = [];
    this.collectRunsRecursive(para, result);
    return result;
  }

  /** Recursively collect runs from a paragraph and its wrapper children. */
  private collectRunsRecursive(entity: Entity, result: RunEntity[]): void {
    for (const childRef of entity.childRefs()) {
      const child = this._graph.get(childRef);
      if (!child) continue;

      if (child.kind === 'run') {
        result.push(child as RunEntity);
      } else if (child.kind === 'hyperlink' || child.kind === 'contentControl') {
        // Expand the wrapper, then recurse to find its runs
        this.ensureExpanded(childRef);
        this.collectRunsRecursive(child, result);
      }
    }
  }

  /** Get inline segments for a run. */
  segments(runRef: EntityRef): readonly InlineSegment[] {
    const run = this._graph.get(runRef);
    if (!run || run.kind !== 'run') return [];
    return (run as RunEntity).raw().segments;
  }

  // ---- Table access ---------------------------------------------------------

  /** Get rows within a table. Triggers tier-1 expansion if needed. */
  tableRows(tableRef: EntityRef): TableRowEntity[] {
    const table = this.ensureExpanded(tableRef);
    if (!table || table.kind !== 'table') return [];
    return this.resolveChildrenOfKind(table, 'tableRow');
  }

  /** Get cells within a table row. Triggers tier-1 expansion if needed. */
  tableCells(rowRef: EntityRef): TableCellEntity[] {
    const row = this.ensureExpanded(rowRef);
    if (!row || row.kind !== 'tableRow') return [];
    return this.resolveChildrenOfKind(row, 'tableCell');
  }

  /** Get block content within a table cell. Triggers tier-1 expansion. */
  cellContent(cellRef: EntityRef): Entity[] {
    const cell = this.ensureExpanded(cellRef);
    if (!cell || cell.kind !== 'tableCell') return [];
    return this.resolveChildEntities(cell);
  }

  // ---- Resource access ------------------------------------------------------

  /** All style entities. */
  styles(): StyleEntity[] {
    return this._graph.allOfKind('style');
  }

  /** Look up a style entity by its style ID (from raw properties). */
  styleByStyleId(styleId: string): StyleEntity | undefined {
    const all = this._graph.allOfKind('style');
    return all.find((s) => s.raw().styleId === styleId);
  }

  /** All numbering definition entities. */
  numberingDefinitions(): NumberingDefinitionEntity[] {
    return this._graph.allOfKind('numberingDefinition');
  }

  /** All section entities. */
  sections(): SectionEntity[] {
    return this._graph.allOfKind('section');
  }

  /** All bookmark entities (start-marker only in Phase 2). */
  bookmarks(): BookmarkEntity[] {
    return this._graph.allOfKind('bookmark');
  }

  /** All comment range entities (start-marker only in Phase 2). */
  commentRanges(): Entity<'commentRange'>[] {
    return this._graph.allOfKind('commentRange');
  }

  // ---- Entity lookup --------------------------------------------------------

  /** Look up any entity by its ref. */
  entity(ref: EntityRef): Entity | undefined {
    return this._graph.get(ref);
  }

  /** Look up an entity by its source XML node ref. */
  entityBySourceRef(sourceRef: SourceRef): Entity | undefined {
    return this._graph.getBySourceRef(sourceRef);
  }

  /**
   * Resolve a source-backed XML node from the current package session.
   *
   * This is an advanced escape hatch for higher layers that need exact OOXML
   * fidelity when compiling semantic edits or building trace artifacts.
   */
  resolveSourceNode(sourceRef: SourceRef): XmlNode | undefined {
    const part = this._session.parts.get(sourceRef.partUri);
    if (!part || part.kind !== 'xml') {
      return undefined;
    }

    ensureHydratedWithIndex(part, this._session);
    return part.nodeIndex?.byId.get(sourceRef.nodeId);
  }

  /** Resolve a source-backed XML element when the ref points at an element node. */
  resolveSourceElement(sourceRef: SourceRef): XmlElementNode | undefined {
    const node = this.resolveSourceNode(sourceRef);
    return node?.kind === 'element' ? node : undefined;
  }

  /**
   * Resolve a relationship record from a source part by relationship ID.
   *
   * This is used by projection layers that need to bridge semantic entities
   * back to package resources such as images, charts, and headers/footers.
   */
  resolvePartRelationship(sourcePartUri: string, relationshipId: string): RelationshipRecord | undefined {
    return this._views.relationships.partRelationships(sourcePartUri)?.get(relationshipId);
  }

  /**
   * Resolve a relationship ID on a source part to its target part URI or URL.
   *
   * External relationships are returned as-is. Internal relationships are
   * normalized to absolute package part URIs.
   */
  resolveRelationshipTarget(sourcePartUri: string, relationshipId: string): string | undefined {
    const relationship = this.resolvePartRelationship(sourcePartUri, relationshipId);
    if (!relationship) {
      return undefined;
    }

    if (relationship.targetMode === 'External') {
      return relationship.target;
    }

    return resolveRelationshipTargetFromOpc(sourcePartUri, relationship.target);
  }

  /** All entities of a given kind. */
  allEntities<K extends EntityKind>(kind: K): Entity<K>[] {
    return this._graph.allOfKind(kind);
  }

  /** Total entity count in the graph. */
  entityCount(): number {
    return this._graph.size();
  }

  // ---- Batch access ---------------------------------------------------------

  /** Expand all stories and container entities recursively. */
  expandAllStories(): void {
    for (const storyRef of this._graph.storyRefs()) {
      this.expandRecursive(storyRef);
    }
  }

  /**
   * Re-apply the previous lazy-expansion frontier after a rebuild.
   *
   * Entity refs are deterministic within a session. Re-expanding the same
   * parent entities keeps child refs addressable across mutation-driven
   * rebuilds without forcing a full eager graph expansion.
   */
  private replayExpandedEntities(entityIds: readonly string[]): void {
    const pendingIds = new Set(entityIds);
    let madeProgress = true;

    while (pendingIds.size > 0 && madeProgress) {
      madeProgress = false;

      for (const entityId of [...pendingIds]) {
        const entity = this._graph.get({ id: entityId });
        if (!entity) {
          continue;
        }

        this.ensureExpanded({ id: entityId });
        pendingIds.delete(entityId);
        madeProgress = true;
      }
    }
  }

  /** All paragraphs across all stories. Triggers full expansion. */
  allParagraphs(): ParagraphEntity[] {
    this.expandAllStories();
    return this._graph.allOfKind('paragraph');
  }

  /** All tables across all stories. Triggers full expansion. */
  allTables(): TableEntity[] {
    this.expandAllStories();
    return this._graph.allOfKind('table');
  }

  // ---- Diagnostics ----------------------------------------------------------

  /** All diagnostics collected during graph construction and extraction. */
  diagnostics(): readonly Diagnostic[] {
    return this._diagnostics.all();
  }

  /** Whether any error-severity diagnostics exist. */
  hasErrors(): boolean {
    return this._diagnostics.hasErrors();
  }

  // ---- Internal: lazy tier-1 expansion --------------------------------------

  private ensureExpanded(ref: EntityRef): Entity | undefined {
    const entity = this._graph.get(ref);
    if (!entity) return undefined;

    if (this._expandedEntities.has(ref.id)) return entity;

    const handle = entity as EntityHandle<EntityKind>;

    switch (entity.kind) {
      case 'paragraph':
        expandParagraph(handle as EntityHandle<'paragraph'>, this._graph, this._ctx, this._refs);
        break;
      case 'table':
        expandTable(handle as EntityHandle<'table'>, this._graph, this._ctx, this._refs);
        break;
      case 'tableRow':
        expandTableRow(handle as EntityHandle<'tableRow'>, this._graph, this._ctx, this._refs);
        break;
      case 'tableCell':
        expandTableCell(handle as EntityHandle<'tableCell'>, this._graph, this._ctx, this._refs);
        break;
      case 'contentControl':
        expandContentControl(handle as EntityHandle<'contentControl'>, this._graph, this._ctx, this._refs);
        break;
    }

    this._expandedEntities.add(ref.id);
    return entity;
  }

  private expandRecursive(parentRef: EntityRef): void {
    const parent = this.ensureExpanded(parentRef);
    if (!parent) return;

    for (const childRef of parent.childRefs()) {
      const child = this._graph.get(childRef);
      if (!child) continue;
      if (isContainerKind(child.kind)) {
        this.expandRecursive(childRef);
      }
    }
  }

  private resolveChildEntities(parent: Entity): Entity[] {
    const expanded = this.ensureExpanded(parent.ref);
    if (!expanded) return [];
    return expanded
      .childRefs()
      .map((ref) => this._graph.get(ref))
      .filter((e): e is Entity => e !== undefined);
  }

  private resolveChildrenOfKind<K extends EntityKind>(parent: Entity, kind: K): Entity<K>[] {
    return this.resolveChildEntities(parent).filter((e): e is Entity<K> => e.kind === kind);
  }
}

// ---- Container kind classification -----------------------------------------

const CONTAINER_KINDS = new Set<EntityKind>([
  'mainStory',
  'headerStory',
  'footerStory',
  'footnoteStory',
  'endnoteStory',
  'commentStory',
  'textboxStory',
  'table',
  'tableRow',
  'tableCell',
  'commentThread',
  'footnoteBody',
  'endnoteBody',
  'contentControl',
]);

function isContainerKind(kind: EntityKind): boolean {
  return CONTAINER_KINDS.has(kind);
}
