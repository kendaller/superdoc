import type { V2EditingController } from '../runtime/V2EditingController.js';
import { buildEditableDocumentSnapshot, type V2EditableDocumentSnapshot } from './V2EditableDocumentSnapshot.js';
import { V2EditableIndex } from './V2EditableIndex.js';
import { V2EditingDomContext } from './V2EditingDom.js';
import { V2HiddenInputHost } from './V2HiddenInputHost.js';
import type { V2ResolvedSelection, V2ResolvedTextPosition, V2PendingSelection } from './V2EditingTypes.js';
import {
  applyParagraphTextEdit,
  deleteBackward,
  deleteForward,
  replaceSelectionWithText,
  splitSelection,
} from './V2MutationPlanner.js';
import {
  planLocalParagraphDeleteBackward,
  planLocalParagraphDeleteForward,
  planLocalParagraphTextInsertion,
  type V2LocalParagraphDraftEdit,
} from './V2LocalParagraphEdit.js';
import { patchRenderedParagraphDraftText } from './V2LocalParagraphDom.js';
import { V2SelectionOverlay, ensureV2SelectionOverlayStyles } from './V2SelectionOverlay.js';
import type { SourceRef } from '@superdoc/v2-model';

export type V2EditingMutationKind =
  | 'replaceText'
  | 'deleteBackward'
  | 'deleteForward'
  | 'splitSelection'
  | 'undo'
  | 'redo';

export type V2EditingViewRefreshOptions = {
  readonly repaint?: boolean;
  readonly pendingSelection?: V2PendingSelection | null;
  readonly anchorParagraphSourceRef?: SourceRef | null;
  readonly mutationKind?: V2EditingMutationKind;
};

type V2EditingSessionOptions = {
  readonly container: HTMLElement;
  readonly controller: V2EditingController;
  readonly getSnapshot: () => V2EditableDocumentSnapshot;
  readonly patchParagraphText?: ((blockId: string, text: string) => boolean) | null;
  readonly commitParagraphText?: ((blockId: string, paragraphSourceRef: SourceRef) => boolean) | null;
  readonly refreshView?: ((options?: V2EditingViewRefreshOptions) => void | Promise<void>) | null;
};

type ParagraphDraftState = {
  readonly blockId: string;
  readonly paragraphSourceRef: SourceRef;
  committedText: string;
  currentText: string;
  pendingSelection: V2PendingSelection;
  flushTimerId: number | null;
  flushInFlight: boolean;
  flushRequestedWhileBusy: boolean;
};

const LOCAL_TEXT_FLUSH_DELAY_MS = 80;

export class V2EditingSession {
  readonly #container: HTMLElement;
  readonly #controller: V2EditingController;
  readonly #getSnapshot: () => V2EditableDocumentSnapshot;
  readonly #patchParagraphText: ((blockId: string, text: string) => boolean) | null;
  readonly #commitParagraphText: ((blockId: string, paragraphSourceRef: SourceRef) => boolean) | null;
  readonly #refreshView: ((options?: V2EditingViewRefreshOptions) => void | Promise<void>) | null;
  readonly #domContext: V2EditingDomContext;
  readonly #overlay: V2SelectionOverlay;
  readonly #hiddenInputHost: V2HiddenInputHost;
  #index: V2EditableIndex;
  #selection: V2ResolvedSelection = { kind: 'none' };
  #pendingSelection: V2PendingSelection | null = null;
  #pointerAnchor: V2ResolvedTextPosition | null = null;
  #goalX: number | null = null;
  #isPointerSelecting = false;
  #isMutating = false;
  #isReady = true;
  #paragraphDraft: ParagraphDraftState | null = null;

  readonly #handlePointerDown = (event: PointerEvent) => {
    if (!this.#isReady || event.button !== 0 || this.#isMutating) {
      return;
    }

    const position = this.#domContext.resolveTextPositionFromClientPoint(this.#index, event.clientX, event.clientY);

    if (!position) {
      this.clearSelection();
      return;
    }

    event.preventDefault();
    this.#hiddenInputHost.focus();

    const anchor = event.shiftKey ? (this.#selection.kind === 'none' ? position : this.#selection.anchor) : position;

    this.#pointerAnchor = anchor;
    this.#selection = createSelection(anchor, position);
    this.#goalX = null;
    this.#isPointerSelecting = true;
    this.renderSelection();
    window.addEventListener('pointermove', this.#handlePointerMove);
    window.addEventListener('pointerup', this.#handlePointerUp);
  };

  readonly #handlePointerMove = (event: PointerEvent) => {
    if (!this.#isPointerSelecting || !this.#pointerAnchor) {
      return;
    }

    const position = this.#domContext.resolveTextPositionFromClientPoint(this.#index, event.clientX, event.clientY);
    if (!position) {
      return;
    }

    event.preventDefault();
    this.#selection = createSelection(this.#pointerAnchor, position);
    this.renderSelection();
  };

  readonly #handlePointerUp = () => {
    this.#isPointerSelecting = false;
    this.#pointerAnchor = null;
    window.removeEventListener('pointermove', this.#handlePointerMove);
    window.removeEventListener('pointerup', this.#handlePointerUp);
    this.#hiddenInputHost.focus();
  };

  readonly #handleBeforeInput = (event: InputEvent) => {
    if (!this.#isReady || this.#selection.kind === 'none') {
      return;
    }

    const inputType = event.inputType;
    if (inputType === 'insertText' || inputType === 'insertCompositionText' || inputType === 'insertFromPaste') {
      const normalizedText = normalizeInsertedText(event.data ?? '');
      if (normalizedText == null) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      if (!this.#applyLocalDraftEdit(planLocalParagraphTextInsertion(this.#index, this.#selection, normalizedText))) {
        void this.#replaceSelection(normalizedText);
      }
      return;
    }

    if (inputType === 'insertParagraph') {
      event.preventDefault();
      void this.#splitSelection();
      return;
    }

    if (inputType === 'deleteContentBackward') {
      event.preventDefault();
      if (!this.#applyLocalDraftEdit(planLocalParagraphDeleteBackward(this.#index, this.#selection))) {
        void this.#deleteBackward();
      }
      return;
    }

    if (inputType === 'deleteContentForward') {
      event.preventDefault();
      if (!this.#applyLocalDraftEdit(planLocalParagraphDeleteForward(this.#index, this.#selection))) {
        void this.#deleteForward();
      }
    }
  };

  readonly #handleInput = () => {
    this.#hiddenInputHost.reset();
  };

  readonly #handleCompositionEnd = () => {
    this.#hiddenInputHost.reset();
  };

  readonly #handleKeyDown = (event: KeyboardEvent) => {
    if (!this.#isReady || this.#isMutating) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void this.#applyHistoryMutation(event.shiftKey ? 'redo' : 'undo');
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.#moveHorizontal(-1, event.shiftKey);
        return;
      case 'ArrowRight':
        event.preventDefault();
        this.#moveHorizontal(1, event.shiftKey);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.#moveVertical('up', event.shiftKey);
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.#moveVertical('down', event.shiftKey);
        return;
      case 'Backspace':
        event.preventDefault();
        void this.#deleteBackward();
        return;
      case 'Delete':
        event.preventDefault();
        void this.#deleteForward();
        return;
      case 'Enter':
        event.preventDefault();
        void this.#splitSelection();
        return;
      default:
        return;
    }
  };

  readonly #handleScroll = () => {
    this.#domContext.invalidate();
    this.renderSelection();
  };

  readonly #handleResize = () => {
    this.#domContext.invalidate();
    this.renderSelection();
  };

  constructor(options: V2EditingSessionOptions) {
    this.#container = options.container;
    this.#controller = options.controller;
    this.#getSnapshot = options.getSnapshot;
    this.#patchParagraphText = options.patchParagraphText ?? null;
    this.#commitParagraphText = options.commitParagraphText ?? null;
    this.#refreshView = options.refreshView ?? null;
    this.#domContext = new V2EditingDomContext(this.#container);
    this.#index = new V2EditableIndex(options.getSnapshot());
    ensureV2SelectionOverlayStyles(this.#container.ownerDocument);
    this.#overlay = new V2SelectionOverlay(this.#container);
    this.#hiddenInputHost = new V2HiddenInputHost(
      this.#container.ownerDocument,
      Math.max(320, this.#container.clientWidth),
    );
  }

  attach(): void {
    this.#container.addEventListener('pointerdown', this.#handlePointerDown);
    this.#container.addEventListener('scroll', this.#handleScroll, { passive: true });
    window.addEventListener('resize', this.#handleResize);
    this.#hiddenInputHost.element.addEventListener('beforeinput', this.#handleBeforeInput);
    this.#hiddenInputHost.element.addEventListener('input', this.#handleInput);
    this.#hiddenInputHost.element.addEventListener('compositionend', this.#handleCompositionEnd);
    this.#hiddenInputHost.element.addEventListener('keydown', this.#handleKeyDown);
    this.refresh();
  }

  refresh(): void {
    this.#domContext.invalidate();
    this.#index = new V2EditableIndex(this.#getSnapshot());

    if (this.#pendingSelection) {
      const restoredPendingSelection = this.#index.restorePendingSelection(this.#pendingSelection);
      this.#selection = restoredPendingSelection ?? { kind: 'none' };
      this.#pendingSelection = null;
    } else if (this.#selection.kind !== 'none') {
      this.#selection = restoreCurrentSelection(this.#index, this.#selection);
    }

    this.renderSelection();
  }

  setReady(isReady: boolean): void {
    this.#isReady = isReady;
    if (!isReady) {
      this.#isPointerSelecting = false;
      this.#pointerAnchor = null;
      this.#overlay.clear();
    }
  }

  renderSelection(): void {
    if (this.#selection.kind === 'none') {
      this.#overlay.clear();
      return;
    }

    const bounds = this.#index.normalizeSelection(this.#selection);
    if (!bounds) {
      this.#overlay.clear();
      return;
    }

    if (this.#selection.kind === 'caret') {
      const caretRect = this.#domContext.computeCaretRect(this.#selection.focus);
      if (!caretRect) {
        this.#overlay.clear();
        return;
      }

      this.#overlay.renderCaret(caretRect);
      return;
    }

    const rects = this.#domContext.computeRangeRects(bounds.start, bounds.end);
    if (rects.length === 0) {
      this.#overlay.clear();
      return;
    }

    this.#overlay.renderRange(rects);
  }

  clearSelection(): void {
    this.#selection = { kind: 'none' };
    this.#goalX = null;
    this.#overlay.clear();
  }

  destroy(): void {
    this.#clearParagraphDraft();
    this.#container.removeEventListener('pointerdown', this.#handlePointerDown);
    this.#container.removeEventListener('scroll', this.#handleScroll);
    window.removeEventListener('resize', this.#handleResize);
    window.removeEventListener('pointermove', this.#handlePointerMove);
    window.removeEventListener('pointerup', this.#handlePointerUp);
    this.#hiddenInputHost.element.removeEventListener('beforeinput', this.#handleBeforeInput);
    this.#hiddenInputHost.element.removeEventListener('input', this.#handleInput);
    this.#hiddenInputHost.element.removeEventListener('compositionend', this.#handleCompositionEnd);
    this.#hiddenInputHost.element.removeEventListener('keydown', this.#handleKeyDown);
    this.#hiddenInputHost.destroy();
    this.#overlay.destroy();
  }

  async #replaceSelection(text: string): Promise<void> {
    const bounds = this.#index.normalizeSelection(this.#selection);
    if (!bounds) {
      return;
    }

    await this.#runMutation('replaceText', async () =>
      replaceSelectionWithText(this.#controller, this.#index, bounds, text),
    );
  }

  async #deleteBackward(): Promise<void> {
    await this.#runMutation('deleteBackward', async () =>
      deleteBackward(this.#controller, this.#index, this.#selection),
    );
  }

  async #deleteForward(): Promise<void> {
    await this.#runMutation('deleteForward', async () => deleteForward(this.#controller, this.#index, this.#selection));
  }

  async #splitSelection(): Promise<void> {
    await this.#runMutation('splitSelection', async () =>
      splitSelection(this.#controller, this.#index, this.#selection),
    );
  }

  async #applyHistoryMutation(direction: 'undo' | 'redo'): Promise<void> {
    await this.#runMutation(direction, async () => {
      const result = direction === 'undo' ? await this.#controller.undo() : await this.#controller.redo();

      if ('noop' in result && result.noop) {
        return null;
      }

      if ('ok' in result && !result.ok) {
        throw new Error(result.error ?? `${direction} failed`);
      }

      return this.selectionToPendingSelection();
    });
  }

  async #runMutation(
    mutationKind: V2EditingMutationKind,
    action: () => Promise<V2PendingSelection | null>,
  ): Promise<void> {
    if (this.#isMutating) {
      return;
    }

    if (mutationKind !== 'replaceText') {
      this.#scheduleParagraphDraftFlush(0);
    }

    this.#isMutating = true;
    const anchorParagraphSourceRef = selectionAnchorParagraphSourceRef(this.#selection);

    try {
      const pendingSelection = await action();
      if (pendingSelection) {
        this.#pendingSelection = pendingSelection;
      }

      if (this.#refreshView) {
        await this.#refreshView({
          repaint: true,
          pendingSelection,
          anchorParagraphSourceRef,
          mutationKind,
        });
        this.refresh();
      } else if (pendingSelection) {
        this.#applyOptimisticSelection(pendingSelection);
      }

      this.#hiddenInputHost.reset();
      this.#hiddenInputHost.focus();
    } finally {
      this.#isMutating = false;
    }
  }

  #applyLocalDraftEdit(edit: V2LocalParagraphDraftEdit | null): boolean {
    if (!edit || !this.#patchParagraphText) {
      return false;
    }

    if (!this.#canUseParagraphDraft(edit)) {
      this.#scheduleParagraphDraftFlush(0);
      return false;
    }

    if (!this.#patchParagraphText(edit.blockId, edit.nextText)) {
      return false;
    }

    this.#patchRenderedParagraphDraft(edit.blockId, edit.nextText);
    this.#updateParagraphDraft(edit);
    this.#pendingSelection = edit.pendingSelection;
    this.refresh();
    this.#scheduleParagraphDraftFlush();
    this.#hiddenInputHost.reset();
    this.#hiddenInputHost.focus();
    return true;
  }

  #canUseParagraphDraft(edit: V2LocalParagraphDraftEdit): boolean {
    if (!this.#paragraphDraft) {
      return true;
    }

    return this.#sameSourceRef(this.#paragraphDraft.paragraphSourceRef, edit.paragraphSourceRef);
  }

  #updateParagraphDraft(edit: V2LocalParagraphDraftEdit): void {
    const existingDraft = this.#paragraphDraft;
    if (!existingDraft || !this.#sameSourceRef(existingDraft.paragraphSourceRef, edit.paragraphSourceRef)) {
      this.#clearParagraphDraft();
      this.#paragraphDraft = {
        blockId: edit.blockId,
        paragraphSourceRef: edit.paragraphSourceRef,
        committedText: edit.committedText,
        currentText: edit.nextText,
        pendingSelection: edit.pendingSelection,
        flushTimerId: null,
        flushInFlight: false,
        flushRequestedWhileBusy: false,
      };
      return;
    }

    existingDraft.currentText = edit.nextText;
    existingDraft.pendingSelection = edit.pendingSelection;
  }

  #scheduleParagraphDraftFlush(delayMs: number = LOCAL_TEXT_FLUSH_DELAY_MS): void {
    const draft = this.#paragraphDraft;
    if (!draft) {
      return;
    }

    if (draft.flushTimerId != null) {
      window.clearTimeout(draft.flushTimerId);
    }

    draft.flushTimerId = window.setTimeout(() => {
      draft.flushTimerId = null;
      void this.#flushParagraphDraft();
    }, delayMs);
  }

  async #flushParagraphDraft(): Promise<void> {
    const draft = this.#paragraphDraft;
    if (!draft) {
      return;
    }

    if (draft.flushInFlight) {
      draft.flushRequestedWhileBusy = true;
      return;
    }

    if (draft.currentText === draft.committedText) {
      return;
    }

    draft.flushInFlight = true;
    const committedText = draft.committedText;
    const nextText = draft.currentText;
    const pendingSelection = draft.pendingSelection;

    try {
      await applyParagraphTextEdit(this.#controller, draft.paragraphSourceRef, committedText, nextText);
      draft.committedText = nextText;

      const committedLocally = this.#commitParagraphText?.(draft.blockId, draft.paragraphSourceRef) ?? false;
      if (!committedLocally && this.#refreshView) {
        await this.#refreshView({
          repaint: false,
          pendingSelection,
          anchorParagraphSourceRef: draft.paragraphSourceRef,
          mutationKind: 'replaceText',
        });
      }

      this.#pendingSelection = pendingSelection;
      this.refresh();
    } finally {
      draft.flushInFlight = false;

      if (draft.flushRequestedWhileBusy) {
        draft.flushRequestedWhileBusy = false;
        this.#scheduleParagraphDraftFlush(0);
      }
    }
  }

  #patchRenderedParagraphDraft(blockId: string, text: string): void {
    const blockElement = this.#container.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    if (!blockElement) {
      return;
    }

    this.#domContext.invalidate();
    patchRenderedParagraphDraftText(blockElement, text);
  }

  #clearParagraphDraft(): void {
    const draft = this.#paragraphDraft;
    if (!draft) {
      return;
    }

    if (draft.flushTimerId != null) {
      window.clearTimeout(draft.flushTimerId);
    }

    this.#paragraphDraft = null;
  }

  #sameSourceRef(left: SourceRef, right: SourceRef): boolean {
    return (
      left.partUri === right.partUri &&
      left.nodeId === right.nodeId &&
      (left.sourceNodePath ?? '') === (right.sourceNodePath ?? '')
    );
  }

  #moveHorizontal(delta: -1 | 1, extend: boolean): void {
    const position = this.#resolveMovementOrigin(delta, extend);
    if (!position) {
      return;
    }

    const nextPosition = this.#index.moveByCharacter(position, delta);
    if (!nextPosition) {
      return;
    }

    this.#goalX = null;
    const anchor = currentAnchor(this.#selection, nextPosition);
    this.#selection = extend ? createSelection(anchor, nextPosition) : createSelection(nextPosition, nextPosition);
    this.renderSelection();
  }

  #applyOptimisticSelection(pendingSelection: V2PendingSelection): void {
    const liveModel = this.#controller.runtime.semanticModel;
    if (!liveModel) {
      return;
    }

    const currentSnapshot = this.#getSnapshot();
    const optimisticSnapshot = buildEditableDocumentSnapshot(liveModel, currentSnapshot.blockToEntityRef);
    const optimisticIndex = new V2EditableIndex(optimisticSnapshot);
    const resolvedSelection = optimisticIndex.restorePendingSelection(pendingSelection);
    if (!resolvedSelection) {
      return;
    }

    this.#index = optimisticIndex;
    this.#selection = resolvedSelection;
    this.renderSelection();
  }

  #moveVertical(direction: 'up' | 'down', extend: boolean): void {
    const position = this.#resolveMovementOrigin(direction === 'up' ? -1 : 1, extend);
    if (!position) {
      return;
    }

    const caretRect = this.#domContext.computeCaretRect(position);
    if (!caretRect) {
      return;
    }

    const containerRect = this.#container.getBoundingClientRect();
    const targetX = this.#goalX ?? caretRect.left + 1;
    const verticalStep = Math.max(14, caretRect.height * 1.4);
    const targetY = direction === 'up' ? caretRect.top - verticalStep : caretRect.top + verticalStep;

    const nextPosition = this.#domContext.resolveTextPositionFromClientPoint(
      this.#index,
      containerRect.left + targetX,
      containerRect.top + targetY,
    );
    if (!nextPosition) {
      return;
    }

    this.#goalX = targetX;
    const anchor = currentAnchor(this.#selection, nextPosition);
    this.#selection = extend ? createSelection(anchor, nextPosition) : createSelection(nextPosition, nextPosition);
    this.renderSelection();
  }

  #resolveMovementOrigin(delta: -1 | 1, extend: boolean): V2ResolvedTextPosition | null {
    if (this.#selection.kind === 'none') {
      return null;
    }

    if (extend || this.#selection.kind === 'caret') {
      return this.#selection.focus;
    }

    const bounds = this.#index.normalizeSelection(this.#selection);
    if (!bounds) {
      return null;
    }

    return delta < 0 ? bounds.start : bounds.end;
  }

  private selectionToPendingSelection(): V2PendingSelection | null {
    if (this.#selection.kind === 'none') {
      return null;
    }

    if (this.#selection.kind === 'caret') {
      return {
        kind: 'caret',
        paragraphSourceRef: this.#selection.focus.paragraphSourceRef,
        paragraphOffset: this.#selection.focus.paragraphOffset,
      };
    }

    return {
      kind: 'range',
      anchorParagraphSourceRef: this.#selection.anchor.paragraphSourceRef,
      anchorOffset: this.#selection.anchor.paragraphOffset,
      focusParagraphSourceRef: this.#selection.focus.paragraphSourceRef,
      focusOffset: this.#selection.focus.paragraphOffset,
    };
  }
}

function createSelection(anchor: V2ResolvedTextPosition, focus: V2ResolvedTextPosition): V2ResolvedSelection {
  if (anchor.blockId === focus.blockId && anchor.paragraphOffset === focus.paragraphOffset) {
    return {
      kind: 'caret',
      anchor,
      focus,
    };
  }

  return {
    kind: 'range',
    anchor,
    focus,
  };
}

function restoreCurrentSelection(index: V2EditableIndex, selection: V2ResolvedSelection): V2ResolvedSelection {
  if (selection.kind === 'none') {
    return selection;
  }

  if (selection.kind === 'caret') {
    return (
      index.restorePendingSelection({
        kind: 'caret',
        paragraphSourceRef: selection.focus.paragraphSourceRef,
        paragraphOffset: selection.focus.paragraphOffset,
      }) ?? { kind: 'none' }
    );
  }

  return (
    index.restorePendingSelection({
      kind: 'range',
      anchorParagraphSourceRef: selection.anchor.paragraphSourceRef,
      anchorOffset: selection.anchor.paragraphOffset,
      focusParagraphSourceRef: selection.focus.paragraphSourceRef,
      focusOffset: selection.focus.paragraphOffset,
    }) ?? { kind: 'none' }
  );
}

function currentAnchor(selection: V2ResolvedSelection, fallback: V2ResolvedTextPosition): V2ResolvedTextPosition {
  if (selection.kind === 'none') {
    return fallback;
  }

  return selection.anchor;
}

function normalizeInsertedText(value: string): string | null {
  const normalized = value.replace(/\r\n?/g, '\n');
  if (normalized.includes('\n')) {
    return null;
  }

  return normalized;
}

function selectionAnchorParagraphSourceRef(selection: V2ResolvedSelection): SourceRef | null {
  if (selection.kind === 'none') {
    return null;
  }

  return selection.anchor.paragraphSourceRef;
}
