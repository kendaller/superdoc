// ---------------------------------------------------------------------------
// Occurrence projection — Phase 4B
//
// Walks the semantic model's entity graph and emits a flat list of
// SemanticOccurrences. Each occurrence carries a denormalized snapshot of
// key properties so consumers (CLI analysis, corpus tooling, eval harness)
// can inspect document structure without re-querying the model.
//
// Determinism contract: occurrences are sorted by (storyId, entityKind, id)
// so the output is stable across identical inputs.
// ---------------------------------------------------------------------------

import type { SemanticModel } from "../../model.js";
import type { Entity, EntityKind } from "../../entities/types.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { segmentsToText } from "../../entities/inline-segments.js";
import type {
  SemanticOccurrence,
  SupportStatus,
  AnalysisResult,
} from "./types.js";

// ---- Public API -------------------------------------------------------------

/**
 * Project the semantic model into a flat occurrence list for analysis.
 *
 * Triggers full graph expansion (all stories, all tiers) to ensure
 * every reachable entity is visited.
 */
export function projectToOccurrences(
  model: SemanticModel,
  docId: string,
): AnalysisResult {
  // Ensure the full graph is populated before walking.
  model.expandAllStories();

  const allDiagnostics = model.diagnostics();
  const occurrences: SemanticOccurrence[] = [];

  for (const kind of ALL_ENTITY_KINDS) {
    const entities = model.allEntities(kind);
    for (const entity of entities) {
      occurrences.push(
        buildOccurrence(model, docId, entity, allDiagnostics),
      );
    }
  }

  // Deterministic sort: storyId (undefined last) → entityKind → entity id.
  occurrences.sort((a, b) => {
    const storyA = a.storyId ?? "\uFFFF";
    const storyB = b.storyId ?? "\uFFFF";
    if (storyA !== storyB) return storyA < storyB ? -1 : 1;

    if (a.entityKind !== b.entityKind) {
      return a.entityKind < b.entityKind ? -1 : 1;
    }

    return a.entityRef.id < b.entityRef.id ? -1 : a.entityRef.id > b.entityRef.id ? 1 : 0;
  });

  return {
    docId,
    occurrences,
    entityCount: model.entityCount(),
    diagnosticCount: allDiagnostics.length,
  };
}

// ---- Internal: occurrence builder -------------------------------------------

function buildOccurrence(
  model: SemanticModel,
  docId: string,
  entity: Entity,
  allDiagnostics: readonly Diagnostic[],
): SemanticOccurrence {
  const ref = entity.ref;
  const occurrenceId = `occ:${docId}:${ref.id}`;
  const parentOccurrenceId = entity.parentRef
    ? `occ:${docId}:${entity.parentRef.id}`
    : undefined;

  return {
    occurrenceId,
    docId,
    entityRef: ref,
    entityKind: entity.kind,
    entitySubtype: deriveSubtype(entity),
    storyId: entity.storyId,
    partUri: entity.sourceRefs[0]?.partUri,
    sourceRef: entity.sourceRefs[0] ?? undefined,
    supportStatus: lookupSupportStatus(entity.kind),
    text: extractText(model, entity),
    parentOccurrenceId,
    snapshot: buildSnapshot(entity),
    diagnostics: filterDiagnosticsForEntity(allDiagnostics, ref.id),
  };
}

// ---- Subtype derivation -----------------------------------------------------

/**
 * Derive a human-readable subtype string from entity raw properties.
 *
 * Examples:
 *   - paragraph with styleId "Heading1" -> "heading-1"
 *   - paragraph with styleId "ListParagraph" -> "list-paragraph"
 *   - drawing with drawingType "image" -> "image"
 *   - contentControl with controlType "checkbox" -> "checkbox"
 *   - style with type "paragraph" -> "paragraph"
 */
function deriveSubtype(entity: Entity): string | undefined {
  switch (entity.kind) {
    case "paragraph": {
      const raw = (entity as Entity<"paragraph">).raw();
      if (!raw.styleId) return undefined;
      // Convert PascalCase/CamelCase style IDs to kebab-case.
      return raw.styleId
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
        .toLowerCase();
    }
    case "drawing": {
      const raw = (entity as Entity<"drawing">).raw();
      return raw.drawingType;
    }
    case "contentControl": {
      const raw = (entity as Entity<"contentControl">).raw();
      return raw.controlType ?? raw.scope;
    }
    case "style": {
      const raw = (entity as Entity<"style">).raw();
      return raw.type ?? undefined;
    }
    case "run": {
      const raw = (entity as Entity<"run">).raw();
      return raw.formatting.rStyle ?? undefined;
    }
    default:
      return undefined;
  }
}

// ---- Text extraction --------------------------------------------------------

/**
 * Extract plain text from an entity where applicable.
 *
 * Paragraphs have their runs collected and segments concatenated.
 * Bookmarks and styles return their name. Other kinds return undefined.
 */
function extractText(model: SemanticModel, entity: Entity): string | undefined {
  switch (entity.kind) {
    case "paragraph": {
      const runs = model.runs(entity.ref);
      if (runs.length === 0) return undefined;
      const parts: string[] = [];
      for (const run of runs) {
        const segments = model.segments(run.ref);
        const text = segmentsToText(segments);
        if (text) parts.push(text);
      }
      return parts.length > 0 ? parts.join("") : undefined;
    }
    case "bookmark": {
      const raw = (entity as Entity<"bookmark">).raw();
      return raw.name;
    }
    case "style": {
      const raw = (entity as Entity<"style">).raw();
      return raw.name ?? raw.styleId;
    }
    default:
      return undefined;
  }
}

// ---- Snapshot builder -------------------------------------------------------

/**
 * Build a compact key-property snapshot for the occurrence.
 * Only includes properties that are meaningful for analysis; omits
 * undefined/empty values to keep the output lean.
 */
function buildSnapshot(entity: Entity): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};

  switch (entity.kind) {
    case "paragraph": {
      const raw = (entity as Entity<"paragraph">).raw();
      if (raw.styleId) snapshot.styleId = raw.styleId;
      if (raw.alignment) snapshot.alignment = raw.alignment;
      if (raw.numPr) snapshot.hasNumbering = true;
      if (raw.outlineLevel !== undefined) snapshot.outlineLevel = raw.outlineLevel;
      if (raw.pageBreakBefore) snapshot.pageBreakBefore = true;
      if (raw.keepNext) snapshot.keepNext = true;
      if (raw.keepLines) snapshot.keepLines = true;
      if (raw.bidi) snapshot.bidi = true;
      if (raw.hasSectPr) snapshot.hasSectPr = true;
      break;
    }
    case "run": {
      const raw = (entity as Entity<"run">).raw();
      const fmt = raw.formatting;
      if (fmt.rStyle) snapshot.rStyle = fmt.rStyle;
      if (fmt.bold) snapshot.bold = true;
      if (fmt.italic) snapshot.italic = true;
      if (fmt.underline) snapshot.underline = fmt.underline;
      if (fmt.fontSize) snapshot.fontSize = fmt.fontSize;
      if (fmt.fontFamily) snapshot.fontFamily = fmt.fontFamily;
      if (fmt.color) snapshot.color = fmt.color;
      if (fmt.vanish) snapshot.vanish = true;
      snapshot.segmentCount = raw.segments.length;
      break;
    }
    case "table": {
      const raw = (entity as Entity<"table">).raw();
      if (raw.styleId) snapshot.styleId = raw.styleId;
      if (raw.alignment) snapshot.alignment = raw.alignment;
      if (raw.layout) snapshot.layout = raw.layout;
      snapshot.columnCount = raw.gridCols.length;
      if (raw.bidi) snapshot.bidi = true;
      break;
    }
    case "tableRow": {
      const raw = (entity as Entity<"tableRow">).raw();
      if (raw.isHeader) snapshot.isHeader = true;
      if (raw.cantSplit) snapshot.cantSplit = true;
      break;
    }
    case "tableCell": {
      const raw = (entity as Entity<"tableCell">).raw();
      if (raw.gridSpan && raw.gridSpan > 1) snapshot.gridSpan = raw.gridSpan;
      if (raw.vMerge) snapshot.vMerge = raw.vMerge;
      if (raw.verticalAlignment) snapshot.verticalAlignment = raw.verticalAlignment;
      break;
    }
    case "drawing": {
      const raw = (entity as Entity<"drawing">).raw();
      snapshot.drawingType = raw.drawingType;
      snapshot.isInline = raw.isInline;
      if (raw.width) snapshot.width = raw.width;
      if (raw.height) snapshot.height = raw.height;
      break;
    }
    case "contentControl": {
      const raw = (entity as Entity<"contentControl">).raw();
      snapshot.scope = raw.scope;
      if (raw.controlType) snapshot.controlType = raw.controlType;
      if (raw.tag) snapshot.tag = raw.tag;
      if (raw.alias) snapshot.alias = raw.alias;
      if (raw.lock) snapshot.lock = raw.lock;
      break;
    }
    case "style": {
      const raw = (entity as Entity<"style">).raw();
      snapshot.styleId = raw.styleId;
      if (raw.type) snapshot.type = raw.type;
      if (raw.name) snapshot.name = raw.name;
      if (raw.basedOn) snapshot.basedOn = raw.basedOn;
      if (raw.isDefault) snapshot.isDefault = true;
      break;
    }
    case "numberingDefinition": {
      const raw = (entity as Entity<"numberingDefinition">).raw();
      snapshot.numId = raw.numId;
      if (raw.abstractNumId) snapshot.abstractNumId = raw.abstractNumId;
      break;
    }
    case "bookmark": {
      const raw = (entity as Entity<"bookmark">).raw();
      snapshot.bookmarkId = raw.bookmarkId;
      snapshot.name = raw.name;
      break;
    }
    case "section": {
      const raw = (entity as Entity<"section">).raw();
      if (raw.pageWidth) snapshot.pageWidth = raw.pageWidth;
      if (raw.pageHeight) snapshot.pageHeight = raw.pageHeight;
      if (raw.orientation) snapshot.orientation = raw.orientation;
      if (raw.cols && raw.cols > 1) snapshot.cols = raw.cols;
      break;
    }
    case "revisionRange": {
      const raw = (entity as Entity<"revisionRange">).raw();
      snapshot.revisionId = raw.revisionId;
      snapshot.revisionType = raw.revisionType;
      if (raw.author) snapshot.author = raw.author;
      if (raw.date) snapshot.date = raw.date;
      break;
    }
    case "fieldRange": {
      const raw = (entity as Entity<"fieldRange">).raw();
      snapshot.instructionText = raw.instructionText;
      if (raw.fieldType) snapshot.fieldType = raw.fieldType;
      if (raw.separateNodeId) snapshot.hasSeparator = true;
      break;
    }
    case "preservedBlock": {
      const raw = (entity as Entity<"preservedBlock">).raw();
      snapshot.qualifiedName = raw.qualifiedName;
      break;
    }
    case "preservedRange": {
      const raw = (entity as Entity<"preservedRange">).raw();
      snapshot.qualifiedName = raw.qualifiedName;
      break;
    }
    // Story kinds carry their part URI in the occurrence's partUri field.
    // No additional snapshot needed for: hyperlink, mathObject, abstractNum,
    // theme, mediaResource, headerFooterDefinition, commentThread,
    // footnoteBody, endnoteBody, commentRange, permissionRange.
  }

  return snapshot;
}

// ---- Diagnostic filtering ---------------------------------------------------

/**
 * Filter diagnostics scoped to a specific entity by its ref ID.
 */
function filterDiagnosticsForEntity(
  diagnostics: readonly Diagnostic[],
  entityId: string,
): readonly Diagnostic[] {
  return diagnostics.filter((d) =>
    d.scope.kind === "entity" && d.scope.entityRef.id === entityId,
  );
}

// ---- Capability map ---------------------------------------------------------

/**
 * Hardcoded support-status map for Phase 4B.
 *
 * As more pipeline stages come online, entries here get promoted.
 * The map is intentionally conservative — only entities that are fully
 * wired through to layout claim layoutProjected = true.
 *
 * Note: `run` is layoutProjected but some segment types are dropped
 * (drawing, fieldChar, instrText, deletedText). The flag means the
 * entity kind participates in projection, not that every segment
 * variant is handled.
 */
const SUPPORT_STATUS_MAP: Partial<Record<EntityKind, SupportStatus>> = {
  // Projected through layout (structural conversion implemented)
  paragraph:    { preserved: true, semanticRead: true, layoutProjected: true },
  run:          { preserved: true, semanticRead: true, layoutProjected: true },
  table:        { preserved: true, semanticRead: true, layoutProjected: true },
  tableRow:     { preserved: true, semanticRead: true, layoutProjected: true },
  tableCell:    { preserved: true, semanticRead: true, layoutProjected: true },
  section:      { preserved: true, semanticRead: true, layoutProjected: true },
  contentControl: { preserved: true, semanticRead: true, layoutProjected: true },

  // Semantically read but not yet in layout projection
  drawing:                { preserved: true, semanticRead: true, layoutProjected: false },
  hyperlink:              { preserved: true, semanticRead: true, layoutProjected: false },
  bookmark:               { preserved: true, semanticRead: true, layoutProjected: false },
  commentRange:           { preserved: true, semanticRead: true, layoutProjected: false },
  style:                  { preserved: true, semanticRead: true, layoutProjected: false },
  numberingDefinition:    { preserved: true, semanticRead: true, layoutProjected: false },
  abstractNum:            { preserved: true, semanticRead: true, layoutProjected: false },

  // Stories — container-only, not projected individually
  mainStory:     { preserved: true, semanticRead: true, layoutProjected: false },
  headerStory:   { preserved: true, semanticRead: true, layoutProjected: false },
  footerStory:   { preserved: true, semanticRead: true, layoutProjected: false },
  footnoteStory: { preserved: true, semanticRead: true, layoutProjected: false },
  endnoteStory:  { preserved: true, semanticRead: true, layoutProjected: false },
  commentStory:  { preserved: true, semanticRead: true, layoutProjected: false },
  textboxStory:  { preserved: true, semanticRead: true, layoutProjected: false },

  // Preserved but not yet semantically read
  mathObject:              { preserved: true, semanticRead: false, layoutProjected: false },
  theme:                   { preserved: true, semanticRead: false, layoutProjected: false },
  mediaResource:           { preserved: true, semanticRead: false, layoutProjected: false },
  headerFooterDefinition:  { preserved: true, semanticRead: false, layoutProjected: false },
  commentThread:           { preserved: true, semanticRead: false, layoutProjected: false },
  footnoteBody:            { preserved: true, semanticRead: false, layoutProjected: false },
  endnoteBody:             { preserved: true, semanticRead: false, layoutProjected: false },
  permissionRange:         { preserved: true, semanticRead: false, layoutProjected: false },

  // Range entities — semantically read, not projected
  revisionRange:  { preserved: true, semanticRead: true, layoutProjected: false },
  fieldRange:     { preserved: true, semanticRead: true, layoutProjected: false },

  // Preservation fallbacks
  preservedBlock: { preserved: true, semanticRead: false, layoutProjected: false },
  preservedRange: { preserved: true, semanticRead: false, layoutProjected: false },
};

/** Default status for any entity kind not explicitly mapped. */
const DEFAULT_SUPPORT_STATUS: SupportStatus = {
  preserved: false,
  semanticRead: false,
  layoutProjected: false,
};

function lookupSupportStatus(kind: EntityKind): SupportStatus {
  return SUPPORT_STATUS_MAP[kind] ?? DEFAULT_SUPPORT_STATUS;
}

// ---- All entity kinds (for iteration) ---------------------------------------

const ALL_ENTITY_KINDS: readonly EntityKind[] = [
  // Stories
  "mainStory", "headerStory", "footerStory",
  "footnoteStory", "endnoteStory", "commentStory", "textboxStory",
  // Structural
  "paragraph", "run", "table", "tableRow", "tableCell",
  "drawing", "contentControl", "mathObject", "hyperlink",
  // Resources
  "style", "numberingDefinition", "abstractNum", "theme",
  "mediaResource", "headerFooterDefinition",
  "commentThread", "footnoteBody", "endnoteBody",
  // Ranges
  "bookmark", "commentRange", "permissionRange",
  "revisionRange", "fieldRange",
  // Derived
  "section",
  // Preservation
  "preservedBlock", "preservedRange",
];
