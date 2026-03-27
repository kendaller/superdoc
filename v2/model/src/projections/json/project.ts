// ---------------------------------------------------------------------------
// Semantic JSON projection — Phase 6
//
// Projects the semantic model into a clean, consumer-friendly JSON tree.
//
// This is a READ-ONLY, LOSSY view. It intentionally drops information
// that is not useful for typical API consumers (source refs, raw XML
// properties, internal graph wiring). It must NEVER be used as a
// persistence or round-trip format.
//
// The projection walks all stories, projects blocks recursively, and
// emits a self-describing SemanticDocument. Entity kinds that don't yet
// have a semantic JSON representation (drawing, preservedBlock, etc.)
// are silently skipped.
// ---------------------------------------------------------------------------

import type { SemanticModel } from "../../model.js";
import type { Entity, StoryEntity } from "../../entities/types.js";
import { segmentsToText } from "../../entities/inline-segments.js";
import type {
  SemanticDocument,
  SemanticStory,
  SemanticBlock,
  SemanticParagraph,
  SemanticRun,
  SemanticInlineSegment,
  SemanticTable,
  SemanticTableRow,
  SemanticTableCell,
  SemanticSection,
  SemanticDrawingBlock,
  SemanticUnsupportedBlock,
  SemanticStyleSummary,
  DocumentMetadata,
} from "./types.js";
import type { InlineSegment } from "../../entities/inline-segments.js";

// ---- Public API -------------------------------------------------------------

/**
 * Project the semantic model into a SemanticDocument.
 *
 * Triggers full graph expansion to ensure all entities are visited.
 * The resulting tree is a clean, self-contained JSON structure with
 * no live references back to the model.
 *
 * @remarks This is a lossy, read-only snapshot. Changes to the returned
 * object have no effect on the model. Do not use as a persistence format.
 */
export function projectToSemanticJson(model: SemanticModel): SemanticDocument {
  model.expandAllStories();

  return {
    kind: "document",
    stories: projectStories(model),
    styles: projectStyles(model),
    metadata: buildMetadata(model),
  };
}

// ---- Story projection -------------------------------------------------------

function projectStories(model: SemanticModel): SemanticStory[] {
  return model.stories().map((story) => projectStory(model, story));
}

function projectStory(model: SemanticModel, story: StoryEntity): SemanticStory {
  const blocks = model.blockEntities(story.ref);

  return {
    kind: "story",
    storyType: story.kind,
    blocks: projectBlocksWithUnwrap(model, blocks),
  };
}

// ---- Block projection -------------------------------------------------------

/**
 * Project entities into semantic blocks, unwrapping content controls.
 *
 * Content controls are transparent wrappers — their children are inlined
 * into the parent block list. Unsupported block kinds are preserved as
 * explicit placeholders rather than being silently dropped.
 */
function projectBlocksWithUnwrap(model: SemanticModel, entities: Entity[]): SemanticBlock[] {
  const result: SemanticBlock[] = [];

  for (const entity of entities) {
    switch (entity.kind) {
      case "contentControl": {
        // Transparent wrapper: inline its children
        const children = model.blockEntities(entity.ref);
        result.push(...projectBlocksWithUnwrap(model, children));
        break;
      }
      case "paragraph":
        result.push(projectParagraph(model, entity as Entity<"paragraph">));
        break;
      case "table":
        result.push(projectTable(model, entity as Entity<"table">));
        break;
      case "section":
        result.push(projectSection(entity as Entity<"section">));
        break;
      case "drawing":
        result.push(projectDrawing(entity as Entity<"drawing">));
        break;
      case "preservedBlock":
        result.push(projectUnsupportedBlock(entity as Entity<"preservedBlock">));
        break;
      case "mathObject":
        result.push(projectUnsupportedBlock(entity as Entity<"mathObject">));
        break;
      default:
        break;
    }
  }

  return result;
}

// ---- Paragraph projection ---------------------------------------------------

function projectParagraph(
  model: SemanticModel,
  entity: Entity<"paragraph">,
): SemanticParagraph {
  const raw = entity.raw();
  const runs = model.runs(entity.ref);

  const paragraph: SemanticParagraph = {
    kind: "paragraph",
    entityRef: entity.ref.id,
    runs: projectRuns(runs),
    ...(raw.styleId !== undefined && { styleId: raw.styleId }),
    ...(raw.alignment !== undefined && { alignment: raw.alignment }),
    ...(raw.numPr !== undefined && {
      numbering: {
        numId: parseInt(raw.numPr.numId, 10),
        ilvl: parseInt(raw.numPr.ilvl, 10),
      },
    }),
  };

  return paragraph;
}

// ---- Run projection ---------------------------------------------------------

function projectRuns(runs: Entity<"run">[]): SemanticRun[] {
  return runs.map((run) => projectRun(run));
}

function projectRun(entity: Entity<"run">): SemanticRun {
  const raw = entity.raw();
  const text = segmentsToText(raw.segments);
  const fmt = raw.formatting;

  return {
    kind: "run",
    entityRef: entity.ref.id,
    text,
    segments: raw.segments.map(projectInlineSegment),
    ...(fmt.bold === true && { bold: true }),
    ...(fmt.italic === true && { italic: true }),
    ...(fmt.underline !== undefined && { underline: fmt.underline }),
    ...(fmt.fontSize !== undefined && { fontSize: fmt.fontSize }),
    ...(fmt.fontFamily !== undefined && { fontFamily: fmt.fontFamily }),
    ...(fmt.color !== undefined && { color: fmt.color }),
  };
}

function projectInlineSegment(segment: InlineSegment): SemanticInlineSegment {
  switch (segment.segmentKind) {
    case "text":
      return { kind: "text", text: segment.text };
    case "deletedText":
      return { kind: "deletedText", text: segment.text };
    case "instrText":
      return { kind: "instrText", text: segment.text };
    case "tab":
      return { kind: "tab" };
    case "break":
      return { kind: "break", breakType: segment.breakType };
    case "symbol":
      return { kind: "symbol", char: segment.char, ...(segment.font ? { font: segment.font } : {}) };
    case "footnoteRef":
      return { kind: "footnoteRef", footnoteId: segment.footnoteId };
    case "endnoteRef":
      return { kind: "endnoteRef", endnoteId: segment.endnoteId };
    case "drawing":
      return { kind: "drawing", isInline: segment.isInline };
    case "fieldChar":
      return { kind: "fieldChar", fieldCharType: segment.fieldCharType };
    case "softHyphen":
      return { kind: "softHyphen" };
    case "noBreakHyphen":
      return { kind: "noBreakHyphen" };
    case "preserved":
      return { kind: "preserved", qualifiedName: segment.qualifiedName };
  }
}

// ---- Table projection -------------------------------------------------------

function projectTable(
  model: SemanticModel,
  entity: Entity<"table">,
): SemanticTable {
  const raw = entity.raw();
  const rows = model.tableRows(entity.ref);

  return {
    kind: "table",
    entityRef: entity.ref.id,
    rows: rows.map((row) => projectTableRow(model, row)),
    ...(raw.styleId !== undefined && { styleId: raw.styleId }),
  };
}

function projectTableRow(
  model: SemanticModel,
  row: Entity<"tableRow">,
): SemanticTableRow {
  const cells = model.tableCells(row.ref);

  return {
    kind: "tableRow",
    cells: cells.map((cell) => projectTableCell(model, cell)),
  };
}

function projectTableCell(
  model: SemanticModel,
  cell: Entity<"tableCell">,
): SemanticTableCell {
  const raw = cell.raw();
  const content = model.cellContent(cell.ref);

  return {
    kind: "tableCell",
    blocks: projectBlocksWithUnwrap(model, content),
    ...(raw.gridSpan !== undefined && raw.gridSpan > 1 && { colSpan: raw.gridSpan }),
    ...(raw.vMerge !== undefined && raw.vMerge === "restart" && { rowSpan: 1 }),
  };
}

// ---- Section projection -----------------------------------------------------

function projectSection(entity: Entity<"section">): SemanticSection {
  const raw = entity.raw();

  return {
    kind: "section",
    ...(raw.pageWidth !== undefined && { pageWidth: raw.pageWidth }),
    ...(raw.pageHeight !== undefined && { pageHeight: raw.pageHeight }),
    ...(raw.orientation !== undefined && { orientation: raw.orientation }),
  };
}

function projectDrawing(entity: Entity<"drawing">): SemanticDrawingBlock {
  const raw = entity.raw();

  return {
    kind: "drawing",
    entityRef: entity.ref.id,
    ...(raw.drawingType ? { drawingType: raw.drawingType } : {}),
    ...(raw.width !== undefined ? { width: raw.width } : {}),
    ...(raw.height !== undefined ? { height: raw.height } : {}),
    ...(raw.description ? { description: raw.description } : {}),
  };
}

function projectUnsupportedBlock(
  entity: Entity<"preservedBlock"> | Entity<"mathObject">,
): SemanticUnsupportedBlock {
  return {
    kind: "unsupported",
    entityRef: entity.ref.id,
    sourceKind: entity.kind,
  };
}

// ---- Style projection -------------------------------------------------------

function projectStyles(model: SemanticModel): SemanticStyleSummary[] {
  return model.styles().map((style) => {
    const raw = style.raw();

    return {
      styleId: raw.styleId,
      ...(raw.name !== undefined && { name: raw.name }),
      ...(raw.type !== undefined && { type: raw.type }),
      ...(raw.basedOn !== undefined && { basedOn: raw.basedOn }),
    };
  });
}

// ---- Metadata ---------------------------------------------------------------

function buildMetadata(model: SemanticModel): DocumentMetadata {
  return {
    entityCount: model.entityCount(),
    storyCount: model.stories().length,
    diagnosticCount: model.diagnostics().length,
  };
}
