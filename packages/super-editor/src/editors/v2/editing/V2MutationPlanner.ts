import {
  createSourceRef,
  type SemanticOperation,
  type SemanticOperationResult,
  type SourceRef,
} from '@superdoc/v2-model';
import type { V2EditingController } from '../runtime/V2EditingController.js';
import type { V2EditableParagraph, V2EditableTextSegment } from './V2EditableDocumentSnapshot.js';
import { describeEditableParagraphBySourceRef } from './V2EditableDocumentSnapshot.js';
import { V2EditableIndex } from './V2EditableIndex.js';
import type { V2PendingSelection, V2ResolvedSelection, V2SelectionBounds } from './V2EditingTypes.js';

type InsertTextStep = {
  readonly type: 'insertText';
  readonly runRefId: string;
  readonly runSourceRef: SourceRef;
  readonly segmentIndex: number;
  readonly charOffset: number;
  readonly deleteLength: number;
  readonly text: string;
};

let nativeOperationCounter = 0;

export type PlannedParagraphTextEdit = {
  readonly operations: SemanticOperation[];
  readonly pendingSelection: V2PendingSelection | null;
};

export function planParagraphTextEdit(
  controller: V2EditingController,
  paragraphSourceRef: SourceRef,
  originalText: string,
  editedText: string,
): PlannedParagraphTextEdit | null {
  if (originalText === editedText) {
    return null;
  }

  const paragraph = requireParagraph(controller, paragraphSourceRef);
  const { prefixLength, suffixLength } = findCommonAffixes(originalText, editedText);
  const deleteLength = originalText.length - prefixLength - suffixLength;
  const insertedText = editedText.slice(prefixLength, editedText.length - suffixLength);
  assertSupportedInsertedText(insertedText);

  return planReplaceWithinParagraphDefinition(
    controller,
    paragraph,
    prefixLength,
    prefixLength + deleteLength,
    insertedText,
  );
}

export function planParagraphTextEditForParagraph(
  paragraph: V2EditableParagraph,
  originalText: string,
  editedText: string,
): PlannedParagraphTextEdit | null {
  if (originalText === editedText) {
    return null;
  }

  const { prefixLength, suffixLength } = findCommonAffixes(originalText, editedText);
  const deleteLength = originalText.length - prefixLength - suffixLength;
  const insertedText = editedText.slice(prefixLength, editedText.length - suffixLength);
  assertSupportedInsertedText(insertedText);

  return planReplaceWithinParagraph(paragraph, prefixLength, prefixLength + deleteLength, insertedText);
}

export async function applyParagraphTextEdit(
  controller: V2EditingController,
  paragraphSourceRef: SourceRef,
  originalText: string,
  editedText: string,
): Promise<V2PendingSelection | null> {
  const plannedEdit = planParagraphTextEdit(controller, paragraphSourceRef, originalText, editedText);
  if (!plannedEdit) {
    return null;
  }

  for (const operation of plannedEdit.operations) {
    const result = await controller.applyOperation(operation);
    assertApplied(result, 'Paragraph text mutation failed');
  }

  return plannedEdit.pendingSelection;
}

export async function replaceSelectionWithText(
  controller: V2EditingController,
  index: V2EditableIndex,
  bounds: V2SelectionBounds,
  text: string,
): Promise<V2PendingSelection | null> {
  if (bounds.start.blockId === bounds.end.blockId) {
    return replaceWithinParagraph(
      controller,
      index,
      bounds.start.paragraphSourceRef,
      bounds.start.paragraphOffset,
      bounds.end.paragraphOffset,
      text,
    );
  }

  const paragraphs = paragraphsInRange(index, bounds);
  if (!paragraphs) {
    return null;
  }

  const [firstParagraph, ...rest] = paragraphs;
  const lastParagraph = rest[rest.length - 1];

  await replaceWithinParagraph(
    controller,
    index,
    firstParagraph.paragraphSourceRef,
    bounds.start.paragraphOffset,
    firstParagraph.text.length,
    text,
  );

  for (const middleParagraph of rest.slice(0, -1)) {
    await replaceWithinParagraph(
      controller,
      index,
      middleParagraph.paragraphSourceRef,
      0,
      middleParagraph.text.length,
      '',
    );
  }

  if (lastParagraph) {
    await replaceWithinParagraph(
      controller,
      index,
      lastParagraph.paragraphSourceRef,
      0,
      bounds.end.paragraphOffset,
      '',
    );
  }

  for (const paragraph of rest) {
    await mergeParagraphs(controller, firstParagraph.paragraphSourceRef, paragraph.paragraphSourceRef);
  }

  return {
    kind: 'caret',
    paragraphSourceRef: firstParagraph.paragraphSourceRef,
    paragraphOffset: bounds.start.paragraphOffset + text.length,
  };
}

export async function deleteBackward(
  controller: V2EditingController,
  index: V2EditableIndex,
  selection: V2ResolvedSelection,
): Promise<V2PendingSelection | null> {
  const bounds = index.normalizeSelection(selection);
  if (!bounds) {
    return null;
  }

  if (selection.kind === 'range') {
    return replaceSelectionWithText(controller, index, bounds, '');
  }

  if (bounds.start.paragraphOffset > 0) {
    const previous = index.moveByCharacter(bounds.start, -1);
    if (!previous) {
      return null;
    }

    return replaceSelectionWithText(
      controller,
      index,
      {
        start: previous,
        end: bounds.end,
        isBackward: false,
      },
      '',
    );
  }

  const paragraph = index.paragraphBySourceRef(bounds.start.paragraphSourceRef);
  if (!paragraph) {
    return null;
  }

  const previousParagraph = index.previousParagraph(paragraph);
  if (!previousParagraph?.supported) {
    return null;
  }

  await mergeParagraphs(controller, previousParagraph.paragraphSourceRef, paragraph.paragraphSourceRef);

  return {
    kind: 'caret',
    paragraphSourceRef: previousParagraph.paragraphSourceRef,
    paragraphOffset: previousParagraph.text.length,
  };
}

export async function deleteForward(
  controller: V2EditingController,
  index: V2EditableIndex,
  selection: V2ResolvedSelection,
): Promise<V2PendingSelection | null> {
  const bounds = index.normalizeSelection(selection);
  if (!bounds) {
    return null;
  }

  if (selection.kind === 'range') {
    return replaceSelectionWithText(controller, index, bounds, '');
  }

  if (bounds.end.paragraphOffset < bounds.end.paragraphLength) {
    const next = index.moveByCharacter(bounds.end, 1);
    if (!next) {
      return null;
    }

    return replaceSelectionWithText(
      controller,
      index,
      {
        start: bounds.start,
        end: next,
        isBackward: false,
      },
      '',
    );
  }

  const paragraph = index.paragraphBySourceRef(bounds.end.paragraphSourceRef);
  if (!paragraph) {
    return null;
  }

  const nextParagraph = index.nextParagraph(paragraph);
  if (!nextParagraph?.supported) {
    return null;
  }

  await mergeParagraphs(controller, paragraph.paragraphSourceRef, nextParagraph.paragraphSourceRef);

  return {
    kind: 'caret',
    paragraphSourceRef: paragraph.paragraphSourceRef,
    paragraphOffset: paragraph.text.length,
  };
}

export async function splitSelection(
  controller: V2EditingController,
  index: V2EditableIndex,
  selection: V2ResolvedSelection,
): Promise<V2PendingSelection | null> {
  const bounds = index.normalizeSelection(selection);
  if (!bounds) {
    return null;
  }

  let splitSourceRef = bounds.start.paragraphSourceRef;
  let splitOffset = bounds.start.paragraphOffset;

  if (selection.kind === 'range') {
    const pendingAfterDelete = await replaceSelectionWithText(controller, index, bounds, '');
    if (!pendingAfterDelete || pendingAfterDelete.kind !== 'caret') {
      return null;
    }

    splitSourceRef = pendingAfterDelete.paragraphSourceRef;
    splitOffset = pendingAfterDelete.paragraphOffset;
  }

  const liveParagraph = requireParagraph(controller, splitSourceRef);
  const livePosition = requirePositionInLiveParagraph(liveParagraph, splitOffset);
  const result = await controller.applyOperation({
    id: nextOperationId('splitParagraph'),
    label: 'Split paragraph',
    kind: 'splitParagraph',
    target: liveParagraph.paragraphRef,
    at: {
      runIndex: livePosition.runIndex,
      charOffset: livePosition.offsetInRun,
    },
  });

  assertApplied(result, 'Split paragraph failed');

  const createdRef =
    result.primitiveResult && result.primitiveResult.ok
      ? result.primitiveResult.createdRefs.find((ref) => ref.kind === 'node')
      : undefined;
  if (!createdRef || createdRef.kind !== 'node') {
    return {
      kind: 'caret',
      paragraphSourceRef: splitSourceRef,
      paragraphOffset: splitOffset,
    };
  }

  return {
    kind: 'caret',
    paragraphSourceRef: createSourceRef(createdRef.partUri, createdRef.nodeId),
    paragraphOffset: 0,
  };
}

function paragraphsInRange(index: V2EditableIndex, bounds: V2SelectionBounds): V2EditableParagraph[] | null {
  const startParagraph = index.paragraphBySourceRef(bounds.start.paragraphSourceRef);
  const endParagraph = index.paragraphBySourceRef(bounds.end.paragraphSourceRef);
  if (!startParagraph || !endParagraph) {
    return null;
  }

  const ordered = index.snapshot.orderedParagraphs;
  const startIndex = ordered.findIndex(
    (paragraph) => paragraph.paragraphSourceRef.nodeId === startParagraph.paragraphSourceRef.nodeId,
  );
  const endIndex = ordered.findIndex(
    (paragraph) => paragraph.paragraphSourceRef.nodeId === endParagraph.paragraphSourceRef.nodeId,
  );
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    return null;
  }

  const paragraphs = ordered.slice(startIndex, endIndex + 1);
  if (paragraphs.some((paragraph) => !paragraph.supported)) {
    return null;
  }

  return paragraphs;
}

async function replaceWithinParagraph(
  controller: V2EditingController,
  index: V2EditableIndex,
  paragraphSourceRef: SourceRef,
  startOffset: number,
  endOffset: number,
  text: string,
): Promise<V2PendingSelection> {
  const paragraph = requireIndexedParagraph(index, paragraphSourceRef);
  return replaceWithinParagraphDefinition(controller, paragraph, startOffset, endOffset, text);
}

async function replaceWithinParagraphDefinition(
  controller: V2EditingController,
  paragraph: V2EditableParagraph,
  startOffset: number,
  endOffset: number,
  text: string,
): Promise<V2PendingSelection> {
  const plannedEdit = planReplaceWithinParagraphDefinition(controller, paragraph, startOffset, endOffset, text);
  for (const operation of plannedEdit.operations) {
    const result = await controller.applyOperation(operation);
    assertApplied(result, 'Paragraph text mutation failed');
  }

  return (
    plannedEdit.pendingSelection ?? {
      kind: 'caret',
      paragraphSourceRef: paragraph.paragraphSourceRef,
      paragraphOffset: Math.max(0, Math.min(startOffset, paragraph.text.length)) + text.length,
    }
  );
}

function planReplaceWithinParagraphDefinition(
  controller: V2EditingController,
  paragraph: V2EditableParagraph,
  startOffset: number,
  endOffset: number,
  text: string,
): PlannedParagraphTextEdit {
  const normalizedStart = Math.max(0, Math.min(startOffset, paragraph.text.length));
  const normalizedEnd = Math.max(normalizedStart, Math.min(endOffset, paragraph.text.length));

  if (normalizedStart === normalizedEnd) {
    const insertionTarget = requireMutableInsertionTarget(paragraph, normalizedStart);
    return {
      operations: [
        createResolvedInsertTextOperation(controller, {
          type: 'insertText',
          runRefId: insertionTarget.segment.runRef.id,
          runSourceRef: insertionTarget.segment.runSourceRef,
          segmentIndex: insertionTarget.segment.segmentIndex,
          charOffset: insertionTarget.charOffset,
          deleteLength: 0,
          text,
        }),
      ],
      pendingSelection: {
        kind: 'caret',
        paragraphSourceRef: paragraph.paragraphSourceRef,
        paragraphOffset: normalizedStart + text.length,
      },
    };
  }

  const affectedSegments = paragraph.segments.filter(
    (segment) => segment.paragraphEnd > normalizedStart && segment.paragraphStart < normalizedEnd,
  );
  if (affectedSegments.length === 0) {
    return {
      operations: [],
      pendingSelection: {
        kind: 'caret',
        paragraphSourceRef: paragraph.paragraphSourceRef,
        paragraphOffset: normalizedStart,
      },
    };
  }

  assertSegmentsAreMutable(affectedSegments, paragraph);
  const steps = buildReplaceSteps(affectedSegments, normalizedStart, normalizedEnd, text);
  return {
    operations: steps.map((step) => createResolvedInsertTextOperation(controller, step)),
    pendingSelection: {
      kind: 'caret',
      paragraphSourceRef: paragraph.paragraphSourceRef,
      paragraphOffset: normalizedStart + text.length,
    },
  };
}

function planReplaceWithinParagraph(
  paragraph: V2EditableParagraph,
  startOffset: number,
  endOffset: number,
  text: string,
): PlannedParagraphTextEdit {
  const normalizedStart = Math.max(0, Math.min(startOffset, paragraph.text.length));
  const normalizedEnd = Math.max(normalizedStart, Math.min(endOffset, paragraph.text.length));

  if (normalizedStart === normalizedEnd) {
    const insertionTarget = requireMutableInsertionTarget(paragraph, normalizedStart);
    return {
      operations: [
        createInsertTextOperation({
          type: 'insertText',
          runRefId: insertionTarget.segment.runRef.id,
          runSourceRef: insertionTarget.segment.runSourceRef,
          segmentIndex: insertionTarget.segment.segmentIndex,
          charOffset: insertionTarget.charOffset,
          deleteLength: 0,
          text,
        }),
      ],
      pendingSelection: {
        kind: 'caret',
        paragraphSourceRef: paragraph.paragraphSourceRef,
        paragraphOffset: normalizedStart + text.length,
      },
    };
  }

  const affectedSegments = paragraph.segments.filter(
    (segment) => segment.paragraphEnd > normalizedStart && segment.paragraphStart < normalizedEnd,
  );
  if (affectedSegments.length === 0) {
    return {
      operations: [],
      pendingSelection: {
        kind: 'caret',
        paragraphSourceRef: paragraph.paragraphSourceRef,
        paragraphOffset: normalizedStart,
      },
    };
  }

  assertSegmentsAreMutable(affectedSegments, paragraph);
  const steps = buildReplaceSteps(affectedSegments, normalizedStart, normalizedEnd, text);
  return {
    operations: steps.map((step) => createInsertTextOperation(step)),
    pendingSelection: {
      kind: 'caret',
      paragraphSourceRef: paragraph.paragraphSourceRef,
      paragraphOffset: normalizedStart + text.length,
    },
  };
}

function buildReplaceSteps(
  affectedSegments: readonly V2EditableTextSegment[],
  startOffset: number,
  endOffset: number,
  text: string,
): InsertTextStep[] {
  const [firstSegment] = affectedSegments;
  const lastSegment = affectedSegments[affectedSegments.length - 1];

  if (
    firstSegment.segmentId === lastSegment.segmentId &&
    firstSegment.runSourceRef.nodeId === lastSegment.runSourceRef.nodeId
  ) {
    return [
      {
        type: 'insertText',
        runRefId: firstSegment.runRef.id,
        runSourceRef: firstSegment.runSourceRef,
        segmentIndex: firstSegment.segmentIndex,
        charOffset: startOffset - firstSegment.paragraphStart,
        deleteLength: endOffset - startOffset,
        text,
      },
    ];
  }

  const steps: InsertTextStep[] = [];
  const firstDeleteLength = firstSegment.paragraphEnd - startOffset;
  if (firstDeleteLength > 0 || text.length > 0) {
    steps.push({
      type: 'insertText',
      runRefId: firstSegment.runRef.id,
      runSourceRef: firstSegment.runSourceRef,
      segmentIndex: firstSegment.segmentIndex,
      charOffset: startOffset - firstSegment.paragraphStart,
      deleteLength: firstDeleteLength,
      text,
    });
  }

  affectedSegments.slice(1, -1).forEach((segment) => {
    steps.push({
      type: 'insertText',
      runRefId: segment.runRef.id,
      runSourceRef: segment.runSourceRef,
      segmentIndex: segment.segmentIndex,
      charOffset: 0,
      deleteLength: segment.text.length,
      text: '',
    });
  });

  const lastDeleteLength = endOffset - lastSegment.paragraphStart;
  if (lastDeleteLength > 0) {
    steps.push({
      type: 'insertText',
      runRefId: lastSegment.runRef.id,
      runSourceRef: lastSegment.runSourceRef,
      segmentIndex: lastSegment.segmentIndex,
      charOffset: 0,
      deleteLength: lastDeleteLength,
      text: '',
    });
  }

  return steps;
}

function createInsertTextOperation(step: InsertTextStep): SemanticOperation {
  return {
    id: nextOperationId('insertText'),
    label: step.deleteLength > 0 ? 'Replace text' : 'Insert text',
    kind: 'insertText',
    target: {
      id: step.runRefId,
    },
    text: step.text,
    ...(step.deleteLength > 0 ? { deleteLength: step.deleteLength } : {}),
    position: {
      segmentIndex: step.segmentIndex,
      charOffset: step.charOffset,
    },
  };
}

function createResolvedInsertTextOperation(controller: V2EditingController, step: InsertTextStep): SemanticOperation {
  const runEntity = controller.semanticModel?.entityBySourceRef(step.runSourceRef);
  if (!runEntity || runEntity.kind !== 'run') {
    throw new Error(`Unable to resolve live run for ${step.runSourceRef.nodeId}`);
  }

  return {
    id: nextOperationId('insertText'),
    label: step.deleteLength > 0 ? 'Replace text' : 'Insert text',
    kind: 'insertText',
    target: runEntity.ref,
    text: step.text,
    ...(step.deleteLength > 0 ? { deleteLength: step.deleteLength } : {}),
    position: {
      segmentIndex: step.segmentIndex,
      charOffset: step.charOffset,
    },
  };
}

async function mergeParagraphs(
  controller: V2EditingController,
  firstParagraphSourceRef: SourceRef,
  secondParagraphSourceRef: SourceRef,
): Promise<void> {
  const firstParagraph = controller.semanticModel?.entityBySourceRef(firstParagraphSourceRef);
  const secondParagraph = controller.semanticModel?.entityBySourceRef(secondParagraphSourceRef);

  if (!firstParagraph || firstParagraph.kind !== 'paragraph') {
    throw new Error(`Unable to resolve first paragraph ${firstParagraphSourceRef.nodeId}`);
  }

  if (!secondParagraph || secondParagraph.kind !== 'paragraph') {
    throw new Error(`Unable to resolve second paragraph ${secondParagraphSourceRef.nodeId}`);
  }

  const result = await controller.applyOperation({
    id: nextOperationId('mergeParagraphs'),
    label: 'Merge paragraphs',
    kind: 'mergeParagraphs',
    first: firstParagraph.ref,
    second: secondParagraph.ref,
  });

  assertApplied(result, 'Merge paragraphs failed');
}

function requireIndexedParagraph(index: V2EditableIndex, paragraphSourceRef: SourceRef): V2EditableParagraph {
  const paragraph = index.paragraphBySourceRef(paragraphSourceRef);
  if (!paragraph || !paragraph.supported) {
    throw new Error(`Paragraph ${paragraphSourceRef.nodeId} is not editable`);
  }

  return paragraph;
}

function requireParagraph(controller: V2EditingController, paragraphSourceRef: SourceRef): V2EditableParagraph {
  const model = controller.semanticModel;
  if (!model) {
    throw new Error('No active semantic model');
  }

  const paragraph = describeEditableParagraphBySourceRef(model, paragraphSourceRef);
  if (!paragraph || !paragraph.supported) {
    throw new Error(`Paragraph ${paragraphSourceRef.nodeId} is not editable`);
  }

  return paragraph;
}

function requirePositionInLiveParagraph(paragraph: V2EditableParagraph, offset: number) {
  const insertionTarget = requireMutableInsertionTarget(paragraph, offset);
  const { segment } = insertionTarget;

  return {
    runSourceRef: segment.runSourceRef,
    runIndex: segment.runIndex,
    offsetInRun: segment.runTextStart + insertionTarget.charOffset,
  };
}

function requireMutableInsertionTarget(
  paragraph: V2EditableParagraph,
  offset: number,
): { segment: V2EditableTextSegment; charOffset: number } {
  const mutableSegments = paragraph.segments.filter((segment) => segment.isMutableText);
  if (mutableSegments.length === 0) {
    throw new Error(`Paragraph ${paragraph.paragraphSourceRef.nodeId} has no mutable text segments`);
  }

  const clampedOffset = Math.max(0, Math.min(offset, paragraph.text.length));
  const containingMutableSegment = mutableSegments.find(
    (segment) => segment.paragraphStart <= clampedOffset && clampedOffset <= segment.paragraphEnd,
  );
  if (containingMutableSegment) {
    return {
      segment: containingMutableSegment,
      charOffset: Math.max(
        0,
        Math.min(clampedOffset - containingMutableSegment.paragraphStart, containingMutableSegment.text.length),
      ),
    };
  }

  const boundaryMatch = resolveBoundaryMutableTarget(paragraph, mutableSegments, clampedOffset);
  if (boundaryMatch) {
    return boundaryMatch;
  }

  throw new Error(
    `Paragraph ${paragraph.paragraphSourceRef.nodeId} contains protected inline content at offset ${clampedOffset}`,
  );
}

function resolveBoundaryMutableTarget(
  paragraph: V2EditableParagraph,
  mutableSegments: readonly V2EditableTextSegment[],
  offset: number,
): { segment: V2EditableTextSegment; charOffset: number } | null {
  if (offset <= 0) {
    return {
      segment: mutableSegments[0],
      charOffset: 0,
    };
  }

  if (offset >= paragraph.text.length) {
    const lastSegment = mutableSegments[mutableSegments.length - 1];
    return {
      segment: lastSegment,
      charOffset: lastSegment.text.length,
    };
  }

  const previousMutable = [...mutableSegments].reverse().find((segment) => segment.paragraphEnd <= offset);
  const nextMutable = mutableSegments.find((segment) => segment.paragraphStart >= offset);

  if (previousMutable?.paragraphEnd === offset) {
    return {
      segment: previousMutable,
      charOffset: previousMutable.text.length,
    };
  }

  if (nextMutable?.paragraphStart === offset) {
    return {
      segment: nextMutable,
      charOffset: 0,
    };
  }

  return null;
}

function assertSegmentsAreMutable(segments: readonly V2EditableTextSegment[], paragraph: V2EditableParagraph): void {
  const protectedSegment = segments.find((segment) => !segment.isMutableText);
  if (!protectedSegment) {
    return;
  }

  throw new Error(
    `Paragraph ${paragraph.paragraphSourceRef.nodeId} contains protected inline content (${protectedSegment.segmentKind}) in the edited range`,
  );
}

function assertSupportedInsertedText(text: string): void {
  if (text.includes('\n')) {
    throw new Error('Paragraph text edits cannot include newline characters');
  }

  if (text.includes('\t')) {
    throw new Error('Paragraph text edits cannot insert tab characters');
  }
}

function assertApplied(result: SemanticOperationResult, message: string): void {
  if (!result.ok) {
    throw new Error(result.error ?? message);
  }
}

function findCommonAffixes(originalText: string, editedText: string): { prefixLength: number; suffixLength: number } {
  const minLength = Math.min(originalText.length, editedText.length);
  let prefixLength = 0;

  while (prefixLength < minLength && originalText[prefixLength] === editedText[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = minLength - prefixLength;
  while (
    suffixLength < maxSuffixLength &&
    originalText[originalText.length - 1 - suffixLength] === editedText[editedText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return { prefixLength, suffixLength };
}

function nextOperationId(kind: string): string {
  nativeOperationCounter += 1;
  return `v2-native-${kind}:${nativeOperationCounter}`;
}
