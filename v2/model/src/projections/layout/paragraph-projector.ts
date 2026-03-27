// ---------------------------------------------------------------------------
// Paragraph projector
//
// Converts a ParagraphEntity into a layout-compatible ParagraphBlock.
// Paragraph attrs can be projected from either:
// - raw entity properties only, or
// - fully resolved style-engine paragraph properties when a resolver exists
//
// Run formatting follows the same rule: resolved formatting when available,
// raw formatting otherwise.
// ---------------------------------------------------------------------------

import type { SemanticModel } from "../../model.js";
import type { ParagraphEntity, ParagraphRawProperties, TabStop as EntityTabStop } from "../../entities/types.js";
import type { StyleResolver } from "../../resolve/style-resolver.js";
import type {
  ParagraphProperties as ResolvedParagraphProperties,
  ParagraphTabStop,
} from "@superdoc/style-engine/ooxml";
import type {
  ParagraphBlock,
  ParagraphAttrs,
  ParagraphSpacing,
  ParagraphIndent,
  ParagraphBorders,
  ParagraphBorder,
  ParagraphShading,
  TabStop,
  Run,
} from "./types.js";
import type { ProjectionIdAllocator } from "./block-id.js";
import { projectRuns } from "./run-projector.js";
import {
  normalizeColor,
  rawParagraphToStyleEngine,
  rawRunToStyleEngine,
  styleEngineRunToFormatting,
} from "./style-engine-adapters.js";
import {
  paragraphLineToLayoutSpacing,
  twipsToLayoutPx,
} from "./measurement-conversions.js";

type BorderLike = {
  readonly val?: string;
  readonly color?: string;
  readonly space?: number;
  readonly sz?: number;
  readonly size?: number;
};

export function projectParagraph(
  entity: ParagraphEntity,
  model: SemanticModel,
  ids: ProjectionIdAllocator,
  resolver?: StyleResolver,
): ParagraphBlock {
  const raw = entity.raw();
  const resolvedParagraph = resolver
    ? resolver.resolveParagraphProperties(rawParagraphToStyleEngine(raw))
    : undefined;

  const attrs = buildParagraphAttrs(raw, resolvedParagraph);

  return {
    kind: "paragraph",
    id: ids.nextBlockId("paragraph", entity.ref),
    runs: collectRuns(entity, model, resolver, resolvedParagraph),
    ...(attrs ? { attrs } : {}),
  };
}

function collectRuns(
  entity: ParagraphEntity,
  model: SemanticModel,
  resolver: StyleResolver | undefined,
  resolvedParagraph: ResolvedParagraphProperties | undefined,
): Run[] {
  const projectedRuns: Run[] = [];

  for (const runEntity of model.runs(entity.ref)) {
    const resolvedFormatting = resolver
      ? styleEngineRunToFormatting(
          resolver.resolveRunProperties(
            rawRunToStyleEngine(runEntity.raw().formatting),
            resolvedParagraph,
          ),
        )
      : undefined;

    for (const projectedRun of projectRuns(runEntity, model, resolvedFormatting)) {
      projectedRuns.push(projectedRun);
    }
  }

  return projectedRuns;
}

function buildParagraphAttrs(
  raw: ParagraphRawProperties,
  resolved: ResolvedParagraphProperties | undefined,
): ParagraphAttrs | undefined {
  const attrs: ParagraphAttrs = {};
  let hasContent = false;

  const styleId = resolved?.styleId ?? raw.styleId;
  if (styleId) {
    attrs.styleId = styleId;
    hasContent = true;
  }

  const alignment = resolved?.justification ?? raw.alignment;
  if (alignment) {
    const mappedAlignment = mapAlignment(alignment);
    if (mappedAlignment) {
      attrs.alignment = mappedAlignment;
      hasContent = true;
    }
  }

  const spacing = buildSpacing(resolved?.spacing ?? raw.spacing);
  if (spacing) {
    attrs.spacing = spacing;
    hasContent = true;
  }

  if (resolved?.contextualSpacing ?? raw.contextualSpacing) {
    attrs.contextualSpacing = true;
    hasContent = true;
  }

  const indent = buildIndent(resolved?.indent ?? raw.indentation);
  if (indent) {
    attrs.indent = indent;
    hasContent = true;
  }

  const numbering = resolved?.numberingProperties ?? toResolvedNumbering(raw.numPr);
  if (numbering) {
    attrs.numberingProperties = {
      numId: numbering.numId ?? 0,
      ilvl: numbering.ilvl ?? 0,
    };
    hasContent = true;
  }

  const borders = buildBorders(resolved?.borders ?? raw.borders);
  if (borders) {
    attrs.borders = borders;
    hasContent = true;
  }

  const shading = buildShading(resolved?.shading);
  if (shading) {
    attrs.shading = shading;
    hasContent = true;
  }

  const tabs = resolved?.tabStops
    ? buildResolvedTabs(resolved.tabStops)
    : buildTabs(raw.tabs);
  if (tabs) {
    attrs.tabs = tabs;
    hasContent = true;
  }

  if (resolved?.keepNext ?? raw.keepNext) {
    attrs.keepNext = true;
    hasContent = true;
  }
  if (resolved?.keepLines ?? raw.keepLines) {
    attrs.keepLines = true;
    hasContent = true;
  }
  if (resolved?.pageBreakBefore ?? raw.pageBreakBefore) {
    attrs.pageBreakBefore = true;
    hasContent = true;
  }

  if (resolved?.rightToLeft ?? raw.bidi) {
    attrs.direction = "rtl";
    attrs.rtl = true;
    hasContent = true;
  }

  return hasContent
    ? attrs
    : undefined;
}

function buildSpacing(
  spacing: ParagraphRawProperties["spacing"] | ResolvedParagraphProperties["spacing"],
): ParagraphSpacing | undefined {
  if (!spacing) {
    return undefined;
  }

  const result: ParagraphSpacing = {};
  let hasValue = false;

  if (spacing.before !== undefined) {
    result.before = twipsToLayoutPx(spacing.before);
    hasValue = true;
  }
  if (spacing.after !== undefined) {
    result.after = twipsToLayoutPx(spacing.after);
    hasValue = true;
  }
  const normalizedLineSpacing = paragraphLineToLayoutSpacing(
    spacing.line,
    spacing.lineRule,
  );
  if (normalizedLineSpacing) {
    result.line = normalizedLineSpacing.value;
    result.lineUnit = normalizedLineSpacing.unit;
    hasValue = true;
  }
  if (spacing.lineRule) {
    result.lineRule = mapLineRule(spacing.lineRule);
    hasValue = true;
  }
  if (spacing.beforeAutospacing) {
    result.beforeAutospacing = true;
    hasValue = true;
  }
  if (spacing.afterAutospacing) {
    result.afterAutospacing = true;
    hasValue = true;
  }

  return hasValue
    ? result
    : undefined;
}

function buildIndent(
  indent: ParagraphRawProperties["indentation"] | ResolvedParagraphProperties["indent"],
): ParagraphIndent | undefined {
  if (!indent) {
    return undefined;
  }

  const result: ParagraphIndent = {};
  let hasValue = false;

  if (indent.left !== undefined) {
    result.left = twipsToLayoutPx(indent.left);
    hasValue = true;
  }
  if (indent.right !== undefined) {
    result.right = twipsToLayoutPx(indent.right);
    hasValue = true;
  }
  if (indent.firstLine !== undefined) {
    result.firstLine = twipsToLayoutPx(indent.firstLine);
    hasValue = true;
  }
  if (indent.hanging !== undefined) {
    result.hanging = twipsToLayoutPx(indent.hanging);
    hasValue = true;
  }

  return hasValue
    ? result
    : undefined;
}

function buildBorders(
  borders: ParagraphRawProperties["borders"] | ResolvedParagraphProperties["borders"],
): ParagraphBorders | undefined {
  if (!borders) {
    return undefined;
  }

  const result: ParagraphBorders = {};
  let hasValue = false;

  for (const side of ["top", "bottom", "left", "right", "between"] as const) {
    const border = borders[side];
    if (!border) {
      continue;
    }

    const mappedBorder = mapBorder(border);
    if (!mappedBorder) {
      continue;
    }

    result[side] = mappedBorder;
    hasValue = true;
  }

  return hasValue
    ? result
    : undefined;
}

function mapBorder(
  border: BorderLike,
): ParagraphBorder | undefined {
  if (!border.val || border.val === "none" || border.val === "nil") {
    return undefined;
  }

  return {
    style: mapBorderStyle(border.val),
    ...((border.sz ?? border.size) !== undefined ? { width: (border.sz ?? border.size)! / 8 } : {}),
    ...(border.color && border.color !== "auto"
      ? { color: normalizeColor(border.color) }
      : {}),
    ...(border.space !== undefined ? { space: border.space } : {}),
  };
}

function buildShading(
  shading: ResolvedParagraphProperties["shading"] | undefined,
): ParagraphShading | undefined {
  if (!shading) {
    return undefined;
  }

  const result: ParagraphShading = {};
  let hasValue = false;

  if (shading.fill) {
    result.fill = normalizeColor(shading.fill);
    hasValue = true;
  }
  if (shading.color) {
    result.color = normalizeColor(shading.color);
    hasValue = true;
  }
  if (shading.val) {
    result.val = shading.val;
    hasValue = true;
  }

  return hasValue
    ? result
    : undefined;
}

function buildTabs(
  tabs: readonly EntityTabStop[] | undefined,
): TabStop[] | undefined {
  if (!tabs || tabs.length === 0) {
    return undefined;
  }

  return tabs.map((tab) => ({
    val: mapTabAlignment(tab.val),
    pos: tab.pos,
    ...(tab.leader ? { leader: mapTabLeader(tab.leader) } : {}),
  }));
}

function buildResolvedTabs(
  tabs: readonly ParagraphTabStop[],
): TabStop[] | undefined {
  const result: TabStop[] = [];

  for (const entry of tabs) {
    const tab = entry.tab;
    if (!tab || tab.pos === undefined) {
      continue;
    }

    result.push({
      val: mapTabAlignment(tab.tabType),
      pos: tab.pos,
      ...(tab.leader ? { leader: mapTabLeader(tab.leader) } : {}),
    });
  }

  return result.length > 0
    ? result
    : undefined;
}

function toResolvedNumbering(
  numbering: ParagraphRawProperties["numPr"],
): ResolvedParagraphProperties["numberingProperties"] | undefined {
  if (!numbering) {
    return undefined;
  }

  return {
    numId: Number(numbering.numId),
    ilvl: Number(numbering.ilvl),
  };
}

function mapAlignment(
  value: string,
): ParagraphAttrs["alignment"] | undefined {
  switch (value) {
    case "left":
    case "start":
      return "left";
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    case "both":
    case "justify":
    case "distribute":
      return "justify";
    default:
      return undefined;
  }
}

function mapLineRule(
  value: string,
): ParagraphSpacing["lineRule"] {
  switch (value) {
    case "exact":
      return "exact";
    case "atLeast":
      return "atLeast";
    default:
      return "auto";
  }
}

function mapBorderStyle(
  value: string,
): ParagraphBorder["style"] {
  switch (value) {
    case "double":
    case "triple":
    case "thinThickSmallGap":
    case "thickThinSmallGap":
    case "thinThickMediumGap":
    case "thickThinMediumGap":
    case "thinThickLargeGap":
    case "thickThinLargeGap":
      return "double";
    case "dashed":
    case "dashSmallGap":
    case "dotDash":
    case "dotDotDash":
      return "dashed";
    case "dotted":
      return "dotted";
    case "none":
    case "nil":
      return "none";
    default:
      return "solid";
  }
}

function mapTabAlignment(
  value: string | undefined,
): TabStop["val"] {
  switch (value) {
    case "right":
    case "end":
      return "end";
    case "center":
      return "center";
    case "decimal":
      return "decimal";
    case "bar":
      return "bar";
    case "clear":
      return "clear";
    case "left":
    case "start":
    default:
      return "start";
  }
}

function mapTabLeader(
  value: string,
): TabStop["leader"] {
  switch (value) {
    case "dot":
      return "dot";
    case "hyphen":
      return "hyphen";
    case "heavy":
      return "heavy";
    case "underscore":
      return "underscore";
    case "middleDot":
      return "middleDot";
    default:
      return "none";
  }
}
