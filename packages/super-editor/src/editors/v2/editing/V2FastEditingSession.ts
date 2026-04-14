import type { SemanticOperation } from '@superdoc/v2-model';
import { DATA_ATTRS } from '@superdoc/dom-contract';
import type { V2EditingController } from '../runtime/V2EditingController.js';
import { V2EditableIndex } from './V2EditableIndex.js';
import {
  createOptimisticEditableParagraph,
  describeEditableParagraphBySourceRef,
  type V2EditableDocumentSnapshot,
  type V2EditableParagraph,
} from './V2EditableDocumentSnapshot.js';
import { resolveParagraphOffsetFromClientPoint, resolveTextPositionFromClientPoint } from './V2EditingDom.js';
import { planParagraphTextEditForLiveParagraph } from './V2MutationPlanner.js';

const PATCH_LAYER_CLASS = 'v2-fast-editing-session__layer';
const PATCHED_BLOCK_ATTR = 'data-v2-fast-editing-patched';
const ACTIVE_LAYER_ATTR = 'data-v2-fast-editing-active';
const READY_ATTR = 'data-v2-fast-editing-ready';
const EDITABLE_COUNT_ATTR = 'data-v2-fast-editable-count';
const SUPPORTED_COUNT_ATTR = 'data-v2-fast-supported-count';
const FLUSH_DEBOUNCE_MS = 140;
const STYLE_ID = 'v2-fast-editing-session-styles';

type RefreshEditingSurfaceOptions = {
  readonly repaint?: boolean;
};

type V2FastEditingSessionOptions = {
  readonly container: HTMLElement;
  readonly controller: V2EditingController;
  readonly getSnapshot: () => V2EditableDocumentSnapshot;
  readonly patchParagraphText: (blockId: string, text: string) => boolean;
  readonly refreshSnapshotFromController?: ((options?: RefreshEditingSurfaceOptions) => void | Promise<void>) | null;
};

type ParagraphLayerRecord = {
  readonly blockId: string;
  readonly paragraphSourceRef: V2EditableParagraph['paragraphSourceRef'];
  paragraph: V2EditableParagraph;
  element: HTMLDivElement;
  currentText: string;
  committedText: string;
  baseBlockHeight: number;
  flushTimerId: number | null;
  flushInFlight: boolean;
  flushRequestedWhileBusy: boolean;
  teardownRequestedOnBlur: boolean;
};

type ParagraphActivation = {
  readonly paragraph: V2EditableParagraph;
  readonly paragraphOffset: number;
};

export class V2FastEditingSession {
  readonly #container: HTMLElement;
  readonly #controller: V2EditingController;
  readonly #getSnapshot: () => V2EditableDocumentSnapshot;
  readonly #patchParagraphText: (blockId: string, text: string) => boolean;
  readonly #refreshSnapshotFromController: ((options?: RefreshEditingSurfaceOptions) => void | Promise<void>) | null;

  #index: V2EditableIndex;
  #records = new Map<string, ParagraphLayerRecord>();
  #activeBlockId: string | null = null;
  #isReady = false;

  readonly #handlePointerDown = (event: PointerEvent) => {
    if (!this.#isReady) {
      console.debug('[V2FastEditingSession] Ignoring pointerdown while not ready');
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    const existingLayer = target?.closest<HTMLDivElement>(`.${PATCH_LAYER_CLASS}`) ?? null;
    if (existingLayer) {
      const blockId = existingLayer.dataset.blockId;
      if (!blockId) {
        console.debug('[V2FastEditingSession] Existing layer missing block id');
        return;
      }

      const record = this.#records.get(blockId);
      if (!record) {
        console.debug('[V2FastEditingSession] Existing layer has no record', { blockId });
        return;
      }

      const paragraphOffset = resolveParagraphOffsetFromClientPoint(
        this.#container,
        record.paragraph,
        event.clientX,
        event.clientY,
      );
      if (paragraphOffset == null) {
        console.debug('[V2FastEditingSession] Existing layer click could not resolve paragraph offset', {
          blockId,
          clientX: event.clientX,
          clientY: event.clientY,
        });
        return;
      }

      event.preventDefault();
      console.debug('[V2FastEditingSession] Re-activating existing layer', {
        blockId,
        paragraphOffset,
      });
      this.#activateRecord(record, paragraphOffset);
      return;
    }

    const activation = this.#resolveActivation(target, event.clientX, event.clientY);
    if (!activation) {
      console.debug('[V2FastEditingSession] Pointerdown did not resolve editable activation', {
        targetTag: target?.tagName ?? null,
        targetClass: target?.className ?? null,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return;
    }

    event.preventDefault();
    const record = this.#ensureRecord(activation.paragraph);
    if (!record) {
      console.debug('[V2FastEditingSession] Activation resolved paragraph but no record could be mounted', {
        blockId: activation.paragraph.blockId,
        paragraphSourceNodeId: activation.paragraph.paragraphSourceRef.nodeId,
      });
      return;
    }

    console.debug('[V2FastEditingSession] Activating paragraph', {
      blockId: activation.paragraph.blockId,
      paragraphSourceNodeId: activation.paragraph.paragraphSourceRef.nodeId,
      paragraphOffset: activation.paragraphOffset,
      textLength: activation.paragraph.text.length,
      segmentCount: activation.paragraph.segments.length,
    });
    this.#activateRecord(record, activation.paragraphOffset);
  };

  constructor(options: V2FastEditingSessionOptions) {
    this.#container = options.container;
    this.#controller = options.controller;
    this.#getSnapshot = options.getSnapshot;
    this.#patchParagraphText = options.patchParagraphText;
    this.#refreshSnapshotFromController = options.refreshSnapshotFromController ?? null;
    this.#index = new V2EditableIndex(this.#getSnapshot());
    ensureFastEditingSessionStyles(this.#container.ownerDocument);
  }

  attach(): void {
    this.#container.addEventListener('pointerdown', this.#handlePointerDown);
    console.debug('[V2FastEditingSession] Attached', {
      ready: this.#isReady,
      snapshotParagraphCount: this.#index.snapshot.orderedParagraphs.length,
    });
    this.refresh();
  }

  setReady(isReady: boolean): void {
    this.#isReady = isReady;
    this.#container.setAttribute(READY_ATTR, String(isReady));
    console.debug('[V2FastEditingSession] Ready state changed', { isReady });
  }

  refresh(): void {
    this.#index = new V2EditableIndex(this.#getSnapshot());
    this.#updateDebugCounts();
    console.debug('[V2FastEditingSession] Refreshed snapshot', {
      paragraphCount: this.#index.snapshot.orderedParagraphs.length,
      supportedParagraphCount: this.#index.snapshot.orderedParagraphs.filter((paragraph) => paragraph.supported).length,
      mountedRecordCount: this.#records.size,
    });

    for (const [blockId, record] of this.#records) {
      const paragraph = this.#index.paragraphByBlockId(blockId);
      if (!supportsFastParagraphEditing(paragraph)) {
        this.#destroyRecord(record);
        this.#records.delete(blockId);
        continue;
      }

      if (!record.flushInFlight && paragraph.text === record.committedText) {
        record.paragraph = paragraph;
        record.currentText = paragraph.text;
        record.committedText = paragraph.text;
        this.#syncRecordText(record, paragraph.text);
      }

      this.#remountRecord(record);
      this.#updateRecordLayout(record);
    }
  }

  #updateDebugCounts(): void {
    const paragraphs = this.#index.snapshot.orderedParagraphs;
    const supportedCount = paragraphs.filter((paragraph) => paragraph.supported).length;
    const fastEditableCount = paragraphs.filter((paragraph) => this.#isParagraphActivatable(paragraph)).length;

    this.#container.setAttribute(EDITABLE_COUNT_ATTR, String(fastEditableCount));
    this.#container.setAttribute(SUPPORTED_COUNT_ATTR, String(supportedCount));
  }

  #isParagraphActivatable(paragraph: V2EditableParagraph): boolean {
    if (!supportsFastParagraphEditing(paragraph)) {
      return false;
    }

    const blockElement = this.#findBlockElement(paragraph.blockId);
    return blockElement != null && blockHasInlineSegmentAnchors(blockElement);
  }

  destroy(): void {
    this.#container.removeEventListener('pointerdown', this.#handlePointerDown);
    this.#container.removeAttribute(READY_ATTR);
    this.#container.removeAttribute(EDITABLE_COUNT_ATTR);
    this.#container.removeAttribute(SUPPORTED_COUNT_ATTR);

    for (const record of this.#records.values()) {
      this.#destroyRecord(record);
    }

    this.#records.clear();
    this.#activeBlockId = null;
  }

  #resolveActivation(target: HTMLElement | null, clientX: number, clientY: number): ParagraphActivation | null {
    const resolvedPosition = resolveTextPositionFromClientPoint(this.#container, this.#index, clientX, clientY);
    if (resolvedPosition) {
      const paragraph = this.#index.paragraphByBlockId(resolvedPosition.blockId);
      if (supportsFastParagraphEditing(paragraph)) {
        console.debug('[V2FastEditingSession] Resolved activation from segment hit-test', {
          blockId: resolvedPosition.blockId,
          paragraphOffset: resolvedPosition.paragraphOffset,
          runRefId: resolvedPosition.runRef.id,
          segmentId: resolvedPosition.segmentId,
        });
        return {
          paragraph,
          paragraphOffset: resolvedPosition.paragraphOffset,
        };
      }
    }

    const blockElement = target?.closest<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}]`) ?? null;
    const blockId = blockElement?.getAttribute(DATA_ATTRS.BLOCK_ID);
    if (!blockElement || !blockId) {
      console.debug('[V2FastEditingSession] Activation miss: no block element under target', {
        targetTag: target?.tagName ?? null,
        targetClass: target?.className ?? null,
      });
      return null;
    }

    const paragraph = this.#index.paragraphByBlockId(blockId);
    if (!supportsFastParagraphEditing(paragraph)) {
      console.debug('[V2FastEditingSession] Activation miss: paragraph is not fast-editable', {
        blockId,
        paragraphSupported: paragraph?.supported ?? false,
        segmentCount: paragraph?.segments.length ?? 0,
        unsupportedReason: paragraph?.unsupportedReason ?? null,
      });
      return null;
    }

    if (!blockHasInlineSegmentAnchors(blockElement)) {
      console.debug('[V2FastEditingSession] Activation miss: paragraph has no inline segment anchors in DOM', {
        blockId,
        paragraphSourceNodeId: paragraph.paragraphSourceRef.nodeId,
      });
      return null;
    }

    const paragraphOffset = resolveParagraphOffsetFromClientPoint(this.#container, paragraph, clientX, clientY);
    if (paragraphOffset == null) {
      console.debug('[V2FastEditingSession] Activation miss: could not resolve caret offset from client point', {
        blockId,
        clientX,
        clientY,
      });
      return null;
    }

    return {
      paragraph,
      paragraphOffset,
    };
  }

  #ensureRecord(paragraph: V2EditableParagraph): ParagraphLayerRecord | null {
    const existingRecord = this.#records.get(paragraph.blockId);
    if (existingRecord) {
      existingRecord.paragraph = paragraph;
      console.debug('[V2FastEditingSession] Reusing existing record', {
        blockId: paragraph.blockId,
      });
      return existingRecord;
    }

    const blockElement = this.#findBlockElement(paragraph.blockId);
    if (!blockElement) {
      console.debug('[V2FastEditingSession] Cannot create record because block element is missing', {
        blockId: paragraph.blockId,
      });
      return null;
    }

    const layer = this.#createLayer(blockElement, paragraph);
    const record: ParagraphLayerRecord = {
      blockId: paragraph.blockId,
      paragraphSourceRef: paragraph.paragraphSourceRef,
      paragraph,
      element: layer,
      currentText: paragraph.text,
      committedText: paragraph.text,
      baseBlockHeight: Math.max(blockElement.getBoundingClientRect().height, 1),
      flushTimerId: null,
      flushInFlight: false,
      flushRequestedWhileBusy: false,
      teardownRequestedOnBlur: false,
    };

    layer.addEventListener('input', () => {
      record.currentText = normalizeEditorText(layer.textContent ?? '');
      this.#patchParagraphText(record.blockId, record.currentText);
      this.#updateRecordLayout(record);
      this.#scheduleFlush(record);
    });

    layer.addEventListener('focus', () => {
      this.#setActiveBlock(record.blockId);
    });

    layer.addEventListener('blur', () => {
      this.#requestRecordTeardown(record);
    });

    layer.addEventListener('keydown', (event) => {
      if (shouldBlockStructuralEdit(event)) {
        event.preventDefault();
      }
    });

    this.#records.set(paragraph.blockId, record);
    this.#updateRecordLayout(record);
    console.debug('[V2FastEditingSession] Created record', {
      blockId: paragraph.blockId,
      paragraphSourceNodeId: paragraph.paragraphSourceRef.nodeId,
      textLength: paragraph.text.length,
      segmentCount: paragraph.segments.length,
    });
    return record;
  }

  #activateRecord(record: ParagraphLayerRecord, paragraphOffset: number): void {
    this.#setActiveBlock(record.blockId);
    this.#updateRecordLayout(record);
    record.element.focus({ preventScroll: true });
    setSelectionOffsets(record.element, paragraphOffset);
    console.debug('[V2FastEditingSession] Record activated', {
      blockId: record.blockId,
      paragraphOffset,
      activeElementTag: record.element.ownerDocument.activeElement?.tagName ?? null,
      activeElementClass: record.element.ownerDocument.activeElement?.className ?? null,
    });
  }

  #setActiveBlock(blockId: string | null): void {
    this.#activeBlockId = blockId;
    for (const record of this.#records.values()) {
      const isActive = blockId != null && record.blockId === blockId;
      record.element.contentEditable = isActive ? 'plaintext-only' : 'false';
      record.element.setAttribute(ACTIVE_LAYER_ATTR, isActive ? 'true' : 'false');
    }
  }

  #scheduleFlush(record: ParagraphLayerRecord): void {
    if (record.flushTimerId != null) {
      window.clearTimeout(record.flushTimerId);
    }

    record.flushTimerId = window.setTimeout(() => {
      record.flushTimerId = null;
      void this.#flushRecord(record);
    }, FLUSH_DEBOUNCE_MS);
  }

  async #flushRecord(record: ParagraphLayerRecord): Promise<void> {
    if (record.flushInFlight) {
      record.flushRequestedWhileBusy = true;
      return;
    }

    if (record.currentText === record.committedText) {
      return;
    }

    record.flushInFlight = true;

    try {
      const plannedEdit = planParagraphTextEditForLiveParagraph(
        this.#controller,
        record.paragraph,
        record.committedText,
        record.currentText,
      );
      console.debug('[V2FastEditingSession] Planned flush', {
        blockId: record.blockId,
        paragraphSourceNodeId: record.paragraph.paragraphSourceRef.nodeId,
        currentLength: record.currentText.length,
        committedLength: record.committedText.length,
        operations:
          plannedEdit?.operations.map((operation) => ({
            kind: operation.kind,
            target: operation.target,
            position: 'position' in operation ? operation.position : undefined,
            textLength: 'text' in operation && typeof operation.text === 'string' ? operation.text.length : undefined,
            deleteLength: 'deleteLength' in operation ? operation.deleteLength : undefined,
          })) ?? [],
      });
      if (!plannedEdit || plannedEdit.operations.length === 0) {
        record.committedText = record.currentText;
        record.paragraph = createOptimisticEditableParagraph(record.paragraph, record.committedText);
        return;
      }

      await this.#applyControllerOperations(plannedEdit.operations);

      record.committedText = record.currentText;
      const nextParagraph = this.#resolveLiveParagraph(record.paragraph);
      record.paragraph = nextParagraph ?? createOptimisticEditableParagraph(record.paragraph, record.committedText);

      await this.#refreshSnapshotFromController?.({ repaint: true });
      this.refresh();
      this.#completeDeferredTeardown(record);
    } catch (error) {
      console.error('[V2FastEditingSession] Mutation flush failed', {
        error,
        blockId: record.blockId,
        paragraphSourceNodeId: record.paragraph.paragraphSourceRef.nodeId,
        paragraphRefId: record.paragraph.paragraphRef.id,
        segmentRefs: record.paragraph.segments.map((segment) => ({
          runRefId: segment.runRef.id,
          runSourceNodeId: segment.runSourceRef.nodeId,
          segmentId: segment.segmentId,
          segmentIndex: segment.segmentIndex,
          paragraphStart: segment.paragraphStart,
          paragraphEnd: segment.paragraphEnd,
          textPreview: segment.text.slice(0, 40),
        })),
      });
      record.currentText = record.committedText;
      this.#syncRecordText(record, record.committedText);
      this.#patchParagraphText(record.blockId, record.committedText);
      this.#updateRecordLayout(record);
    } finally {
      record.flushInFlight = false;
      this.#completeDeferredTeardown(record);
      if (record.flushRequestedWhileBusy) {
        record.flushRequestedWhileBusy = false;
        void this.#flushRecord(record);
      }
    }
  }

  async #applyControllerOperations(operations: readonly SemanticOperation[]): Promise<void> {
    for (const operation of operations) {
      const result = await this.#controller.applyOperation(operation);
      if (!result.ok) {
        throw new Error(result.error ?? `Controller mutation failed for ${operation.kind}`);
      }
    }
  }

  #resolveLiveParagraph(paragraph: V2EditableParagraph): V2EditableParagraph | null {
    const model = this.#controller.semanticModel;
    if (!model) {
      return null;
    }

    return describeEditableParagraphBySourceRef(model, paragraph.paragraphSourceRef, paragraph.blockId);
  }

  #destroyRecord(record: ParagraphLayerRecord): void {
    if (record.flushTimerId != null) {
      window.clearTimeout(record.flushTimerId);
    }

    const blockElement = record.element.parentElement;
    if (blockElement instanceof HTMLElement) {
      blockElement.removeAttribute(PATCHED_BLOCK_ATTR);
      blockElement.style.minHeight = '';
    }

    record.element.remove();
  }

  #requestRecordTeardown(record: ParagraphLayerRecord): void {
    record.teardownRequestedOnBlur = true;
    if (this.#activeBlockId === record.blockId) {
      this.#setActiveBlock(null);
    }
    this.#completeDeferredTeardown(record);
  }

  #completeDeferredTeardown(record: ParagraphLayerRecord): void {
    if (!record.teardownRequestedOnBlur) {
      return;
    }

    if (record.flushInFlight || record.currentText !== record.committedText) {
      return;
    }

    this.#records.delete(record.blockId);
    this.#destroyRecord(record);
  }

  #remountRecord(record: ParagraphLayerRecord): void {
    if (record.element.isConnected) {
      return;
    }

    const blockElement = this.#findBlockElement(record.blockId);
    if (!blockElement) {
      return;
    }

    mountLayer(blockElement, record.element);
  }

  #syncRecordText(record: ParagraphLayerRecord, text: string): void {
    if (normalizeEditorText(record.element.textContent ?? '') === text) {
      return;
    }

    record.element.textContent = text;
  }

  #updateRecordLayout(record: ParagraphLayerRecord): void {
    const blockElement = this.#findBlockElement(record.blockId);
    if (!blockElement) {
      return;
    }

    const desiredHeight = Math.max(record.baseBlockHeight, measureEditingLayerHeight(record.element));
    record.element.style.minHeight = `${desiredHeight}px`;
    blockElement.style.minHeight = `${desiredHeight}px`;
  }

  #findBlockElement(blockId: string): HTMLElement | null {
    return this.#container.querySelector<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}="${blockId}"]`);
  }

  #createLayer(blockElement: HTMLElement, paragraph: V2EditableParagraph): HTMLDivElement {
    const layer = blockElement.ownerDocument.createElement('div');
    layer.className = PATCH_LAYER_CLASS;
    layer.dataset.blockId = paragraph.blockId;
    layer.textContent = paragraph.text;
    copyParagraphStyles(blockElement, layer);
    mountLayer(blockElement, layer);
    return layer;
  }
}

function mountLayer(blockElement: HTMLElement, layer: HTMLDivElement): void {
  if (!blockElement.style.position) {
    blockElement.style.position = 'relative';
  }

  blockElement.setAttribute(PATCHED_BLOCK_ATTR, 'true');
  blockElement.appendChild(layer);
}

function copyParagraphStyles(blockElement: HTMLElement, layer: HTMLDivElement): void {
  const firstLine = blockElement.querySelector<HTMLElement>('.superdoc-line');
  const firstText = blockElement.querySelector<HTMLElement>(`[${DATA_ATTRS.SD_SEGMENT_ID}]`);
  const lineStyle = firstLine ? window.getComputedStyle(firstLine) : null;
  const textStyle = firstText ? window.getComputedStyle(firstText) : null;
  const blockRect = blockElement.getBoundingClientRect();

  layer.style.minHeight = `${Math.max(blockRect.height, 1)}px`;
  layer.style.width = '100%';
  layer.style.boxSizing = 'border-box';
  layer.style.whiteSpace = 'pre-wrap';
  layer.style.overflowWrap = 'anywhere';
  layer.style.wordBreak = 'break-word';

  if (lineStyle) {
    layer.style.paddingLeft = lineStyle.paddingLeft;
    layer.style.paddingRight = lineStyle.paddingRight;
    layer.style.paddingTop = lineStyle.paddingTop;
    layer.style.paddingBottom = lineStyle.paddingBottom;
    layer.style.textAlign = lineStyle.textAlign;
    layer.style.lineHeight = lineStyle.lineHeight;
    layer.style.textIndent = lineStyle.textIndent;
    layer.style.direction = lineStyle.direction;
  }

  if (textStyle) {
    layer.style.fontFamily = textStyle.fontFamily;
    layer.style.fontSize = textStyle.fontSize;
    layer.style.fontWeight = textStyle.fontWeight;
    layer.style.fontStyle = textStyle.fontStyle;
    layer.style.color = textStyle.color;
    layer.style.letterSpacing = textStyle.letterSpacing;
    layer.style.textTransform = textStyle.textTransform;
    layer.style.textDecoration = textStyle.textDecoration;
  }
}

function ensureFastEditingSessionStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) {
    return;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${PATCHED_BLOCK_ATTR}="true"] > :not(.${PATCH_LAYER_CLASS}) {
      visibility: hidden;
      pointer-events: none;
    }

    .${PATCH_LAYER_CLASS} {
      position: absolute;
      inset: 0;
      z-index: 4;
      outline: none;
      border: 0;
      background: transparent;
      color: inherit;
      caret-color: currentColor;
      user-select: text;
    }

    .${PATCH_LAYER_CLASS}[${ACTIVE_LAYER_ATTR}="false"] {
      caret-color: transparent;
    }
  `;
  doc.head.appendChild(style);
}

function blockHasInlineSegmentAnchors(blockElement: HTMLElement): boolean {
  return blockElement.querySelector(`[${DATA_ATTRS.SD_SEGMENT_ID}]`) != null;
}

function supportsFastParagraphEditing(paragraph: V2EditableParagraph | undefined): paragraph is V2EditableParagraph {
  if (!paragraph?.supported || paragraph.segments.length === 0) {
    return false;
  }

  return paragraph.segments.some((segment) => segment.isMutableText);
}

function shouldBlockStructuralEdit(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === 'Tab';
}

function normalizeEditorText(value: string): string {
  return value.replace(/\u200B/g, '').replace(/\r\n?/g, '\n');
}

function measureEditingLayerHeight(element: HTMLElement): number {
  const currentHeight = Math.max(element.getBoundingClientRect().height, 1);
  const scrollHeight = Math.max(element.scrollHeight, 1);
  return Math.max(currentHeight, scrollHeight);
}

function setSelectionOffsets(element: HTMLElement, start: number, end: number = start): void {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) {
    return;
  }

  const startPoint = resolveDomTextPoint(element, start);
  const endPoint = resolveDomTextPoint(element, end);
  if (!startPoint || !endPoint) {
    return;
  }

  const range = element.ownerDocument.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function resolveDomTextPoint(element: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const textNodes = collectTextNodes(element);
  if (textNodes.length === 0) {
    const textNode = element.ownerDocument.createTextNode('');
    element.appendChild(textNode);
    return { node: textNode, offset: 0 };
  }

  let remaining = Math.max(0, offset);
  for (const textNode of textNodes) {
    const textLength = normalizeEditorText(textNode.textContent ?? '').length;
    if (remaining <= textLength) {
      return {
        node: textNode,
        offset: Math.min(remaining, textNode.textContent?.length ?? 0),
      };
    }
    remaining -= textLength;
  }

  const lastNode = textNodes[textNodes.length - 1];
  return {
    node: lastNode,
    offset: lastNode.textContent?.length ?? 0,
  };
}

function collectTextNodes(element: HTMLElement): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  let currentNode = walker.nextNode();
  while (currentNode) {
    if (currentNode instanceof Text) {
      nodes.push(currentNode);
    }
    currentNode = walker.nextNode();
  }

  return nodes;
}
