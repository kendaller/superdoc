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

import type { SemanticModel } from '../../model.js';
import type {
  ParagraphEntity,
  ParagraphRawProperties,
  RunFormatting,
  TabStop as EntityTabStop,
} from '../../entities/types.js';
import type { StyleResolver } from '../../resolve/style-resolver.js';
import type {
  ParagraphProperties as ResolvedParagraphProperties,
  ParagraphTabStop,
} from '@superdoc/style-engine/ooxml';
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
  TextRun,
} from './types.js';
import type { ProjectionIdAllocator } from './block-id.js';
import type { StableIdAllocator } from './stable-id.js';
import type { ProjectionFeeder, FeederNode, DisplayRunSource } from './feeder.js';
import type { DependencyCollector } from './dependency-manifest.js';
import { projectRuns, projectRunSegmentsFromFeeder, projectExtractedRunSegments } from './run-projector.js';
import type { ResolvedRunProperties } from './run-projector.js';
import type { ParagraphRenderPlan } from './paragraph-render-plan.js';
import {
  normalizeColor,
  rawParagraphToStyleEngine,
  rawRunToStyleEngine,
  styleEngineRunToFormatting,
} from './style-engine-adapters.js';
import { paragraphLineToLayoutSpacing, twipsToLayoutPx } from './measurement-conversions.js';

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
  const resolvedParagraph = resolver ? resolver.resolveParagraphProperties(rawParagraphToStyleEngine(raw)) : undefined;

  const attrs = buildParagraphAttrs(raw, resolvedParagraph);

  return {
    kind: 'paragraph',
    id: ids.nextBlockId('paragraph', entity.ref, entity.sourceRefs[0]),
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
          resolver.resolveRunProperties(rawRunToStyleEngine(runEntity.raw().formatting), resolvedParagraph),
        )
      : undefined;

    for (const projectedRun of projectRuns(runEntity, model, resolvedFormatting)) {
      projectedRuns.push(projectedRun);
    }
  }

  return projectedRuns;
}

/**
 * Feeder-based paragraph projection.
 *
 * Projects a paragraph FeederNode to a layout-compatible ParagraphBlock.
 * Uses the same `buildParagraphAttrs` helpers as the entity-based path.
 */
export function projectParagraphFromFeeder(
  node: FeederNode<'paragraph'>,
  feeder: ProjectionFeeder,
  ids: StableIdAllocator,
  resolver?: StyleResolver,
  deps?: DependencyCollector,
  renderPlan?: ParagraphRenderPlan,
): ParagraphBlock {
  const raw = node.raw();
  const resolvedParagraph = resolver ? resolver.resolveParagraphProperties(rawParagraphToStyleEngine(raw)) : undefined;

  const attrs = buildParagraphAttrs(raw, resolvedParagraph);

  return {
    kind: 'paragraph',
    id: ids.blockId('paragraph', node.sourceAnchor),
    runs: collectParagraphRuns(node, feeder, resolver, resolvedParagraph, deps, renderPlan),
    ...(attrs ? { attrs } : {}),
  };
}

function collectParagraphRuns(
  paragraphNode: FeederNode<'paragraph'>,
  feeder: ProjectionFeeder,
  resolver: StyleResolver | undefined,
  resolvedParagraph: ResolvedParagraphProperties | undefined,
  deps?: DependencyCollector,
  renderPlan?: ParagraphRenderPlan,
): Run[] {
  if (renderPlan?.mode === 'display-fast-path') {
    return collectDisplayRunsFromFeeder(paragraphNode, feeder, resolver, resolvedParagraph, renderPlan);
  }

  return collectRunsFromFeeder(paragraphNode, feeder, resolver, resolvedParagraph, deps);
}

function collectRunsFromFeeder(
  paragraphNode: FeederNode<'paragraph'>,
  feeder: ProjectionFeeder,
  resolver: StyleResolver | undefined,
  resolvedParagraph: ResolvedParagraphProperties | undefined,
  deps?: DependencyCollector,
): Run[] {
  const projectedRuns: Run[] = [];

  for (const runNode of feeder.paragraphRuns(paragraphNode)) {
    const runRaw = runNode.raw();
    const resolvedFormatting: ResolvedRunProperties | undefined = resolver
      ? styleEngineRunToFormatting(
          resolver.resolveRunProperties(rawRunToStyleEngine(runRaw.formatting), resolvedParagraph),
        )
      : undefined;

    for (const run of projectRunSegmentsFromFeeder(runNode, runRaw, feeder, resolvedFormatting, deps)) {
      projectedRuns.push(run);
    }
  }

  return projectedRuns;
}

function collectDisplayRunsFromFeeder(
  paragraphNode: FeederNode<'paragraph'>,
  feeder: ProjectionFeeder,
  resolver: StyleResolver | undefined,
  resolvedParagraph: ResolvedParagraphProperties | undefined,
  renderPlan: ParagraphRenderPlan,
): Run[] {
  const projectedRuns: Run[] = [];
  const resolvedFormattingCache = new Map<string, ResolvedRunProperties | null>();

  for (const displayRun of feeder.paragraphDisplayRuns(paragraphNode, renderPlan.instructionRunIds)) {
    const resolvedFormatting = resolveDisplayRunFormatting(
      displayRun,
      resolver,
      resolvedParagraph,
      resolvedFormattingCache,
    );

    for (const projectedRun of projectExtractedRunSegments(displayRun.raw, resolvedFormatting)) {
      pushCoalescedRun(projectedRuns, projectedRun);
    }
  }

  return projectedRuns;
}

function resolveDisplayRunFormatting(
  displayRun: DisplayRunSource,
  resolver: StyleResolver | undefined,
  resolvedParagraph: ResolvedParagraphProperties | undefined,
  cache: Map<string, ResolvedRunProperties | null>,
): ResolvedRunProperties | undefined {
  if (!resolver) {
    return undefined;
  }

  const signature = runFormattingSignature(displayRun.raw.formatting);
  if (cache.has(signature)) {
    return cache.get(signature) ?? undefined;
  }

  const resolved = styleEngineRunToFormatting(
    resolver.resolveRunProperties(rawRunToStyleEngine(displayRun.raw.formatting), resolvedParagraph),
  );
  cache.set(signature, resolved ?? null);
  return resolved;
}

function pushCoalescedRun(target: Run[], nextRun: Run): void {
  const previousRun = target[target.length - 1];
  if (!previousRun) {
    target.push(nextRun);
    return;
  }

  if (isTextLikeRun(previousRun) && isTextLikeRun(nextRun) && canCoalesceTextRuns(previousRun, nextRun)) {
    previousRun.text += nextRun.text;
    return;
  }

  target.push(nextRun);
}

function canCoalesceTextRuns(previousRun: TextRun, nextRun: TextRun): boolean {
  return (
    previousRun.fontFamily === nextRun.fontFamily &&
    previousRun.fontSize === nextRun.fontSize &&
    previousRun.bold === nextRun.bold &&
    previousRun.italic === nextRun.italic &&
    previousRun.letterSpacing === nextRun.letterSpacing &&
    previousRun.color === nextRun.color &&
    previousRun.strike === nextRun.strike &&
    previousRun.highlight === nextRun.highlight &&
    previousRun.textTransform === nextRun.textTransform &&
    previousRun.vertAlign === nextRun.vertAlign &&
    previousRun.baselineShift === nextRun.baselineShift &&
    underlineSignature(previousRun.underline) === underlineSignature(nextRun.underline)
  );
}

function isTextLikeRun(run: Run): run is TextRun {
  return run.kind === undefined || run.kind === 'text';
}

function underlineSignature(underline: TextRun['underline']): string {
  if (!underline) {
    return '';
  }

  return `${underline.style ?? ''}:${underline.color ?? ''}`;
}

function runFormattingSignature(formatting: Partial<RunFormatting>): string {
  return [
    formatting.rStyle ?? '',
    formatting.bold ? '1' : '0',
    formatting.boldCs ? '1' : '0',
    formatting.italic ? '1' : '0',
    formatting.italicCs ? '1' : '0',
    formatting.underline ?? '',
    formatting.strike ? '1' : '0',
    formatting.dstrike ? '1' : '0',
    formatting.fontSize ?? '',
    formatting.fontSizeCs ?? '',
    formatting.fontFamily ?? '',
    formatting.fontFamilyCs ?? '',
    formatting.color ?? '',
    formatting.highlight ?? '',
    formatting.vertAlign ?? '',
    formatting.caps ? '1' : '0',
    formatting.smallCaps ? '1' : '0',
    formatting.vanish ? '1' : '0',
    formatting.lang ?? '',
    formatting.spacing ?? '',
    formatting.kern ?? '',
    formatting.position ?? '',
    formatting.shading?.fill ?? '',
    formatting.shading?.color ?? '',
    formatting.shading?.val ?? '',
  ].join('|');
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

  const tabs = resolved?.tabStops ? buildResolvedTabs(resolved.tabStops) : buildTabs(raw.tabs);
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
    attrs.direction = 'rtl';
    attrs.rtl = true;
    hasContent = true;
  }

  return hasContent ? attrs : undefined;
}

function buildSpacing(
  spacing: ParagraphRawProperties['spacing'] | ResolvedParagraphProperties['spacing'],
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
  const normalizedLineSpacing = paragraphLineToLayoutSpacing(spacing.line, spacing.lineRule);
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

  return hasValue ? result : undefined;
}

function buildIndent(
  indent: ParagraphRawProperties['indentation'] | ResolvedParagraphProperties['indent'],
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

  return hasValue ? result : undefined;
}

function buildBorders(
  borders: ParagraphRawProperties['borders'] | ResolvedParagraphProperties['borders'],
): ParagraphBorders | undefined {
  if (!borders) {
    return undefined;
  }

  const result: ParagraphBorders = {};
  let hasValue = false;

  for (const side of ['top', 'bottom', 'left', 'right', 'between'] as const) {
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

  return hasValue ? result : undefined;
}

function mapBorder(border: BorderLike): ParagraphBorder | undefined {
  if (!border.val || border.val === 'none' || border.val === 'nil') {
    return undefined;
  }

  return {
    style: mapBorderStyle(border.val),
    ...((border.sz ?? border.size) !== undefined ? { width: (border.sz ?? border.size)! / 8 } : {}),
    ...(border.color && border.color !== 'auto' ? { color: normalizeColor(border.color) } : {}),
    ...(border.space !== undefined ? { space: border.space } : {}),
  };
}

function buildShading(shading: ResolvedParagraphProperties['shading'] | undefined): ParagraphShading | undefined {
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

  return hasValue ? result : undefined;
}

function buildTabs(tabs: readonly EntityTabStop[] | undefined): TabStop[] | undefined {
  if (!tabs || tabs.length === 0) {
    return undefined;
  }

  return tabs.map((tab) => ({
    val: mapTabAlignment(tab.val),
    pos: tab.pos,
    ...(tab.leader ? { leader: mapTabLeader(tab.leader) } : {}),
  }));
}

function buildResolvedTabs(tabs: readonly ParagraphTabStop[]): TabStop[] | undefined {
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

  return result.length > 0 ? result : undefined;
}

function toResolvedNumbering(
  numbering: ParagraphRawProperties['numPr'],
): ResolvedParagraphProperties['numberingProperties'] | undefined {
  if (!numbering) {
    return undefined;
  }

  return {
    numId: Number(numbering.numId),
    ilvl: Number(numbering.ilvl),
  };
}

function mapAlignment(value: string): ParagraphAttrs['alignment'] | undefined {
  switch (value) {
    case 'left':
    case 'start':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    case 'both':
    case 'justify':
    case 'distribute':
      return 'justify';
    default:
      return undefined;
  }
}

function mapLineRule(value: string): ParagraphSpacing['lineRule'] {
  switch (value) {
    case 'exact':
      return 'exact';
    case 'atLeast':
      return 'atLeast';
    default:
      return 'auto';
  }
}

function mapBorderStyle(value: string): ParagraphBorder['style'] {
  switch (value) {
    case 'double':
    case 'triple':
    case 'thinThickSmallGap':
    case 'thickThinSmallGap':
    case 'thinThickMediumGap':
    case 'thickThinMediumGap':
    case 'thinThickLargeGap':
    case 'thickThinLargeGap':
      return 'double';
    case 'dashed':
    case 'dashSmallGap':
    case 'dotDash':
    case 'dotDotDash':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    case 'none':
    case 'nil':
      return 'none';
    default:
      return 'solid';
  }
}

function mapTabAlignment(value: string | undefined): TabStop['val'] {
  switch (value) {
    case 'right':
    case 'end':
      return 'end';
    case 'center':
      return 'center';
    case 'decimal':
      return 'decimal';
    case 'bar':
      return 'bar';
    case 'clear':
      return 'clear';
    case 'left':
    case 'start':
    default:
      return 'start';
  }
}

function mapTabLeader(value: string): TabStop['leader'] {
  switch (value) {
    case 'dot':
      return 'dot';
    case 'hyphen':
      return 'hyphen';
    case 'heavy':
      return 'heavy';
    case 'underscore':
      return 'underscore';
    case 'middleDot':
      return 'middleDot';
    default:
      return 'none';
  }
}
