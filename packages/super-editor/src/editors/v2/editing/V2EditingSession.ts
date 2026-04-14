import type { V2EditingController } from '../runtime/V2EditingController.js';
import { buildEditableDocumentSnapshot, type V2EditableDocumentSnapshot } from './V2EditableDocumentSnapshot.js';
import { V2EditableIndex } from './V2EditableIndex.js';
import { computeCaretRect, computeRangeRects, resolveTextPositionFromClientPoint } from './V2EditingDom.js';
import { V2HiddenInputHost } from './V2HiddenInputHost.js';
import type { V2ResolvedSelection, V2ResolvedTextPosition, V2PendingSelection } from './V2EditingTypes.js';
import { deleteBackward, deleteForward, replaceSelectionWithText, splitSelection } from './V2MutationPlanner.js';
import { V2SelectionOverlay, ensureV2SelectionOverlayStyles } from './V2SelectionOverlay.js';

type V2EditingSessionOptions = {
  readonly container: HTMLElement;
  readonly controller: V2EditingController;
  readonly getSnapshot: () => V2EditableDocumentSnapshot;
};

export class V2EditingSession {
  readonly #container: HTMLElement;
  readonly #controller: V2EditingController;
  readonly #getSnapshot: () => V2EditableDocumentSnapshot;
  readonly #overlay: V2SelectionOverlay;
  readonly #hiddenInputHost: V2HiddenInputHost;
  #index: V2EditableIndex;
  #selection: V2ResolvedSelection = { kind: 'none' };
  #pendingSelection: V2PendingSelection | null = null;
  #pointerAnchor: V2ResolvedTextPosition | null = null;
  #goalX: number | null = null;
  #isPointerSelecting = false;
  #isMutating = false;

  readonly #handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.#isMutating) {
      return;
    }

    const position = resolveTextPositionFromClientPoint(this.#container, this.#index, event.clientX, event.clientY);

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

    const position = resolveTextPositionFromClientPoint(this.#container, this.#index, event.clientX, event.clientY);
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
    if (this.#selection.kind === 'none' || this.#isMutating) {
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
      void this.#replaceSelection(normalizedText);
      return;
    }

    if (inputType === 'insertParagraph') {
      event.preventDefault();
      void this.#splitSelection();
      return;
    }

    if (inputType === 'deleteContentBackward') {
      event.preventDefault();
      void this.#deleteBackward();
      return;
    }

    if (inputType === 'deleteContentForward') {
      event.preventDefault();
      void this.#deleteForward();
    }
  };

  readonly #handleInput = () => {
    this.#hiddenInputHost.reset();
  };

  readonly #handleCompositionEnd = () => {
    this.#hiddenInputHost.reset();
  };

  readonly #handleKeyDown = (event: KeyboardEvent) => {
    if (this.#isMutating) {
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
    this.renderSelection();
  };

  readonly #handleResize = () => {
    this.renderSelection();
  };

  constructor(options: V2EditingSessionOptions) {
    this.#container = options.container;
    this.#controller = options.controller;
    this.#getSnapshot = options.getSnapshot;
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
      const caretRect = computeCaretRect(this.#container, this.#selection.focus);
      if (!caretRect) {
        this.#overlay.clear();
        return;
      }

      this.#overlay.renderCaret(caretRect);
      return;
    }

    const rects = computeRangeRects(this.#container, bounds.start, bounds.end);
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

    await this.#runMutation(async () => replaceSelectionWithText(this.#controller, this.#index, bounds, text));
  }

  async #deleteBackward(): Promise<void> {
    await this.#runMutation(async () => deleteBackward(this.#controller, this.#index, this.#selection));
  }

  async #deleteForward(): Promise<void> {
    await this.#runMutation(async () => deleteForward(this.#controller, this.#index, this.#selection));
  }

  async #splitSelection(): Promise<void> {
    await this.#runMutation(async () => splitSelection(this.#controller, this.#index, this.#selection));
  }

  async #applyHistoryMutation(direction: 'undo' | 'redo'): Promise<void> {
    await this.#runMutation(async () => {
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

  async #runMutation(action: () => Promise<V2PendingSelection | null>): Promise<void> {
    if (this.#isMutating) {
      return;
    }

    this.#isMutating = true;

    try {
      const pendingSelection = await action();
      if (pendingSelection) {
        this.#pendingSelection = pendingSelection;
        this.#applyOptimisticSelection(pendingSelection);
      }
      this.#hiddenInputHost.reset();
      this.#hiddenInputHost.focus();
    } finally {
      this.#isMutating = false;
    }
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

    const caretRect = computeCaretRect(this.#container, position);
    if (!caretRect) {
      return;
    }

    const containerRect = this.#container.getBoundingClientRect();
    const targetX = this.#goalX ?? caretRect.left + 1;
    const verticalStep = Math.max(14, caretRect.height * 1.4);
    const targetY = direction === 'up' ? caretRect.top - verticalStep : caretRect.top + verticalStep;

    const nextPosition = resolveTextPositionFromClientPoint(
      this.#container,
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
