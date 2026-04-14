/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceRef } from '@superdoc/v2-model';
import { V2EditingSession } from './V2EditingSession.js';
import { V2EditingDomContext } from './V2EditingDom.js';
import type { V2EditableDocumentSnapshot, V2EditableParagraph } from './V2EditableDocumentSnapshot.js';
import { DATA_ATTRS } from '@superdoc/dom-contract';

type MutableParagraphState = {
  text: string;
};

describe('V2EditingSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('keeps accepting local paragraph input while a commit is already in flight', async () => {
    const paragraphSourceRef: SourceRef = {
      partUri: '/word/document.xml',
      nodeId: 'paragraph-node-1',
    };
    const runSourceRef: SourceRef = {
      partUri: '/word/document.xml',
      nodeId: 'run-node-1',
    };
    const paragraphState: MutableParagraphState = {
      text: 'Hello world',
    };
    let snapshotText = paragraphState.text;

    const container = document.createElement('div');
    container.innerHTML = `
      <div ${DATA_ATTRS.BLOCK_ID}="block-1">
        <div class="superdoc-line">
          <span
            ${DATA_ATTRS.SD_RUN_REF}="run-1"
            ${DATA_ATTRS.SD_SEGMENT_ID}="segment-1"
            ${DATA_ATTRS.SD_SEGMENT_START}="0"
            ${DATA_ATTRS.SD_SEGMENT_END}="${snapshotText.length}"
          >${snapshotText}</span>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    const getSnapshot = (): V2EditableDocumentSnapshot =>
      createSnapshot(snapshotText, paragraphSourceRef, runSourceRef);
    const initialPosition = getSnapshot().orderedParagraphs[0]
      ? {
          blockId: 'block-1',
          order: 0,
          storyId: 'story-1',
          paragraphRef: { id: 'paragraph-1' },
          paragraphSourceRef,
          paragraphOffset: 5,
          paragraphLength: snapshotText.length,
          runRef: { id: 'run-1' },
          runSourceRef,
          runIndex: 0,
          segmentIndex: 0,
          segmentId: 'segment-1',
          segmentStart: 0,
          segmentEnd: snapshotText.length,
          runTextStart: 0,
          runTextEnd: snapshotText.length,
          offsetInSegment: 5,
          offsetInRun: 5,
        }
      : null;

    vi.spyOn(V2EditingDomContext.prototype, 'resolveTextPositionFromClientPoint').mockReturnValue(initialPosition);
    vi.spyOn(V2EditingDomContext.prototype, 'computeCaretRect').mockReturnValue(new DOMRect(10, 10, 1, 18));
    vi.spyOn(V2EditingDomContext.prototype, 'computeRangeRects').mockReturnValue([new DOMRect(10, 10, 20, 18)]);

    let resolveFirstOperation: (() => void) | null = null;
    let applyOperationCount = 0;
    const controller = createMutableController(paragraphState, paragraphSourceRef, runSourceRef, (operation) => {
      applyOperationCount += 1;
      if (applyOperationCount === 1) {
        return new Promise((resolve) => {
          resolveFirstOperation = () => {
            applyInsertTextOperation(paragraphState, operation);
            resolve({ ok: true });
          };
        });
      }

      applyInsertTextOperation(paragraphState, operation);
      return Promise.resolve({ ok: true });
    });

    const patchParagraphText = vi.fn((blockId: string, text: string) => {
      if (blockId !== 'block-1') {
        return false;
      }

      snapshotText = text;
      return true;
    });
    const commitParagraphText = vi.fn((blockId: string, sourceRef: SourceRef) => {
      if (blockId !== 'block-1' || sourceRef.nodeId !== paragraphSourceRef.nodeId) {
        return false;
      }

      snapshotText = paragraphState.text;
      return true;
    });
    const refreshView = vi.fn();

    const session = new V2EditingSession({
      container,
      controller,
      getSnapshot,
      patchParagraphText,
      commitParagraphText,
      refreshView,
    });

    session.attach();
    session.setReady(true);

    container.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 40,
        clientY: 12,
      }),
    );

    const inputHost = document.querySelector<HTMLElement>('.v2-hidden-input-host');
    expect(inputHost).not.toBeNull();

    dispatchBeforeInput(inputHost!, 'insertText', 'A');
    expect(blockText(container)).toBe('HelloA world');

    await vi.advanceTimersByTimeAsync(80);
    expect(applyOperationCount).toBe(1);

    dispatchBeforeInput(inputHost!, 'insertText', 'B');
    expect(blockText(container)).toBe('HelloAB world');
    expect(patchParagraphText).toHaveBeenNthCalledWith(1, 'block-1', 'HelloA world');
    expect(patchParagraphText).toHaveBeenNthCalledWith(2, 'block-1', 'HelloAB world');

    await vi.advanceTimersByTimeAsync(80);
    expect(applyOperationCount).toBe(1);

    expect(resolveFirstOperation).not.toBeNull();
    resolveFirstOperation?.();
    await vi.runAllTimersAsync();

    expect(applyOperationCount).toBe(2);
    expect(paragraphState.text).toBe('HelloAB world');
    expect(snapshotText).toBe('HelloAB world');
    expect(commitParagraphText).toHaveBeenCalledTimes(2);
    expect(refreshView).not.toHaveBeenCalled();

    session.destroy();
  });
});

function createSnapshot(
  text: string,
  paragraphSourceRef: SourceRef,
  runSourceRef: SourceRef,
): V2EditableDocumentSnapshot {
  const paragraph = createParagraph(text, paragraphSourceRef, runSourceRef);
  return {
    blockToEntityRef: new Map([[paragraph.blockId, paragraph.paragraphRef]]),
    paragraphsByBlockId: new Map([[paragraph.blockId, paragraph]]),
    orderedParagraphs: [paragraph],
  };
}

function createParagraph(text: string, paragraphSourceRef: SourceRef, runSourceRef: SourceRef): V2EditableParagraph {
  return {
    blockId: 'block-1',
    storyId: 'story-1',
    paragraphRef: { id: 'paragraph-1' },
    paragraphSourceRef,
    text,
    supported: true,
    segments: [
      {
        segmentKind: 'text',
        isMutableText: true,
        runRef: { id: 'run-1' },
        runSourceRef,
        runIndex: 0,
        segmentIndex: 0,
        segmentId: 'segment-1',
        text,
        paragraphStart: 0,
        paragraphEnd: text.length,
        runTextStart: 0,
        runTextEnd: text.length,
      },
    ],
  };
}

function createMutableController(
  paragraphState: MutableParagraphState,
  paragraphSourceRef: SourceRef,
  runSourceRef: SourceRef,
  applyOperationImpl: (operation: {
    kind: string;
    text?: string;
    deleteLength?: number;
    position?: { charOffset: number };
  }) => Promise<{ ok: true }>,
) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    applyOperation: vi.fn((operation) => applyOperationImpl(operation)),
    undo: vi.fn(),
    redo: vi.fn(),
    semanticModel: {
      entityBySourceRef: vi.fn((sourceRef: SourceRef) => {
        if (sourceRef.nodeId === paragraphSourceRef.nodeId) {
          return {
            kind: 'paragraph',
            ref: { id: 'paragraph-1' },
            sourceRefs: [paragraphSourceRef],
            storyId: 'story-1',
          };
        }

        if (sourceRef.nodeId === runSourceRef.nodeId) {
          return {
            kind: 'run',
            ref: { id: 'run-1' },
            sourceRefs: [runSourceRef],
          };
        }

        return null;
      }),
      entity: vi.fn((ref: { id: string }) => {
        if (ref.id === 'paragraph-1') {
          return {
            kind: 'paragraph',
            ref: { id: 'paragraph-1' },
            sourceRefs: [paragraphSourceRef],
            storyId: 'story-1',
          };
        }

        if (ref.id === 'run-1') {
          return {
            kind: 'run',
            ref: { id: 'run-1' },
            sourceRefs: [runSourceRef],
          };
        }

        return null;
      }),
      runs: vi.fn(() => [
        {
          kind: 'run',
          ref: { id: 'run-1' },
          sourceRefs: [runSourceRef],
        },
      ]),
      segments: vi.fn(() => [
        {
          segmentKind: 'text',
          localId: 'segment-1',
          text: paragraphState.text,
        },
      ]),
    },
    runtime: {
      semanticModel: {
        entityBySourceRef: vi.fn(),
      },
    },
  };
}

function applyInsertTextOperation(
  paragraphState: MutableParagraphState,
  operation: {
    kind: string;
    text?: string;
    deleteLength?: number;
    position?: { charOffset: number };
  },
): void {
  if (operation.kind !== 'insertText') {
    throw new Error(`Unexpected operation kind: ${operation.kind}`);
  }

  const currentText = paragraphState.text;
  const insertOffset = operation.position?.charOffset ?? 0;
  const deleteLength = operation.deleteLength ?? 0;
  const insertedText = operation.text ?? '';
  paragraphState.text =
    currentText.slice(0, insertOffset) + insertedText + currentText.slice(insertOffset + deleteLength);
}

function dispatchBeforeInput(inputHost: HTMLElement, inputType: string, data: string): void {
  inputHost.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType,
      data,
    }),
  );
}

function blockText(container: HTMLElement): string {
  return container.querySelector<HTMLElement>(`[${DATA_ATTRS.BLOCK_ID}="block-1"]`)?.textContent?.trim() ?? '';
}
