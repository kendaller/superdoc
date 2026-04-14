import type { DocumentRuntime, SemanticOperation } from '@superdoc/v2-model';
import { DATA_ATTRS } from '@superdoc/dom-contract';
import type { V2EditingController } from '../runtime/V2EditingController.js';
import { V2EditableIndex } from './V2EditableIndex.js';
import {
  createOptimisticEditableParagraph,
  type V2EditableDocumentSnapshot,
  type V2EditableParagraph,
} from './V2EditableDocumentSnapshot.js';
import { resolveParagraphOffsetFromClientPoint, resolveTextPositionFromClientPoint } from './V2EditingDom.js';
import { planParagraphTextEditForParagraph } from './V2MutationPlanner.js';

const PATCH_LAYER_CLASS = 'v2-fast-editing-session__layer';
const PATCHED_BLOCK_ATTR = 'data-v2-fast-editing-patched';
const ACTIVE_LAYER_ATTR = 'data-v2-fast-editing-active';
const READY_ATTR = 'data-v2-fast-editing-ready';
const EDITABLE_COUNT_ATTR = 'data-v2-fast-editable-count';
const SUPPORTED_COUNT_ATTR = 'data-v2-fast-supported-count';
const FLUSH_DEBOUNCE_MS = 140;
const CONTROLLER_SYNC_IDLE_MS = 900;
const STYLE_ID = 'v2-fast-editing-session-styles';

type V2FastEditingSessionOptions = {
  readonly container: HTMLElement;
  readonly controller: V2EditingController;
  readonly runtime: DocumentRuntime;
  readonly getSnapshot: () => V2EditableDocumentSnapshot;
  readonly patchParagraphText: (blockId: string, text: string) => boolean;
  readonly refreshSnapshotFromController?: (() => void | Promise<void>) | null;
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
};

type ParagraphActivation = {
  readonly paragraph: V2EditableParagraph;
  readonly paragraphOffset: number;
};

export class V2FastEditingSession {
  readonly #container: HTMLElement;
  readonly #controller: V2EditingController;
  readonly #runtime: DocumentRuntime;
  readonly #getSnapshot: () => V2EditableDocumentSnapshot;
  readonly #patchParagraphText: (blockId: string, text: string) => boolean;
  readonly #refreshSnapshotFromController: (() => void | Promise<void>) | null;

  #index: V2EditableIndex;
  #records = new Map<string, ParagraphLayerRecord>();
  #activeBlockId: string | null = null;
  #controllerSyncTimerId: number | null = null;
  #controllerSyncInFlight = false;
  #controllerSyncRequestedWhileBusy = false;
  #isReady = false;

  readonly #handlePointerDown = (event: PointerEvent) => {
    if (!this.#isReady) {
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
        return;
      }

      const record = this.#records.get(blockId);
      if (!record) {
        return;
      }

      const paragraphOffset = resolveParagraphOffsetFromClientPoint(
        this.#container,
        record.paragraph,
        event.clientX,
        event.clientY,
      );
      if (paragraphOffset == null) {
        return;
      }

      event.preventDefault();
      this.#activateRecord(record, paragraphOffset);
      return;
    }

    const activation = this.#resolveActivation(target, event.clientX, event.clientY);
    if (!activation) {
      return;
    }

    event.preventDefault();
    const record = this.#ensureRecord(activation.paragraph);
    if (!record) {
      return;
    }

    this.#activateRecord(record, activation.paragraphOffset);
  };

  constructor(options: V2FastEditingSessionOptions) {
    this.#container = options.container;
    this.#controller = options.controller;
    this.#runtime = options.runtime;
    this.#getSnapshot = options.getSnapshot;
    this.#patchParagraphText = options.patchParagraphText;
    this.#refreshSnapshotFromController = options.refreshSnapshotFromController ?? null;
    this.#index = new V2EditableIndex(this.#getSnapshot());
    ensureFastEditingSessionStyles(this.#container.ownerDocument);
  }

  attach(): void {
    this.#container.addEventListener('pointerdown', this.#handlePointerDown);
    this.refresh();
  }

  setReady(isReady: boolean): void {
    this.#isReady = isReady;
    this.#container.setAttribute(READY_ATTR, String(isReady));
  }

  refresh(): void {
    this.#index = new V2EditableIndex(this.#getSnapshot());
    this.#updateDebugCounts();

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
    const fastEditableCount = paragraphs.filter((paragraph) => supportsFastParagraphEditing(paragraph)).length;

    this.#container.setAttribute(EDITABLE_COUNT_ATTR, String(fastEditableCount));
    this.#container.setAttribute(SUPPORTED_COUNT_ATTR, String(supportedCount));
  }

  destroy(): void {
    this.#container.removeEventListener('pointerdown', this.#handlePointerDown);
    this.#container.removeAttribute(READY_ATTR);
    this.#container.removeAttribute(EDITABLE_COUNT_ATTR);
    this.#container.removeAttribute(SUPPORTED_COUNT_ATTR);
    if (this.#controllerSyncTimerId != null) {
      window.clearTimeout(this.#controllerSyncTimerId);
      this.#controllerSyncTimerId = null;
    }

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
        return {
          paragraph,
          paragraphOffset: resolvedPosition.paragraphOffset,
        };
      }
    }

    const blockElement = target?.closest<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}]`) ?? null;
    const blockId = blockElement?.getAttribute(DATA_ATTRS.BLOCK_ID);
    if (!blockElement || !blockId) {
      return null;
    }

    const paragraph = this.#index.paragraphByBlockId(blockId);
    if (!supportsFastParagraphEditing(paragraph)) {
      return null;
    }

    if (!blockHasInlineSegmentAnchors(blockElement)) {
      return null;
    }

    const paragraphOffset = resolveParagraphOffsetFromClientPoint(this.#container, paragraph, clientX, clientY);
    if (paragraphOffset == null) {
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
      return existingRecord;
    }

    const blockElement = this.#findBlockElement(paragraph.blockId);
    if (!blockElement) {
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
      this.#scheduleControllerSync();
    });

    layer.addEventListener('keydown', (event) => {
      if (shouldBlockStructuralEdit(event)) {
        event.preventDefault();
      }
    });

    this.#records.set(paragraph.blockId, record);
    this.#updateRecordLayout(record);
    return record;
  }

  #activateRecord(record: ParagraphLayerRecord, paragraphOffset: number): void {
    this.#setActiveBlock(record.blockId);
    this.#updateRecordLayout(record);
    record.element.focus({ preventScroll: true });
    setSelectionOffsets(record.element, paragraphOffset);
  }

  #setActiveBlock(blockId: string): void {
    this.#activeBlockId = blockId;
    for (const record of this.#records.values()) {
      const isActive = record.blockId === blockId;
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
      const plannedEdit = planParagraphTextEditForParagraph(record.paragraph, record.committedText, record.currentText);
      if (!plannedEdit || plannedEdit.operations.length === 0) {
        record.committedText = record.currentText;
        record.paragraph = createOptimisticEditableParagraph(record.paragraph, record.committedText);
        return;
      }

      await this.#applyRuntimeOperations(plannedEdit.operations);

      record.committedText = record.currentText;
      if (requiresImmediateControllerResync(record.paragraph)) {
        await this.#syncControllerFromRuntime();
      } else {
        record.paragraph = createOptimisticEditableParagraph(record.paragraph, record.committedText);
        this.#scheduleControllerSync();
      }
    } catch (error) {
      console.error('[V2FastEditingSession] Runtime flush failed', error);
      record.currentText = record.committedText;
      this.#syncRecordText(record, record.committedText);
      this.#patchParagraphText(record.blockId, record.committedText);
      this.#updateRecordLayout(record);
    } finally {
      record.flushInFlight = false;
      if (record.flushRequestedWhileBusy) {
        record.flushRequestedWhileBusy = false;
        void this.#flushRecord(record);
      }
    }
  }

  async #applyRuntimeOperations(operations: readonly SemanticOperation[]): Promise<void> {
    if (!this.#runtime.applyOperation) {
      throw new Error('Fast editing requires runtime.applyOperation() support');
    }

    for (const operation of operations) {
      const result = await this.#runtime.applyOperation(operation);
      if (!result.ok) {
        throw new Error(result.error ?? `Runtime mutation failed for ${operation.kind}`);
      }
    }
  }

  #scheduleControllerSync(): void {
    if (this.#controllerSyncTimerId != null) {
      window.clearTimeout(this.#controllerSyncTimerId);
    }

    this.#controllerSyncTimerId = window.setTimeout(() => {
      this.#controllerSyncTimerId = null;
      void this.#syncControllerFromRuntime();
    }, CONTROLLER_SYNC_IDLE_MS);
  }

  async #syncControllerFromRuntime(): Promise<void> {
    if (this.#controllerSyncInFlight) {
      this.#controllerSyncRequestedWhileBusy = true;
      return;
    }

    this.#controllerSyncInFlight = true;

    try {
      const bytes = await this.#runtime.save();
      await this.#controller.initialize(bytes);
      await this.#refreshSnapshotFromController?.();
      this.refresh();
    } catch (error) {
      console.error('[V2FastEditingSession] Controller resync failed', error);
    } finally {
      this.#controllerSyncInFlight = false;
      if (this.#controllerSyncRequestedWhileBusy) {
        this.#controllerSyncRequestedWhileBusy = false;
        this.#scheduleControllerSync();
      }
    }
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

function requiresImmediateControllerResync(paragraph: V2EditableParagraph): boolean {
  const mutableRunIds = new Set(
    paragraph.segments.filter((segment) => segment.isMutableText).map((segment) => segment.runRef.id),
  );
  const hasProtectedInlineContent = paragraph.segments.some((segment) => !segment.isMutableText);
  return hasProtectedInlineContent || mutableRunIds.size > 1;
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
