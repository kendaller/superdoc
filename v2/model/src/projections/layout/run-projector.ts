// ---------------------------------------------------------------------------
// Run projector — converts run entity inline segments to layout Run types
//
// Walks the InlineSegment[] on a RunEntity and produces an array of
// contract-compatible Run objects (TextRun, TabRun, LineBreakRun, BreakRun).
//
// Formatting is drawn from the run entity's raw RunFormatting, with an
// optional resolved-properties overlay for style-engine integration.
// ---------------------------------------------------------------------------

import type { SemanticModel } from '../../model.js';
import type { DrawingEntity, RunEntity, RunFormatting, RunRawProperties } from '../../entities/types.js';
import type { DrawingSegment, InlineSegment } from '../../entities/inline-segments.js';
import type { Run, RunMarks, TextRun, ImageRun, TabRun, LineBreakRun, BreakRun } from './types.js';
import type { ProjectionFeeder, FeederNode } from './feeder.js';
import type { DependencyCollector } from './dependency-manifest.js';
import { createSourceRef } from '../../identity/types.js';
import { halfPointsToLayoutPx, twipsToLayoutPx } from './measurement-conversions.js';

/** Default font family when none is specified. */
const DEFAULT_FONT_FAMILY = 'Calibri';

/** Default font size in layout pixels when no DOCX size is resolved. */
const DEFAULT_FONT_SIZE = 12;

/** OOXML EMUs per CSS pixel at 96dpi. */
const EMUS_PER_PIXEL = 9525;

/**
 * Optional resolved run properties. When provided, these take precedence
 * over the entity's raw formatting for style-resolved rendering.
 */
export type ResolvedRunProperties = Partial<RunFormatting>;
export type ProjectableRunRaw = Pick<RunRawProperties, 'formatting' | 'segments'>;

/**
 * Project a run entity's inline segments to layout-compatible Run objects.
 *
 * @param runEntity - The run entity to project.
 * @param resolved - Optional resolved run properties from the style engine.
 * @returns An array of Run objects for the layout engine.
 */
export function projectRuns(runEntity: RunEntity, model: SemanticModel, resolved?: ResolvedRunProperties): Run[] {
  const raw = runEntity.raw();
  const formatting = resolved ?? raw.formatting;
  const marks = buildRunMarks(formatting);
  const fontFamily = formatting.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fontSize = formatting.fontSize !== undefined ? halfPointsToLayoutPx(formatting.fontSize) : DEFAULT_FONT_SIZE;

  const runs: Run[] = [];

  for (const segment of raw.segments) {
    const projected = projectSegment(runEntity, segment, model, marks, fontFamily, fontSize);
    if (projected !== undefined) {
      runs.push(projected);
    }
  }

  return runs;
}

/**
 * Feeder-based run segment projection.
 *
 * Projects a run FeederNode's inline segments to layout-compatible Run objects.
 * Drawing resolution and dependency collection go through the feeder abstraction
 * instead of the semantic model.
 */
export function projectRunSegmentsFromFeeder(
  runNode: FeederNode<'run'>,
  raw: RunRawProperties,
  feeder: ProjectionFeeder,
  resolved?: ResolvedRunProperties,
  deps?: DependencyCollector,
): Run[] {
  const formatting = resolved ?? raw.formatting;
  const marks = buildRunMarks(formatting);
  const fontFamily = formatting.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fontSize = formatting.fontSize !== undefined ? halfPointsToLayoutPx(formatting.fontSize) : DEFAULT_FONT_SIZE;

  const runs: Run[] = [];

  for (const segment of raw.segments) {
    const projected = projectSegmentFromFeeder(runNode, segment, feeder, marks, fontFamily, fontSize, deps);
    if (projected !== undefined) {
      runs.push(projected);
    }
  }

  return runs;
}

/**
 * Project already-extracted run properties that do not require feeder/model
 * lookups for drawings.
 *
 * This is used by the display-first paragraph fast path, which extracts only
 * visible field-result runs and intentionally excludes complex drawing-backed
 * content.
 */
export function projectExtractedRunSegments(raw: ProjectableRunRaw, resolved?: ResolvedRunProperties): Run[] {
  const formatting = resolved ?? raw.formatting;
  const marks = buildRunMarks(formatting);
  const fontFamily = formatting.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fontSize = formatting.fontSize !== undefined ? halfPointsToLayoutPx(formatting.fontSize) : DEFAULT_FONT_SIZE;
  const runs: Run[] = [];

  for (const segment of raw.segments) {
    const projected = projectExtractedSegment(segment, marks, fontFamily, fontSize);
    if (projected !== undefined) {
      runs.push(projected);
    }
  }

  return runs;
}

function projectSegmentFromFeeder(
  runNode: FeederNode<'run'>,
  segment: InlineSegment,
  feeder: ProjectionFeeder,
  marks: RunMarks,
  fontFamily: string,
  fontSize: number,
  deps?: DependencyCollector,
): Run | undefined {
  switch (segment.segmentKind) {
    case 'text':
      return projectTextSegment(segment.text, marks, fontFamily, fontSize);
    case 'tab':
      return projectTabSegment(marks);
    case 'break':
      return projectBreakSegment(segment.breakType);
    case 'symbol':
      return projectTextSegment(segment.char, marks, segment.font ?? fontFamily, fontSize);
    case 'drawing':
      return projectDrawingFromFeeder(runNode, segment, feeder, deps);
    case 'footnoteRef':
      if (deps) deps.addFootnote(segment.footnoteId);
      return projectFootnoteRef(segment.footnoteId, marks, fontFamily, fontSize);
    case 'endnoteRef':
      if (deps) deps.addEndnote(segment.endnoteId);
      return projectEndnoteRef(segment.endnoteId, marks, fontFamily, fontSize);
    case 'softHyphen':
      return projectTextSegment('\u00AD', marks, fontFamily, fontSize);
    case 'noBreakHyphen':
      return projectTextSegment('\u2011', marks, fontFamily, fontSize);
    case 'fieldChar':
    case 'instrText':
    case 'deletedText':
    case 'preserved':
      return undefined;
  }
}

function projectExtractedSegment(
  segment: InlineSegment,
  marks: RunMarks,
  fontFamily: string,
  fontSize: number,
): Run | undefined {
  switch (segment.segmentKind) {
    case 'text':
      return projectTextSegment(segment.text, marks, fontFamily, fontSize);
    case 'tab':
      return projectTabSegment(marks);
    case 'break':
      return projectBreakSegment(segment.breakType);
    case 'symbol':
      return projectTextSegment(segment.char, marks, segment.font ?? fontFamily, fontSize);
    case 'footnoteRef':
      return projectFootnoteRef(segment.footnoteId, marks, fontFamily, fontSize);
    case 'endnoteRef':
      return projectEndnoteRef(segment.endnoteId, marks, fontFamily, fontSize);
    case 'softHyphen':
      return projectTextSegment('\u00AD', marks, fontFamily, fontSize);
    case 'noBreakHyphen':
      return projectTextSegment('\u2011', marks, fontFamily, fontSize);
    case 'drawing':
    case 'fieldChar':
    case 'instrText':
    case 'deletedText':
    case 'preserved':
      return undefined;
  }
}

function projectDrawingFromFeeder(
  runNode: FeederNode<'run'>,
  segment: DrawingSegment,
  feeder: ProjectionFeeder,
  deps?: DependencyCollector,
): ImageRun | undefined {
  const result = feeder.resolveDrawing(runNode, segment.localId);
  if (!result) return undefined;

  const raw = result.raw;
  if (!raw.isInline || raw.drawingType !== 'image' || !raw.blipRelId) {
    return undefined;
  }
  if (raw.width === undefined || raw.height === undefined) {
    return undefined;
  }

  if (deps) {
    deps.addImage(raw.blipRelId, runNode.sourceAnchor.partUri);
  }

  const source = result.imageSrc;
  if (!source) return undefined;

  return {
    kind: 'image',
    src: source,
    width: emuToPixels(raw.width),
    height: emuToPixels(raw.height),
    ...(raw.description ? { alt: raw.description, title: raw.description } : {}),
    verticalAlign: 'bottom',
  };
}

// ---- Segment dispatch -------------------------------------------------------

function projectSegment(
  runEntity: RunEntity,
  segment: InlineSegment,
  model: SemanticModel,
  marks: RunMarks,
  fontFamily: string,
  fontSize: number,
): Run | undefined {
  switch (segment.segmentKind) {
    case 'text':
      return projectTextSegment(segment.text, marks, fontFamily, fontSize);
    case 'tab':
      return projectTabSegment(marks);
    case 'break':
      return projectBreakSegment(segment.breakType);
    case 'symbol':
      return projectTextSegment(segment.char, marks, segment.font ?? fontFamily, fontSize);
    case 'drawing':
      return projectDrawingSegment(runEntity, segment, model);
    case 'footnoteRef':
      return projectFootnoteRef(segment.footnoteId, marks, fontFamily, fontSize);
    case 'endnoteRef':
      return projectEndnoteRef(segment.endnoteId, marks, fontFamily, fontSize);
    case 'softHyphen':
      return projectTextSegment('\u00AD', marks, fontFamily, fontSize);
    case 'noBreakHyphen':
      return projectTextSegment('\u2011', marks, fontFamily, fontSize);
    // Not yet projected — dropped from FlowBlock output:
    // - fieldChar/instrText: field display requires field resolver + layout data
    // - deletedText: requires tracked-changes mode filtering
    // - preserved: unknown inline elements have no layout representation
    case 'fieldChar':
    case 'instrText':
    case 'deletedText':
    case 'preserved':
      return undefined;
  }
}

// ---- Individual segment projectors ------------------------------------------

function projectTextSegment(text: string, marks: RunMarks, fontFamily: string, fontSize: number): TextRun {
  return {
    text,
    fontFamily,
    fontSize,
    ...marks,
  };
}

function projectDrawingSegment(
  runEntity: RunEntity,
  segment: DrawingSegment,
  model: SemanticModel,
): ImageRun | undefined {
  const runSource = runEntity.sourceRefs[0];
  if (!runSource) {
    return undefined;
  }

  const drawingEntity = model.entityBySourceRef(createSourceRef(runSource.partUri, segment.localId));
  if (!drawingEntity || drawingEntity.kind !== 'drawing') {
    return undefined;
  }

  const raw = (drawingEntity as DrawingEntity).raw();
  if (!raw.isInline || raw.drawingType !== 'image' || !raw.blipRelId) {
    return undefined;
  }

  const source = model.resolveRelationshipTarget(runSource.partUri, raw.blipRelId);
  if (!source || raw.width === undefined || raw.height === undefined) {
    return undefined;
  }

  return {
    kind: 'image',
    src: source,
    width: emuToPixels(raw.width),
    height: emuToPixels(raw.height),
    ...(raw.description ? { alt: raw.description, title: raw.description } : {}),
    verticalAlign: 'bottom',
  };
}

function projectTabSegment(marks: RunMarks): TabRun {
  return {
    kind: 'tab',
    text: '\t',
    ...marks,
  };
}

function emuToPixels(value: number): number {
  return Math.max(1, Math.round(value / EMUS_PER_PIXEL));
}

function projectBreakSegment(breakType: 'line' | 'page' | 'column' | 'textWrapping'): LineBreakRun | BreakRun {
  if (breakType === 'line' || breakType === 'textWrapping') {
    return { kind: 'lineBreak' };
  }
  return { kind: 'break', breakType };
}

function projectFootnoteRef(footnoteId: string, marks: RunMarks, fontFamily: string, fontSize: number): TextRun {
  return {
    text: footnoteId,
    fontFamily,
    fontSize,
    ...marks,
    vertAlign: 'superscript',
  };
}

function projectEndnoteRef(endnoteId: string, marks: RunMarks, fontFamily: string, fontSize: number): TextRun {
  return {
    text: endnoteId,
    fontFamily,
    fontSize,
    ...marks,
    vertAlign: 'superscript',
  };
}

// ---- Formatting helpers -----------------------------------------------------

/**
 * Build RunMarks from raw or resolved RunFormatting.
 * Only includes properties that are explicitly set (truthy or non-undefined).
 */
function buildRunMarks(formatting: Partial<RunFormatting>): RunMarks {
  const marks: RunMarks = {};

  if (formatting.bold) {
    marks.bold = true;
  }
  if (formatting.italic) {
    marks.italic = true;
  }
  if (formatting.strike || formatting.dstrike) {
    marks.strike = true;
  }
  if (formatting.underline && formatting.underline !== 'none') {
    marks.underline = { style: mapUnderlineStyle(formatting.underline) };
  }
  if (formatting.color) {
    marks.color = normalizeColor(formatting.color);
  }
  if (formatting.highlight) {
    marks.highlight = formatting.highlight;
  }
  if (formatting.spacing !== undefined) {
    marks.letterSpacing = twipsToLayoutPx(formatting.spacing);
  }
  if (formatting.position !== undefined) {
    marks.baselineShift = formatting.position / 2;
  }
  if (formatting.vertAlign) {
    marks.vertAlign = mapVertAlign(formatting.vertAlign);
  }
  if (formatting.caps) {
    marks.textTransform = 'uppercase';
  } else if (formatting.smallCaps) {
    marks.textTransform = 'uppercase';
  }

  return marks;
}

/**
 * Map OOXML underline values to the layout engine's style subset.
 */
function mapUnderlineStyle(value: string): 'single' | 'double' | 'dotted' | 'dashed' | 'wavy' {
  switch (value) {
    case 'double':
      return 'double';
    case 'dotted':
    case 'dottedHeavy':
      return 'dotted';
    case 'dash':
    case 'dashLong':
    case 'dashLongHeavy':
    case 'dashDotHeavy':
      return 'dashed';
    case 'wave':
    case 'wavyDouble':
    case 'wavyHeavy':
      return 'wavy';
    default:
      return 'single';
  }
}

/**
 * Map OOXML vertAlign string to the layout engine's enum.
 */
function mapVertAlign(value: string): 'superscript' | 'subscript' | 'baseline' {
  if (value === 'superscript') return 'superscript';
  if (value === 'subscript') return 'subscript';
  return 'baseline';
}

/**
 * Normalize a color value. Prepends '#' if it looks like a raw hex value
 * without one. Passes through "auto" and named colors unchanged.
 */
function normalizeColor(color: string): string {
  if (color === 'auto') return color;
  if (/^[0-9a-fA-F]{6}$/.test(color)) return `#${color}`;
  return color;
}
