import { V2EditableIndex } from './V2EditableIndex.js';
import type { V2PendingSelection, V2ResolvedSelection, V2SelectionBounds } from './V2EditingTypes.js';
import type { SourceRef } from '@superdoc/v2-model';

export type V2LocalParagraphDraftEdit = {
  readonly blockId: string;
  readonly paragraphSourceRef: SourceRef;
  readonly committedText: string;
  readonly nextText: string;
  readonly pendingSelection: V2PendingSelection;
};

export function planLocalParagraphTextInsertion(
  index: V2EditableIndex,
  selection: V2ResolvedSelection,
  text: string,
): V2LocalParagraphDraftEdit | null {
  const context = resolveLocalParagraphContext(index, selection);
  if (!context) {
    return null;
  }

  return createDraftEdit(context, text);
}

export function planLocalParagraphDeleteBackward(
  index: V2EditableIndex,
  selection: V2ResolvedSelection,
): V2LocalParagraphDraftEdit | null {
  const context = resolveLocalParagraphContext(index, selection);
  if (!context) {
    return null;
  }

  if (selection.kind === 'caret' && context.startOffset === context.endOffset) {
    if (context.startOffset === 0) {
      return null;
    }

    return createDraftEdit(
      {
        ...context,
        startOffset: context.startOffset - 1,
      },
      '',
    );
  }

  return createDraftEdit(context, '');
}

export function planLocalParagraphDeleteForward(
  index: V2EditableIndex,
  selection: V2ResolvedSelection,
): V2LocalParagraphDraftEdit | null {
  const context = resolveLocalParagraphContext(index, selection);
  if (!context) {
    return null;
  }

  if (selection.kind === 'caret' && context.startOffset === context.endOffset) {
    if (context.endOffset >= context.paragraph.text.length) {
      return null;
    }

    return createDraftEdit(
      {
        ...context,
        endOffset: context.endOffset + 1,
      },
      '',
    );
  }

  return createDraftEdit(context, '');
}

type LocalParagraphContext = {
  readonly paragraph: NonNullable<ReturnType<V2EditableIndex['paragraphBySourceRef']>>;
  readonly startOffset: number;
  readonly endOffset: number;
};

function resolveLocalParagraphContext(
  index: V2EditableIndex,
  selection: V2ResolvedSelection,
): LocalParagraphContext | null {
  const bounds = index.normalizeSelection(selection);
  if (!bounds) {
    return null;
  }

  return resolveContextFromBounds(index, bounds);
}

function resolveContextFromBounds(index: V2EditableIndex, bounds: V2SelectionBounds): LocalParagraphContext | null {
  if (bounds.start.paragraphSourceRef.nodeId !== bounds.end.paragraphSourceRef.nodeId) {
    return null;
  }

  const paragraph = index.paragraphBySourceRef(bounds.start.paragraphSourceRef);
  if (!paragraph?.supported) {
    return null;
  }

  return {
    paragraph,
    startOffset: bounds.start.paragraphOffset,
    endOffset: bounds.end.paragraphOffset,
  };
}

function createDraftEdit(context: LocalParagraphContext, insertedText: string): V2LocalParagraphDraftEdit {
  const { paragraph, startOffset, endOffset } = context;
  const nextText = paragraph.text.slice(0, startOffset) + insertedText + paragraph.text.slice(endOffset);
  const caretOffset = startOffset + insertedText.length;

  return {
    blockId: paragraph.blockId,
    paragraphSourceRef: paragraph.paragraphSourceRef,
    committedText: paragraph.text,
    nextText,
    pendingSelection: {
      kind: 'caret',
      paragraphSourceRef: paragraph.paragraphSourceRef,
      paragraphOffset: caretOffset,
    },
  };
}
