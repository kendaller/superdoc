// ---------------------------------------------------------------------------
// Tier 1: Lazy graph construction — block internals
//
// Built on demand when an entity's children are first accessed.
// Triggers region hydration for the relevant boundary.
//
// - Paragraph → runs (+ hyperlink spans)
// - Table → rows → cells → cell content
// - Drawings found inside runs are registered
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { EntityRef } from "../identity/types.js";
import { createSourceRef } from "../identity/types.js";
import type { EntityKind, FieldRangeRawProperties } from "../entities/types.js";
import type { EntityGraph, GraphContext } from "./types.js";
import { EntityHandle } from "./entity-handle.js";
import { RefGenerator } from "./ref-generator.js";
import { findChildElement, findChildElements } from "../word/tree-helpers.js";
import { computeChildPath } from "./source-path.js";
import type { FieldCharSegment } from "../entities/inline-segments.js";
import { parseFieldType } from "../extract/field-range.js";

/**
 * Expand a paragraph entity's children: discover runs and hyperlink spans.
 */
export function expandParagraph(
  paragraphEntity: EntityHandle<"paragraph">,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const element = ctx.resolveElementByEntityRef(paragraphEntity.ref.id, paragraphEntity.sourceRefs[0]);
  if (!element) return;

  const childRefs: EntityRef[] = [];
  const discoveredRunRefs: EntityRef[] = [];

  for (const child of element.children) {
    if (child.kind !== "element") continue;

    if (child.localName === "r" && child.prefix === "w") {
      // Direct run
      const ref = registerChildEntity(
        "run", child, paragraphEntity, graph, ctx, refs,
      );
      childRefs.push(ref);
      discoveredRunRefs.push(ref);
      expandRunDrawings(child, ref, graph, ctx, refs);
    } else if (child.localName === "hyperlink" && child.prefix === "w") {
      // Hyperlink wrapper — register span entity, then discover runs inside
      const hyperlinkRef = registerChildEntity(
        "hyperlink", child, paragraphEntity, graph, ctx, refs,
      );
      childRefs.push(hyperlinkRef);
      const hyperlinkEntity = graph.get(hyperlinkRef) as EntityHandle<"hyperlink">;

      for (const hChild of child.children) {
        if (hChild.kind !== "element") continue;
        if (hChild.localName === "r" && hChild.prefix === "w") {
          const runRef = registerChildEntity(
            "run", hChild, hyperlinkEntity, graph, ctx, refs,
          );
          hyperlinkEntity.addChildRef(runRef);
          discoveredRunRefs.push(runRef);
          expandRunDrawings(hChild, runRef, graph, ctx, refs);
        }
      }
    } else if (child.localName === "sdt" && child.prefix === "w") {
      // Content control — register as entity
      const ref = registerChildEntity(
        "contentControl", child, paragraphEntity, graph, ctx, refs,
      );
      childRefs.push(ref);
    } else if (child.localName === "ins" || child.localName === "del" || child.localName === "moveTo" || child.localName === "moveFrom") {
      // Tracked change wrappers — discover runs inside + create revision range entity
      if (child.prefix === "w") {
        // Register the revision range entity (not a structural child)
        registerChildEntity("revisionRange", child, paragraphEntity, graph, ctx, refs);

        for (const tcChild of child.children) {
          if (tcChild.kind !== "element") continue;
          if (tcChild.localName === "r" && tcChild.prefix === "w") {
            const ref = registerChildEntity(
              "run", tcChild, paragraphEntity, graph, ctx, refs,
            );
            childRefs.push(ref);
            discoveredRunRefs.push(ref);
            expandRunDrawings(tcChild, ref, graph, ctx, refs);
          }
        }
      }
    } else if (child.localName === "bookmarkStart" && child.prefix === "w") {
      // Range entity — registered in graph but NOT a structural child
      registerChildEntity("bookmark", child, paragraphEntity, graph, ctx, refs);
    } else if (child.localName === "commentRangeStart" && child.prefix === "w") {
      // Range entity — registered in graph but NOT a structural child
      registerChildEntity("commentRange", child, paragraphEntity, graph, ctx, refs);
    }
    // bookmarkEnd, commentRangeEnd, proofErr, lastRenderedPageBreak — skip
  }

  paragraphEntity.setChildRefs(childRefs);
  registerFieldRangeEntities(discoveredRunRefs, paragraphEntity, graph, ctx, refs);
}

/**
 * Expand a table entity's children: discover rows.
 */
export function expandTable(
  tableEntity: EntityHandle<"table">,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const element = ctx.resolveElementByEntityRef(tableEntity.ref.id, tableEntity.sourceRefs[0]);
  if (!element) return;

  const childRefs: EntityRef[] = [];
  const rows = findChildElements(element, "tr", "w");

  for (const row of rows) {
    const rowRef = registerChildEntity(
      "tableRow", row, tableEntity, graph, ctx, refs,
    );
    childRefs.push(rowRef);
  }

  tableEntity.setChildRefs(childRefs);
}

/**
 * Expand a table row entity's children: discover cells.
 */
export function expandTableRow(
  rowEntity: EntityHandle<"tableRow">,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const element = ctx.resolveElementByEntityRef(rowEntity.ref.id, rowEntity.sourceRefs[0]);
  if (!element) return;

  const childRefs: EntityRef[] = [];
  const cells = findChildElements(element, "tc", "w");

  for (const cell of cells) {
    const cellRef = registerChildEntity(
      "tableCell", cell, rowEntity, graph, ctx, refs,
    );
    childRefs.push(cellRef);
  }

  rowEntity.setChildRefs(childRefs);
}

/**
 * Expand a table cell entity's children: discover cell content (paragraphs, tables).
 */
export function expandTableCell(
  cellEntity: EntityHandle<"tableCell">,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const element = ctx.resolveElementByEntityRef(cellEntity.ref.id, cellEntity.sourceRefs[0]);
  if (!element) return;

  const childRefs: EntityRef[] = [];

  for (const child of element.children) {
    if (child.kind !== "element") continue;

    let kind: EntityKind;
    if (child.localName === "p" && child.prefix === "w") {
      kind = "paragraph";
    } else if (child.localName === "tbl" && child.prefix === "w") {
      kind = "table";
    } else if (child.localName === "sdt" && child.prefix === "w") {
      kind = "contentControl";
    } else {
      kind = "preservedBlock";
    }

    const ref = registerChildEntity(kind, child, cellEntity, graph, ctx, refs);
    childRefs.push(ref);
  }

  cellEntity.setChildRefs(childRefs);
}

// ---- Content control expansion -----------------------------------------------

/**
 * Expand a content control entity's children.
 * SDTs wrap their content in `w:sdtContent`. Block-level SDTs contain
 * paragraphs/tables; inline SDTs contain runs.
 */
export function expandContentControl(
  sdtEntity: EntityHandle<"contentControl">,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const element = ctx.resolveElementByEntityRef(sdtEntity.ref.id, sdtEntity.sourceRefs[0]);
  if (!element) return;

  const sdtContent = findChildElement(element, "sdtContent", "w");
  if (!sdtContent) return;
  const sdtPath = sdtEntity.sourceRefs[0]?.sourceNodePath;
  const sdtContentPath = sdtPath
    ? computeChildPath(element, sdtPath, sdtContent)
    : undefined;

  const childRefs: EntityRef[] = [];

  for (const child of sdtContent.children) {
    if (child.kind !== "element") continue;

    if (child.localName === "p" && child.prefix === "w") {
      const ref = registerChildEntity(
        "paragraph",
        child,
        sdtEntity,
        graph,
        ctx,
        refs,
        sdtContent,
        sdtContentPath,
      );
      childRefs.push(ref);
    } else if (child.localName === "tbl" && child.prefix === "w") {
      const ref = registerChildEntity(
        "table",
        child,
        sdtEntity,
        graph,
        ctx,
        refs,
        sdtContent,
        sdtContentPath,
      );
      childRefs.push(ref);
    } else if (child.localName === "r" && child.prefix === "w") {
      const ref = registerChildEntity(
        "run",
        child,
        sdtEntity,
        graph,
        ctx,
        refs,
        sdtContent,
        sdtContentPath,
      );
      childRefs.push(ref);
      expandRunDrawings(child, ref, graph, ctx, refs);
    } else if (child.localName === "sdt" && child.prefix === "w") {
      const ref = registerChildEntity(
        "contentControl",
        child,
        sdtEntity,
        graph,
        ctx,
        refs,
        sdtContent,
        sdtContentPath,
      );
      childRefs.push(ref);
    }
  }

  sdtEntity.setChildRefs(childRefs);
}

// ---- Drawing discovery inside runs ------------------------------------------

function expandRunDrawings(
  runElement: XmlElementNode,
  runRef: EntityRef,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const runEntity = graph.get(runRef) as EntityHandle<"run"> | undefined;
  if (!runEntity) return;

  for (const child of runElement.children) {
    if (child.kind !== "element") continue;
    if (child.localName === "drawing" && child.prefix === "w") {
      const drawingRef = registerChildEntity(
        "drawing", child, runEntity, graph, ctx, refs,
      );
      runEntity.addChildRef(drawingRef);
    }
  }
}

// ---- Shared entity registration ---------------------------------------------

function registerChildEntity(
  kind: EntityKind,
  element: XmlElementNode,
  parent: EntityHandle<EntityKind>,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
  pathParentElement?: XmlElementNode,
  pathParentPath?: string,
): EntityRef {
  const ref = refs.next(kind);
  const parentSourceRef = parent.sourceRefs[0];
  const resolvedParentElement = pathParentElement
    ?? ctx.resolveElementByEntityRef(parent.ref.id, parentSourceRef);
  const resolvedParentPath = pathParentPath ?? parentSourceRef?.sourceNodePath;
  const path = resolvedParentElement && resolvedParentPath
    ? computeChildPath(resolvedParentElement, resolvedParentPath, element)
    : undefined;
  const sourceRef = createSourceRef(parentSourceRef.partUri, element.id, path);

  const entity = new EntityHandle(
    ref,
    kind,
    [sourceRef],
    parent.storyId,
    parent.ref,
    ctx,
  );

  graph.register(entity);
  graph.indexSourceRef(sourceRef, ref);
  ctx.cacheElement(ref.id, element);
  return ref;
}

function registerFieldRangeEntities(
  runRefs: readonly EntityRef[],
  paragraphEntity: EntityHandle<"paragraph">,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const activeFields: ActiveFieldRange[] = [];

  for (const runRef of runRefs) {
    const runEntity = graph.get(runRef) as EntityHandle<"run"> | undefined;
    if (!runEntity) {
      continue;
    }

    const runElement = ctx.resolveElementByEntityRef(runRef.id, runEntity.sourceRefs[0]);
    const runPath = runEntity.sourceRefs[0]?.sourceNodePath;
    if (!runElement || !runPath) {
      continue;
    }

    const elementById = new Map<string, XmlElementNode>();
    for (const child of runElement.children) {
      if (child.kind === "element") {
        elementById.set(child.id, child);
      }
    }

    for (const segment of runEntity.raw().segments) {
      switch (segment.segmentKind) {
        case "fieldChar":
          handleFieldCharSegment(
            segment,
            elementById,
            runElement,
            runPath,
            paragraphEntity,
            graph,
            ctx,
            refs,
            activeFields,
          );
          break;
        case "instrText":
          if (activeFields.length > 0) {
            activeFields[activeFields.length - 1].instructionTextParts.push(segment.text);
          }
          break;
      }
    }
  }
}

type ActiveFieldRange = {
  readonly beginElement: XmlElementNode;
  readonly beginNodeId: string;
  readonly beginPath: string;
  readonly instructionTextParts: string[];
  separateNodeId?: string;
};

function handleFieldCharSegment(
  segment: FieldCharSegment,
  elementById: ReadonlyMap<string, XmlElementNode>,
  runElement: XmlElementNode,
  runPath: string,
  paragraphEntity: EntityHandle<"paragraph">,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
  activeFields: ActiveFieldRange[],
): void {
  const fieldElement = elementById.get(segment.localId);
  if (!fieldElement) {
    return;
  }

  switch (segment.fieldCharType) {
    case "begin": {
      activeFields.push({
        beginElement: fieldElement,
        beginNodeId: segment.localId,
        beginPath: computeChildPath(runElement, runPath, fieldElement),
        instructionTextParts: [],
      });
      break;
    }
    case "separate": {
      const activeField = activeFields[activeFields.length - 1];
      if (activeField) {
        activeField.separateNodeId = segment.localId;
      }
      break;
    }
    case "end": {
      const activeField = activeFields.pop();
      if (!activeField) {
        return;
      }

      const instructionText = activeField.instructionTextParts.join("");
      const rawProperties: FieldRangeRawProperties = {
        instructionText,
        fieldType: parseFieldType(instructionText),
        beginNodeId: activeField.beginNodeId,
        separateNodeId: activeField.separateNodeId,
        endNodeId: segment.localId,
      };

      const ref = refs.next("fieldRange");
      const sourceRef = createSourceRef(
        paragraphEntity.sourceRefs[0].partUri,
        activeField.beginNodeId,
        activeField.beginPath,
      );
      const entity = new EntityHandle(
        ref,
        "fieldRange",
        [sourceRef],
        paragraphEntity.storyId,
        paragraphEntity.ref,
        ctx,
        rawProperties,
      );

      graph.register(entity);
      graph.indexSourceRef(sourceRef, ref);
      ctx.cacheElement(ref.id, activeField.beginElement);
      break;
    }
  }
}
