import { describe, expect, it, vi } from 'vitest';
import type { RenderShellDocument } from '../src/render-shell/render-shell-document.js';
import type { PreviewParagraphRecord } from '../src/render-shell/preview-types.js';
import { projectPreviewWindowToFlowBlocks } from '../src/projections/layout/preview-window-project.js';

describe('projectPreviewWindowToFlowBlocks', () => {
  it('parses preview body children lazily and stops once the page estimate is satisfied', () => {
    const previewParagraph = createPreviewParagraph(10, 'Preview line '.repeat(600));
    const bodyChildPreview = vi.fn((index: number) => {
      if (index !== 10) {
        throw new Error(`Preview parser should not have been asked for body child ${index}`);
      }
      return previewParagraph;
    });

    const renderShell = {
      bodyChildCount: () => 50,
      bodyChildPreview,
      primaryPageGeometry: () => undefined,
    } as Pick<RenderShellDocument, 'bodyChildCount' | 'bodyChildPreview' | 'primaryPageGeometry'> as RenderShellDocument;

    const result = projectPreviewWindowToFlowBlocks(renderShell, {
      startBodyChildIndex: 10,
      maxBodyChildCount: 50,
      stopAfterPageEstimate: 1,
    });

    expect(result.blocks).toHaveLength(1);
    expect(result.continuation.nextBodyChildIndex).toBe(11);
    expect(bodyChildPreview).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning the initial window until it contains useful in-flow content', () => {
    const previewRecords = new Map<number, PreviewParagraphRecord>();
    previewRecords.set(0, createPreviewParagraph(0, '', { visibleTextOutsideDrawingLength: 0 }));
    previewRecords.set(
      1,
      createPreviewParagraph(1, 'Decorative title '.repeat(80), {
        containsDrawing: true,
        visibleTextOutsideDrawingLength: 0,
      }),
    );
    previewRecords.set(2, createPreviewParagraph(2, '', { visibleTextOutsideDrawingLength: 0 }));
    previewRecords.set(3, createPreviewParagraph(3, 'TABLE OF CONTENTS', { visibleTextOutsideDrawingLength: 15 }));

    for (let index = 4; index < 14; index++) {
      previewRecords.set(
        index,
        createPreviewParagraph(index, `${index - 3}.\tPreview entry\t42${index}`, {
          classification: 'toc-display',
          visibleTextOutsideDrawingLength: 18,
        }),
      );
    }

    const bodyChildPreview = vi.fn((index: number) => {
      const record = previewRecords.get(index);
      if (!record) {
        throw new Error(`Missing preview record for body child ${index}`);
      }
      return record;
    });

    const renderShell = {
      bodyChildCount: () => 20,
      bodyChildPreview,
      primaryPageGeometry: () => undefined,
    } as Pick<RenderShellDocument, 'bodyChildCount' | 'bodyChildPreview' | 'primaryPageGeometry'> as RenderShellDocument;

    const result = projectPreviewWindowToFlowBlocks(renderShell, {
      startBodyChildIndex: 0,
      maxBodyChildCount: 20,
      stopAfterPageEstimate: 1,
    });

    expect(result.continuation.nextBodyChildIndex).toBe(13);
    expect(bodyChildPreview).toHaveBeenCalledTimes(13);
  });
});

function createPreviewParagraph(
  index: number,
  text: string,
  overrides: Partial<Pick<PreviewParagraphRecord, 'classification' | 'containsDrawing' | 'visibleTextOutsideDrawingLength'>> = {},
): PreviewParagraphRecord {
  return {
    kind: 'paragraph',
    index,
    partUri: '/word/document.xml',
    localName: 'p',
    bodyChildPath: 'w:body/w:p[1]',
    sourceSpan: {
      startByte: 0,
      endByte: text.length,
    },
    raw: {
      paraId: undefined,
      styleId: undefined,
      spacing: undefined,
      alignment: undefined,
      numPr: undefined,
      indentation: undefined,
      keepNext: false,
      keepLines: false,
      pageBreakBefore: false,
      outlineLevel: undefined,
      borders: undefined,
      tabs: undefined,
      bidi: false,
      hasSectPr: false,
      suppressAutoHyphens: false,
      contextualSpacing: false,
      markRunProperties: undefined,
    },
    runs: [
      {
        raw: {
          formatting: {},
          segments: [
            {
              segmentKind: 'text',
              localId: 'preview-text-1',
              text,
              preserveSpace: false,
            },
          ],
        },
      },
    ],
    classification: overrides.classification ?? 'plain',
    containsDrawing: overrides.containsDrawing ?? false,
    visibleTextOutsideDrawingLength:
      overrides.visibleTextOutsideDrawingLength ?? text.replace(/\s+/g, '').length,
  };
}
