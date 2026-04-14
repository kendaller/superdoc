import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentRuntime } from '@superdoc/v2-model';
import { V2FastEditingSession } from './V2FastEditingSession.js';
import type { V2EditableDocumentSnapshot, V2EditableParagraph } from './V2EditableDocumentSnapshot.js';
import type { V2EditingController } from '../runtime/V2EditingController.js';

function createParagraph(): V2EditableParagraph {
  return {
    blockId: 'block-1',
    storyId: 'story-1',
    paragraphRef: { id: 'paragraph-1' },
    paragraphSourceRef: {
      partUri: '/word/document.xml',
      nodeId: 'paragraph-node-1',
    },
    text: 'Hello world',
    supported: true,
    segments: [
      {
        segmentKind: 'text',
        isMutableText: true,
        runRef: { id: 'run-1' },
        runSourceRef: {
          partUri: '/word/document.xml',
          nodeId: 'run-node-1',
        },
        runIndex: 0,
        segmentIndex: 0,
        segmentId: 'segment-1',
        text: 'Hello world',
        paragraphStart: 0,
        paragraphEnd: 11,
        runTextStart: 0,
        runTextEnd: 11,
      },
    ],
  };
}

function createSnapshot(paragraph: V2EditableParagraph): V2EditableDocumentSnapshot {
  return {
    blockToEntityRef: new Map([[paragraph.blockId, paragraph.paragraphRef]]),
    paragraphsByBlockId: new Map([[paragraph.blockId, paragraph]]),
    orderedParagraphs: [paragraph],
  };
}

describe('V2FastEditingSession', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('activates from streamed segment metadata', () => {
    const paragraph = createParagraph();
    const container = document.createElement('div');
    container.innerHTML = `
      <div data-block-id="block-1">
        <div class="superdoc-line">
          <span
            data-sd-segment-id="segment-1"
            data-sd-segment-start="0"
            data-sd-segment-end="11"
          >Hello world</span>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    const session = new V2FastEditingSession({
      container,
      controller: {
        initialize: vi.fn(),
      } as unknown as V2EditingController,
      runtime: {
        applyOperation: vi.fn(),
        save: vi.fn(),
      } as unknown as DocumentRuntime,
      getSnapshot: () => createSnapshot(paragraph),
      patchParagraphText: vi.fn().mockReturnValue(true),
    });

    cleanups.push(mockSegmentGeometry(container.querySelector('[data-sd-segment-id="segment-1"]') as HTMLElement));
    session.attach();
    session.setReady(true);

    const block = container.querySelector<HTMLElement>('[data-block-id="block-1"]');
    block?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 5,
        clientY: 5,
      }),
    );

    const layer = container.querySelector<HTMLElement>('.v2-fast-editing-session__layer');
    expect(container.getAttribute('data-v2-fast-editing-ready')).toBe('true');
    expect(layer).not.toBeNull();
    expect(layer?.getAttribute('contenteditable')).toBe('plaintext-only');

    session.destroy();
  });

  it('flushes through the runtime first and resyncs the controller after idle', async () => {
    const paragraph = createParagraph();
    const patchParagraphText = vi.fn().mockReturnValue(true);
    const runtime = {
      applyOperation: vi.fn().mockResolvedValue({ ok: true }),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    } as unknown as DocumentRuntime;
    const controller = {
      initialize: vi.fn().mockResolvedValue(undefined),
    } as unknown as V2EditingController;

    const container = document.createElement('div');
    container.innerHTML = `
      <div data-block-id="block-1">
        <div class="superdoc-line">
          <span
            data-sd-segment-id="segment-1"
            data-sd-segment-start="0"
            data-sd-segment-end="11"
          >Hello world</span>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    const session = new V2FastEditingSession({
      container,
      controller,
      runtime,
      getSnapshot: () => createSnapshot(paragraph),
      patchParagraphText,
      refreshSnapshotFromController: vi.fn(),
    });

    cleanups.push(mockSegmentGeometry(container.querySelector('[data-sd-segment-id="segment-1"]') as HTMLElement));
    session.attach();
    session.setReady(true);

    const block = container.querySelector<HTMLElement>('[data-block-id="block-1"]');
    block?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 5,
        clientY: 5,
      }),
    );

    const layer = container.querySelector<HTMLElement>('.v2-fast-editing-session__layer');
    expect(layer).not.toBeNull();

    layer!.textContent = 'Hello brave world';
    layer!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.advanceTimersByTimeAsync(200);
    expect(patchParagraphText).toHaveBeenCalledWith('block-1', 'Hello brave world');
    expect((runtime.applyOperation as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect((controller.initialize as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(runtime.save).toHaveBeenCalledTimes(1);
    expect(controller.initialize).toHaveBeenCalledTimes(1);

    session.destroy();
  });

  it('does not activate before the host marks the editing surface ready', () => {
    const paragraph = createParagraph();
    const container = document.createElement('div');
    container.innerHTML = `
      <div data-block-id="block-1">
        <div class="superdoc-line">
          <span
            data-sd-segment-id="segment-1"
            data-sd-segment-start="0"
            data-sd-segment-end="11"
          >Hello world</span>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    const session = new V2FastEditingSession({
      container,
      controller: {
        initialize: vi.fn(),
      } as unknown as V2EditingController,
      runtime: {
        applyOperation: vi.fn(),
        save: vi.fn(),
      } as unknown as DocumentRuntime,
      getSnapshot: () => createSnapshot(paragraph),
      patchParagraphText: vi.fn().mockReturnValue(true),
    });

    cleanups.push(mockSegmentGeometry(container.querySelector('[data-sd-segment-id="segment-1"]') as HTMLElement));
    session.attach();

    const block = container.querySelector<HTMLElement>('[data-block-id="block-1"]');
    block?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 5,
        clientY: 5,
      }),
    );

    expect(container.getAttribute('data-v2-fast-editing-ready')).toBeNull();
    expect(container.querySelector('.v2-fast-editing-session__layer')).toBeNull();

    session.setReady(true);
    block?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 5,
        clientY: 5,
      }),
    );

    expect(container.getAttribute('data-v2-fast-editing-ready')).toBe('true');
    expect(container.querySelector('.v2-fast-editing-session__layer')).not.toBeNull();

    session.destroy();
  });

  it('resyncs the controller immediately for protected inline paragraphs', async () => {
    const paragraph: V2EditableParagraph = {
      ...createParagraph(),
      text: 'Topic\t12',
      segments: [
        {
          segmentKind: 'text',
          isMutableText: true,
          runRef: { id: 'run-1' },
          runSourceRef: { partUri: '/word/document.xml', nodeId: 'run-node-1' },
          runIndex: 0,
          segmentIndex: 0,
          segmentId: 'segment-1',
          text: 'Topic',
          paragraphStart: 0,
          paragraphEnd: 5,
          runTextStart: 0,
          runTextEnd: 5,
        },
        {
          segmentKind: 'tab',
          isMutableText: false,
          runRef: { id: 'run-1' },
          runSourceRef: { partUri: '/word/document.xml', nodeId: 'run-node-1' },
          runIndex: 0,
          segmentIndex: 1,
          segmentId: 'segment-tab',
          text: '\t',
          paragraphStart: 5,
          paragraphEnd: 6,
          runTextStart: 5,
          runTextEnd: 5,
        },
        {
          segmentKind: 'text',
          isMutableText: true,
          runRef: { id: 'run-2' },
          runSourceRef: { partUri: '/word/document.xml', nodeId: 'run-node-2' },
          runIndex: 1,
          segmentIndex: 0,
          segmentId: 'segment-2',
          text: '12',
          paragraphStart: 6,
          paragraphEnd: 8,
          runTextStart: 0,
          runTextEnd: 2,
        },
      ],
    };

    const runtime = {
      applyOperation: vi.fn().mockResolvedValue({ ok: true }),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    } as unknown as DocumentRuntime;
    const controller = {
      initialize: vi.fn().mockResolvedValue(undefined),
    } as unknown as V2EditingController;

    const container = document.createElement('div');
    container.innerHTML = `
      <div data-block-id="block-1">
        <div class="superdoc-line">
          <span data-sd-segment-id="segment-1" data-sd-segment-start="0" data-sd-segment-end="5">Topic</span>
          <span data-sd-segment-id="segment-tab" data-sd-segment-start="5" data-sd-segment-end="6">\t</span>
          <span data-sd-segment-id="segment-2" data-sd-segment-start="6" data-sd-segment-end="8">12</span>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    const session = new V2FastEditingSession({
      container,
      controller,
      runtime,
      getSnapshot: () => createSnapshot(paragraph),
      patchParagraphText: vi.fn().mockReturnValue(true),
      refreshSnapshotFromController: vi.fn(),
    });

    cleanups.push(mockSegmentGeometry(container.querySelector('[data-sd-segment-id="segment-1"]') as HTMLElement));
    cleanups.push(
      mockSegmentGeometry(container.querySelector('[data-sd-segment-id="segment-tab"]') as HTMLElement, 60),
    );
    cleanups.push(mockSegmentGeometry(container.querySelector('[data-sd-segment-id="segment-2"]') as HTMLElement, 80));

    session.attach();
    session.setReady(true);

    container.querySelector<HTMLElement>('[data-block-id="block-1"]')?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 5,
        clientY: 5,
      }),
    );

    const layer = container.querySelector<HTMLElement>('.v2-fast-editing-session__layer');
    expect(layer).not.toBeNull();

    layer!.textContent = 'Topic\t123';
    layer!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.advanceTimersByTimeAsync(200);
    expect(runtime.applyOperation).toHaveBeenCalled();
    expect(runtime.save).toHaveBeenCalledTimes(1);
    expect(controller.initialize).toHaveBeenCalledTimes(1);

    session.destroy();
  });
});

function mockSegmentGeometry(segment: HTMLElement, left: number = 10): () => void {
  segment.getBoundingClientRect = () => new DOMRect(left, 10, 120, 20);
  const mutableDocument = document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const originalElementFromPoint = mutableDocument.elementFromPoint;
  const originalCaretPositionFromPoint = mutableDocument.caretPositionFromPoint;
  const originalCaretRangeFromPoint = mutableDocument.caretRangeFromPoint;
  mutableDocument.elementFromPoint = () => segment;
  mutableDocument.caretPositionFromPoint = () => null;
  mutableDocument.caretRangeFromPoint = () => null;

  const textNode = segment.firstChild as Text;
  const originalGetClientRects = Range.prototype.getClientRects;
  const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;

  Range.prototype.getClientRects = function getClientRects(): DOMRectList {
    if (this.startContainer !== textNode || this.endContainer !== textNode || this.endOffset !== this.startOffset + 1) {
      return [] as unknown as DOMRectList;
    }

    const rect = new DOMRect(left + this.startOffset * 10, 10, 10, 20);
    return [rect] as unknown as DOMRectList;
  };

  Range.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    const rects = Array.from(this.getClientRects());
    return rects[0] ?? new DOMRect(0, 0, 0, 0);
  };

  return () => {
    Range.prototype.getClientRects = originalGetClientRects;
    Range.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalElementFromPoint) {
      mutableDocument.elementFromPoint = originalElementFromPoint;
    } else {
      delete mutableDocument.elementFromPoint;
    }
    if (originalCaretPositionFromPoint) {
      mutableDocument.caretPositionFromPoint = originalCaretPositionFromPoint;
    } else {
      delete mutableDocument.caretPositionFromPoint;
    }
    if (originalCaretRangeFromPoint) {
      mutableDocument.caretRangeFromPoint = originalCaretRangeFromPoint;
    } else {
      delete mutableDocument.caretRangeFromPoint;
    }
  };
}
