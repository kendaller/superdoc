import { DATA_ATTRS } from '@superdoc/dom-contract';
import type { FlowBlock, ParagraphBlock } from '@superdoc/contracts';
import {
  makeStableBlockId,
  sourceRefToSourceAnchor,
  type EntityRef,
  type InlineSegment,
  type SemanticModel,
  type SourceRef,
} from '@superdoc/v2-model';

export type V2EditableSegmentKind =
  | 'text'
  | 'tab'
  | 'symbol'
  | 'softHyphen'
  | 'noBreakHyphen'
  | 'footnoteRef'
  | 'endnoteRef';

export type V2EditableTextSegment = {
  readonly segmentKind: V2EditableSegmentKind;
  readonly isMutableText: boolean;
  readonly runRef: EntityRef;
  readonly runSourceRef: SourceRef;
  readonly runIndex: number;
  readonly segmentIndex: number;
  readonly segmentId: string;
  readonly text: string;
  readonly paragraphStart: number;
  readonly paragraphEnd: number;
  readonly runTextStart: number;
  readonly runTextEnd: number;
};

export type V2EditableParagraph = {
  readonly blockId: string;
  readonly storyId: string;
  readonly paragraphRef: EntityRef;
  readonly paragraphSourceRef: SourceRef;
  readonly text: string;
  readonly segments: readonly V2EditableTextSegment[];
  readonly supported: boolean;
  readonly unsupportedReason?: string;
};

export type V2EditableDocumentSnapshot = {
  readonly blockToEntityRef: ReadonlyMap<string, EntityRef>;
  readonly paragraphsByBlockId: ReadonlyMap<string, V2EditableParagraph>;
  readonly orderedParagraphs: readonly V2EditableParagraph[];
};

export const EMPTY_EDITABLE_TEXT_PLACEHOLDER = '\u200B';

type ParagraphInteractionRewriteResult =
  | {
      ok: true;
      runs: ParagraphBlock['runs'];
    }
  | {
      ok: false;
      reason: string;
    };

export function buildEditableDocumentSnapshot(
  model: SemanticModel,
  blockToEntityRef: ReadonlyMap<string, EntityRef>,
): V2EditableDocumentSnapshot {
  const paragraphsByBlockId = new Map<string, V2EditableParagraph>();
  const orderedParagraphs: V2EditableParagraph[] = [];

  for (const [blockId, entityRef] of blockToEntityRef) {
    const entity = model.entity(entityRef);
    if (!entity || entity.kind !== 'paragraph') {
      continue;
    }

    const paragraph = describeParagraph(model, blockId, entityRef);
    paragraphsByBlockId.set(blockId, paragraph);
    orderedParagraphs.push(paragraph);
  }

  return {
    blockToEntityRef,
    paragraphsByBlockId,
    orderedParagraphs,
  };
}

export function buildEditableDocumentSnapshotFromSourceRefs(
  model: SemanticModel,
  blockToSourceRef: ReadonlyMap<string, Pick<SourceRef, 'partUri' | 'nodeId' | 'sourceNodePath'>>,
): V2EditableDocumentSnapshot {
  const blockToEntityRef = new Map<string, EntityRef>();

  for (const [blockId, sourceRef] of blockToSourceRef) {
    const entity = model.entityBySourceRef(sourceRef);
    if (!entity || entity.kind !== 'paragraph') {
      continue;
    }

    blockToEntityRef.set(blockId, entity.ref);
  }

  return buildEditableDocumentSnapshot(model, blockToEntityRef);
}

export function buildEditableDocumentSnapshotForBlockIds(
  model: SemanticModel,
  blockIds: Iterable<string>,
): V2EditableDocumentSnapshot {
  const requestedBlockIds = new Set(blockIds);
  const blockToEntityRef = new Map<string, EntityRef>();
  const mainStory = model.mainStory();
  if (!mainStory) {
    return buildEditableDocumentSnapshot(model, blockToEntityRef);
  }

  collectParagraphBlockRefs(model, mainStory.ref, requestedBlockIds, blockToEntityRef);
  if (shouldFallbackToAllParagraphs(blockToEntityRef.size, requestedBlockIds.size)) {
    collectParagraphBlockRefsFromAllParagraphs(model, requestedBlockIds, blockToEntityRef);
  }

  return buildEditableDocumentSnapshot(model, blockToEntityRef);
}

export function mergeEditableDocumentSnapshots(
  left: V2EditableDocumentSnapshot,
  right: V2EditableDocumentSnapshot,
  orderedBlockIds?: Iterable<string>,
): V2EditableDocumentSnapshot {
  const paragraphsByBlockId = new Map(left.paragraphsByBlockId);
  for (const [blockId, paragraph] of right.paragraphsByBlockId) {
    const existingParagraph = paragraphsByBlockId.get(blockId);
    paragraphsByBlockId.set(blockId, choosePreferredParagraph(existingParagraph, paragraph));
  }

  const blockToEntityRef = new Map<string, EntityRef>();
  for (const [blockId, paragraph] of paragraphsByBlockId) {
    blockToEntityRef.set(blockId, paragraph.paragraphRef);
  }

  const orderedParagraphs = orderMergedParagraphs(paragraphsByBlockId, left, right, orderedBlockIds);

  return {
    blockToEntityRef,
    paragraphsByBlockId,
    orderedParagraphs,
  };
}

export function applyEditableInteractionData(blocks: readonly FlowBlock[], snapshot: V2EditableDocumentSnapshot): void {
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
      continue;
    }

    const paragraph = snapshot.paragraphsByBlockId.get(block.id);
    if (!paragraph || !paragraph.supported) {
      clearParagraphInteractionData(block);
      continue;
    }

    applyEditableInteractionDataToParagraphBlock(block, paragraph);
  }
}

export function applyEditableInteractionDataToParagraphBlock(
  block: ParagraphBlock,
  paragraph: V2EditableParagraph,
): boolean {
  clearParagraphInteractionData(block);

  if (!paragraph.supported) {
    return false;
  }

  const rewriteResult = prepareParagraphInteractionRewrite(block, paragraph);
  if (!rewriteResult.ok) {
    console.debug('[V2EditableDocumentSnapshot] Paragraph interaction rewrite skipped', {
      blockId: block.id,
      paragraphSourceNodeId: paragraph.paragraphSourceRef.nodeId,
      reason: rewriteResult.reason,
      paragraphTextPreview: paragraph.text.slice(0, 80),
      renderedTextPreview: block.runs
        .filter(isEditableTextCarrierRun)
        .map((run) => run.text)
        .join('')
        .slice(0, 80),
    });
    return false;
  }

  block.runs = rewriteResult.runs;
  return true;
}

export function createOptimisticEditableParagraph(paragraph: V2EditableParagraph, text: string): V2EditableParagraph {
  const [firstSegment] = paragraph.segments;
  if (!firstSegment) {
    return {
      ...paragraph,
      text,
      segments: [],
      supported: false,
      unsupportedReason: 'Paragraph has no editable text segments',
    };
  }

  return {
    ...paragraph,
    text,
    segments: [
      {
        ...firstSegment,
        text,
        paragraphStart: 0,
        paragraphEnd: text.length,
        runTextStart: 0,
        runTextEnd: text.length,
      },
    ],
    supported: true,
  };
}

export function replaceSnapshotParagraph(
  snapshot: V2EditableDocumentSnapshot,
  paragraph: V2EditableParagraph,
): V2EditableDocumentSnapshot {
  const paragraphsByBlockId = new Map(snapshot.paragraphsByBlockId);
  paragraphsByBlockId.set(paragraph.blockId, paragraph);

  const orderedParagraphs = snapshot.orderedParagraphs.map((candidate) =>
    candidate.blockId === paragraph.blockId ? paragraph : candidate,
  );

  return {
    blockToEntityRef: snapshot.blockToEntityRef,
    paragraphsByBlockId,
    orderedParagraphs,
  };
}

export function describeEditableParagraphBySourceRef(
  model: SemanticModel,
  paragraphSourceRef: SourceRef,
  blockId: string = '',
): V2EditableParagraph | null {
  const paragraph = model.entityBySourceRef(paragraphSourceRef);
  if (!paragraph || paragraph.kind !== 'paragraph') {
    return null;
  }

  return describeParagraph(model, blockId, paragraph.ref);
}

function describeParagraph(model: SemanticModel, blockId: string, paragraphRef: EntityRef): V2EditableParagraph {
  const paragraph = model.entity(paragraphRef);
  const paragraphSourceRef = paragraph?.sourceRefs[0];
  const storyId = paragraph?.storyId;

  if (!paragraph || paragraph.kind !== 'paragraph' || !paragraphSourceRef || !storyId) {
    return {
      blockId,
      storyId: storyId ?? '',
      paragraphRef,
      paragraphSourceRef: paragraphSourceRef ?? createMissingSourceRef(),
      text: '',
      segments: [],
      supported: false,
      unsupportedReason: 'Paragraph is missing source-backed identity',
    };
  }

  const segments: V2EditableTextSegment[] = [];
  let emptyInsertionSegment: V2EditableTextSegment | null = null;
  let paragraphOffset = 0;
  let unsupportedReason: string | undefined;

  const runs = model.runs(paragraphRef);
  runs.forEach((run, runIndex) => {
    const runSourceRef = run.sourceRefs[0];
    if (!runSourceRef) {
      unsupportedReason = unsupportedReason ?? 'Run is missing source-backed identity';
      return;
    }

    let runOffset = 0;

    model.segments(run.ref).forEach((segment, segmentIndex) => {
      const editableSegment = createEditableSegment(segment, {
        runRef: run.ref,
        runSourceRef,
        runIndex,
        segmentIndex,
        paragraphStart: paragraphOffset,
        runTextStart: runOffset,
      });

      if (editableSegment.kind === 'unsupported') {
        unsupportedReason = unsupportedReason ?? editableSegment.reason;
        return;
      }

      if (editableSegment.kind === 'ignored') {
        return;
      }

      if (editableSegment.segment.text.length === 0) {
        if (editableSegment.segment.isMutableText && !emptyInsertionSegment) {
          emptyInsertionSegment = editableSegment.segment;
        }
        return;
      }

      segments.push(editableSegment.segment);
      paragraphOffset += editableSegment.displayLength;
      runOffset += editableSegment.mutableTextLength;
    });
  });

  const resolvedSegments = segments.length > 0 ? segments : emptyInsertionSegment ? [emptyInsertionSegment] : [];
  const runlessInsertionSegments =
    resolvedSegments.length === 0 && runs.length === 0 ? [createRunlessParagraphSegment(paragraph)] : [];
  const finalSegments = resolvedSegments.length > 0 ? resolvedSegments : runlessInsertionSegments;
  const text = segments.map((segment) => segment.text).join('');
  const resolvedUnsupportedReason =
    unsupportedReason ?? (finalSegments.length === 0 ? 'Paragraph has no visible editable segments' : undefined);
  const supported = !resolvedUnsupportedReason && finalSegments.length > 0;

  if (resolvedUnsupportedReason === 'Paragraph has no visible editable segments') {
    console.debug('[V2EditableDocumentSnapshot] Unsupported empty-looking paragraph', {
      blockId,
      paragraphSourceNodeId: paragraphSourceRef.nodeId,
      runCount: runs.length,
      runSourceNodeIds: runs.map((run) => run.sourceRefs[0]?.nodeId ?? null),
      segmentKindsByRun: runs.map((run) => ({
        runSourceNodeId: run.sourceRefs[0]?.nodeId ?? null,
        segmentKinds: model.segments(run.ref).map((segment) => segment.segmentKind),
        segmentTexts: model
          .segments(run.ref)
          .map((segment) =>
            segment.segmentKind === 'text' ? segment.text : segment.segmentKind === 'symbol' ? segment.char : null,
          ),
      })),
    });
  }

  return {
    blockId,
    storyId,
    paragraphRef,
    paragraphSourceRef,
    text,
    segments: finalSegments,
    supported,
    ...(resolvedUnsupportedReason ? { unsupportedReason: resolvedUnsupportedReason } : {}),
  };
}

export function isEmptyEditableParagraph(paragraph: V2EditableParagraph): boolean {
  return (
    paragraph.supported &&
    paragraph.text.length === 0 &&
    paragraph.segments.length > 0 &&
    paragraph.segments.every((segment) => segment.isMutableText && segment.text.length === 0)
  );
}

function createRunlessParagraphSegment(paragraph: {
  readonly ref: EntityRef;
  readonly sourceRefs: readonly SourceRef[];
}): V2EditableTextSegment {
  const paragraphSourceRef = paragraph.sourceRefs[0];
  if (!paragraphSourceRef) {
    throw new Error(`Paragraph ${paragraph.ref.id} is missing a source ref`);
  }

  return {
    segmentKind: 'text',
    isMutableText: true,
    runRef: paragraph.ref,
    runSourceRef: paragraphSourceRef,
    runIndex: 0,
    segmentIndex: 0,
    segmentId: `${paragraph.ref.id}:empty-paragraph`,
    text: '',
    paragraphStart: 0,
    paragraphEnd: 0,
    runTextStart: 0,
    runTextEnd: 0,
  };
}

function clearParagraphInteractionData(block: ParagraphBlock): void {
  block.runs.forEach((run) => {
    if (!isEditableTextCarrierRun(run) || !run.dataAttrs) {
      return;
    }

    const nextAttrs = { ...run.dataAttrs };
    delete nextAttrs[DATA_ATTRS.SD_ENTITY_REF];
    delete nextAttrs[DATA_ATTRS.SD_STORY_ID];
    delete nextAttrs[DATA_ATTRS.SD_RUN_REF];
    delete nextAttrs[DATA_ATTRS.SD_SEGMENT_ID];
    delete nextAttrs[DATA_ATTRS.SD_SEGMENT_START];
    delete nextAttrs[DATA_ATTRS.SD_SEGMENT_END];
    delete nextAttrs[DATA_ATTRS.SD_INTERACTION_KIND];

    run.dataAttrs = Object.keys(nextAttrs).length > 0 ? nextAttrs : undefined;
  });
}

type EditableSegmentBuildOptions = {
  runRef: EntityRef;
  runSourceRef: SourceRef;
  runIndex: number;
  segmentIndex: number;
  paragraphStart: number;
  runTextStart: number;
};

type EditableSegmentBuildResult =
  | {
      kind: 'segment';
      segment: V2EditableTextSegment;
      displayLength: number;
      mutableTextLength: number;
    }
  | {
      kind: 'ignored';
    }
  | {
      kind: 'unsupported';
      reason: string;
    };

function createEditableSegment(
  segment: InlineSegment,
  options: EditableSegmentBuildOptions,
): EditableSegmentBuildResult {
  if (isIgnoredHiddenSegment(segment)) {
    return { kind: 'ignored' };
  }

  const segmentText = editableTextForSegment(segment);
  if (segmentText == null) {
    return {
      kind: 'unsupported',
      reason: `Unsupported segment kind: ${segment.segmentKind}`,
    };
  }

  const isMutableText = segment.segmentKind === 'text';
  const mutableTextLength = isMutableText ? segmentText.length : 0;
  const displayLength = segmentText.length;

  return {
    kind: 'segment',
    displayLength,
    mutableTextLength,
    segment: {
      segmentKind: toEditableSegmentKind(segment.segmentKind),
      isMutableText,
      runRef: options.runRef,
      runSourceRef: options.runSourceRef,
      runIndex: options.runIndex,
      segmentIndex: options.segmentIndex,
      segmentId: segment.localId,
      text: segmentText,
      paragraphStart: options.paragraphStart,
      paragraphEnd: options.paragraphStart + displayLength,
      runTextStart: options.runTextStart,
      runTextEnd: options.runTextStart + mutableTextLength,
    },
  };
}

function editableTextForSegment(segment: InlineSegment): string | null {
  switch (segment.segmentKind) {
    case 'text':
      return segment.text;
    case 'tab':
      return '\t';
    case 'symbol':
      return segment.char;
    case 'softHyphen':
      return '\u00AD';
    case 'noBreakHyphen':
      return '\u2011';
    case 'footnoteRef':
      return segment.footnoteId;
    case 'endnoteRef':
      return segment.endnoteId;
    default:
      return null;
  }
}

function isIgnoredHiddenSegment(segment: InlineSegment): boolean {
  switch (segment.segmentKind) {
    case 'fieldChar':
    case 'instrText':
    case 'deletedText':
    case 'preserved':
      return true;
    default:
      return false;
  }
}

function toEditableSegmentKind(kind: InlineSegment['segmentKind']): V2EditableSegmentKind {
  switch (kind) {
    case 'text':
    case 'tab':
    case 'symbol':
    case 'softHyphen':
    case 'noBreakHyphen':
    case 'footnoteRef':
    case 'endnoteRef':
      return kind;
    default:
      throw new Error(`Unsupported editable segment kind: ${kind}`);
  }
}

function choosePreferredParagraph(
  left: V2EditableParagraph | undefined,
  right: V2EditableParagraph,
): V2EditableParagraph {
  if (!left) {
    return right;
  }

  if (left.supported !== right.supported) {
    return right.supported ? right : left;
  }

  if (left.segments.length !== right.segments.length) {
    return right.segments.length > left.segments.length ? right : left;
  }

  if (left.text.length !== right.text.length) {
    return right.text.length > left.text.length ? right : left;
  }

  if (hasSourceIdentity(left) !== hasSourceIdentity(right)) {
    return hasSourceIdentity(right) ? right : left;
  }

  return left;
}

function prepareParagraphInteractionRewrite(
  block: ParagraphBlock,
  paragraph: V2EditableParagraph,
): ParagraphInteractionRewriteResult {
  if (isEmptyEditableParagraph(paragraph)) {
    return rewriteEmptyEditableParagraph(block, paragraph);
  }

  const visibleRuns = block.runs.filter(isEditableTextCarrierRun);
  const projectedText = visibleRuns.map((run) => run.text).join('');

  if (projectedText !== paragraph.text) {
    return {
      ok: false,
      reason: 'Rendered paragraph text does not match editable snapshot text',
    };
  }

  if (paragraph.segments.length === 0) {
    return {
      ok: true,
      runs: block.runs,
    };
  }

  const rewrittenRuns: ParagraphBlock['runs'] = [];
  let paragraphOffset = 0;
  let segmentCursor = 0;

  for (const run of block.runs) {
    if (!isEditableTextCarrierRun(run)) {
      rewrittenRuns.push(run);
      continue;
    }

    let runOffset = 0;
    while (runOffset < run.text.length) {
      const segment = paragraph.segments[segmentCursor];
      if (!segment) {
        return {
          ok: false,
          reason: 'Rendered paragraph has more visible text than the editable snapshot',
        };
      }

      const segmentOffset = paragraphOffset - segment.paragraphStart;
      const remainingSegmentText = segment.text.length - segmentOffset;
      const remainingRunText = run.text.length - runOffset;
      const sliceLength = Math.min(remainingSegmentText, remainingRunText);

      if (sliceLength <= 0) {
        return {
          ok: false,
          reason: 'Rendered paragraph slice length resolved to zero during editable rewrite',
        };
      }

      const sliceText = run.text.slice(runOffset, runOffset + sliceLength);
      const expectedText = segment.text.slice(segmentOffset, segmentOffset + sliceLength);
      if (sliceText !== expectedText) {
        return {
          ok: false,
          reason: 'Rendered paragraph slice text diverged from the editable snapshot',
        };
      }

      rewrittenRuns.push(createEditableRunSlice(run, paragraph, segment, runOffset, paragraphOffset, sliceText));

      runOffset += sliceLength;
      paragraphOffset += sliceLength;

      if (paragraphOffset >= segment.paragraphEnd) {
        segmentCursor += 1;
      }
    }
  }

  if (paragraphOffset !== paragraph.text.length) {
    return {
      ok: false,
      reason: 'Editable snapshot has more visible text than the rendered paragraph',
    };
  }

  return {
    ok: true,
    runs: rewrittenRuns,
  };
}

function rewriteEmptyEditableParagraph(
  block: ParagraphBlock,
  paragraph: V2EditableParagraph,
): ParagraphInteractionRewriteResult {
  const [emptySegment] = paragraph.segments;
  if (!emptySegment) {
    return {
      ok: false,
      reason: 'Empty editable paragraph is missing its insertion segment',
    };
  }

  const visibleRuns = block.runs.filter(isEditableTextCarrierRun);
  const projectedText = visibleRuns.map((run) => run.text).join('');
  if (!isRenderedEmptyParagraphPlaceholder(projectedText)) {
    return {
      ok: false,
      reason: 'Rendered paragraph is not an empty-placeholder paragraph',
    };
  }

  const rewrittenRuns = block.runs.map((run) => {
    if (!isEditableTextCarrierRun(run)) {
      return run;
    }

    return createEmptyEditableRun(run, paragraph, emptySegment);
  });

  if (rewrittenRuns.some(isEditableTextCarrierRun)) {
    return {
      ok: true,
      runs: rewrittenRuns,
    };
  }

  return {
    ok: true,
    runs: [createSyntheticEmptyEditableRun(paragraph, emptySegment)],
  };
}

function isRenderedEmptyParagraphPlaceholder(text: string): boolean {
  return text.replace(/\u00A0/g, ' ').trim().length === 0;
}

function createEmptyEditableRun(
  baseRun: EditableTextCarrierRun,
  paragraph: V2EditableParagraph,
  segment: V2EditableTextSegment,
): EditableTextCarrierRun {
  return {
    ...baseRun,
    text: EMPTY_EDITABLE_TEXT_PLACEHOLDER,
    ...(baseRun.pmStart != null ? { pmEnd: baseRun.pmStart } : {}),
    dataAttrs: {
      ...(baseRun.dataAttrs ?? {}),
      [DATA_ATTRS.SD_ENTITY_REF]: paragraph.paragraphRef.id,
      [DATA_ATTRS.SD_STORY_ID]: paragraph.storyId,
      [DATA_ATTRS.SD_RUN_REF]: segment.runRef.id,
      [DATA_ATTRS.SD_SEGMENT_ID]: segment.segmentId,
      [DATA_ATTRS.SD_SEGMENT_START]: '0',
      [DATA_ATTRS.SD_SEGMENT_END]: '0',
      [DATA_ATTRS.SD_INTERACTION_KIND]: 'empty-text',
    },
  } as EditableTextCarrierRun;
}

function createSyntheticEmptyEditableRun(
  paragraph: V2EditableParagraph,
  segment: V2EditableTextSegment,
): EditableTextCarrierRun {
  return createEmptyEditableRun(
    {
      kind: 'text',
      text: '',
      fontFamily: 'Arial',
      fontSize: 12,
    } as EditableTextCarrierRun,
    paragraph,
    segment,
  );
}

function createEditableRunSlice(
  baseRun: EditableTextCarrierRun,
  paragraph: V2EditableParagraph,
  segment: V2EditableTextSegment,
  runOffset: number,
  paragraphOffset: number,
  sliceText: string,
): EditableTextCarrierRun {
  const sliceLength = sliceText.length;
  const sliceStart = paragraphOffset;
  const sliceEnd = paragraphOffset + sliceLength;
  const slicePmStart = baseRun.pmStart != null ? baseRun.pmStart + runOffset : undefined;
  const slicePmEnd = slicePmStart != null ? slicePmStart + sliceLength : baseRun.pmEnd;

  return {
    ...baseRun,
    text: sliceText,
    ...(slicePmStart != null ? { pmStart: slicePmStart } : {}),
    ...(slicePmEnd != null ? { pmEnd: slicePmEnd } : {}),
    dataAttrs: {
      ...(baseRun.dataAttrs ?? {}),
      [DATA_ATTRS.SD_ENTITY_REF]: paragraph.paragraphRef.id,
      [DATA_ATTRS.SD_STORY_ID]: paragraph.storyId,
      [DATA_ATTRS.SD_RUN_REF]: segment.runRef.id,
      [DATA_ATTRS.SD_SEGMENT_ID]: segment.segmentId,
      [DATA_ATTRS.SD_SEGMENT_START]: String(sliceStart),
      [DATA_ATTRS.SD_SEGMENT_END]: String(sliceEnd),
      [DATA_ATTRS.SD_INTERACTION_KIND]: segment.isMutableText ? 'text' : 'protected-text',
    },
  };
}

type EditableTextCarrierRun = ParagraphBlock['runs'][number] & {
  text: string;
  pmStart?: number;
  pmEnd?: number;
  dataAttrs?: Record<string, string>;
};

function isEditableTextCarrierRun(run: ParagraphBlock['runs'][number]): run is EditableTextCarrierRun {
  return (run.kind === undefined || run.kind === 'text' || run.kind === 'tab') && typeof run.text === 'string';
}

function createMissingSourceRef(): SourceRef {
  return {
    partUri: '',
    nodeId: '',
  };
}

function orderMergedParagraphs(
  paragraphsByBlockId: ReadonlyMap<string, V2EditableParagraph>,
  left: V2EditableDocumentSnapshot,
  right: V2EditableDocumentSnapshot,
  orderedBlockIds?: Iterable<string>,
): readonly V2EditableParagraph[] {
  const orderedParagraphs: V2EditableParagraph[] = [];
  const seenBlockIds = new Set<string>();

  const appendBlockId = (blockId: string): void => {
    if (seenBlockIds.has(blockId)) {
      return;
    }

    const paragraph = paragraphsByBlockId.get(blockId);
    if (!paragraph) {
      return;
    }

    seenBlockIds.add(blockId);
    orderedParagraphs.push(paragraph);
  };

  if (orderedBlockIds) {
    for (const blockId of orderedBlockIds) {
      appendBlockId(blockId);
    }
  }

  left.orderedParagraphs.forEach((paragraph) => appendBlockId(paragraph.blockId));
  right.orderedParagraphs.forEach((paragraph) => appendBlockId(paragraph.blockId));

  return orderedParagraphs;
}

function hasSourceIdentity(paragraph: V2EditableParagraph): boolean {
  return paragraph.paragraphSourceRef.partUri.length > 0 && paragraph.paragraphSourceRef.nodeId.length > 0;
}

function collectParagraphBlockRefs(
  model: SemanticModel,
  parentRef: EntityRef,
  requestedBlockIds: ReadonlySet<string>,
  blockToEntityRef: Map<string, EntityRef>,
): void {
  for (const entity of model.blockEntities(parentRef)) {
    switch (entity.kind) {
      case 'paragraph': {
        const sourceRef = entity.sourceRefs[0];
        if (!sourceRef) {
          break;
        }

        const blockId = makeStableBlockId('paragraph', sourceRefToSourceAnchor(sourceRef));
        if (requestedBlockIds.has(blockId)) {
          blockToEntityRef.set(blockId, entity.ref);
        }
        break;
      }

      case 'contentControl':
      case 'preservedBlock':
        collectParagraphBlockRefs(model, entity.ref, requestedBlockIds, blockToEntityRef);
        break;

      case 'table':
        collectParagraphBlockRefsFromTable(model, entity.ref, requestedBlockIds, blockToEntityRef);
        break;

      default:
        break;
    }
  }
}

function collectParagraphBlockRefsFromTable(
  model: SemanticModel,
  tableRef: EntityRef,
  requestedBlockIds: ReadonlySet<string>,
  blockToEntityRef: Map<string, EntityRef>,
): void {
  for (const row of model.tableRows(tableRef)) {
    for (const cell of model.tableCells(row.ref)) {
      collectParagraphBlockRefs(model, cell.ref, requestedBlockIds, blockToEntityRef);
    }
  }
}

function collectParagraphBlockRefsFromAllParagraphs(
  model: SemanticModel,
  requestedBlockIds: ReadonlySet<string>,
  blockToEntityRef: Map<string, EntityRef>,
): void {
  for (const paragraph of model.allParagraphs()) {
    const sourceRef = paragraph.sourceRefs[0];
    if (!sourceRef) {
      continue;
    }

    const blockId = makeStableBlockId('paragraph', sourceRefToSourceAnchor(sourceRef));
    if (requestedBlockIds.has(blockId)) {
      blockToEntityRef.set(blockId, paragraph.ref);
    }
  }
}

function shouldFallbackToAllParagraphs(matchedParagraphCount: number, requestedBlockCount: number): boolean {
  if (matchedParagraphCount === 0) {
    return requestedBlockCount > 0;
  }

  if (requestedBlockCount <= 8) {
    return false;
  }

  return matchedParagraphCount <= Math.max(2, Math.floor(requestedBlockCount * 0.2));
}
