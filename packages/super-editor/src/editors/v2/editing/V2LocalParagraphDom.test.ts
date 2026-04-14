import { describe, expect, it } from 'vitest';
import { patchRenderedParagraphDraftText } from './V2LocalParagraphDom.js';

describe('V2LocalParagraphDom', () => {
  it('patches wrapped segment spans sequentially without repainting the paragraph shell', () => {
    const blockElement = document.createElement('div');
    blockElement.innerHTML = `
      <span data-sd-segment-id="seg-1" data-sd-segment-start="0" data-sd-segment-end="4">Wrap</span>
      <span data-sd-segment-id="seg-1" data-sd-segment-start="4" data-sd-segment-end="8">ping</span>
    `;

    const patched = patchRenderedParagraphDraftText(blockElement, 'Wrapped');

    expect(patched).toBe(true);
    const spans = blockElement.querySelectorAll<HTMLElement>('[data-sd-segment-id]');
    expect(Array.from(spans).map((span) => span.textContent)).toEqual(['Wrap', 'ped']);
    expect(spans[1].getAttribute('data-sd-segment-start')).toBe('4');
    expect(spans[1].getAttribute('data-sd-segment-end')).toBe('7');
  });

  it('keeps an empty paragraph editable by preserving a placeholder span', () => {
    const blockElement = document.createElement('div');
    blockElement.innerHTML = `
      <span data-sd-segment-id="seg-1" data-sd-segment-start="0" data-sd-segment-end="1">\u200B</span>
    `;

    const patched = patchRenderedParagraphDraftText(blockElement, '');

    expect(patched).toBe(true);
    const span = blockElement.querySelector<HTMLElement>('[data-sd-segment-id]');
    expect(span?.textContent).toBe('\u200B');
    expect(span?.getAttribute('data-sd-segment-start')).toBe('0');
    expect(span?.getAttribute('data-sd-segment-end')).toBe('0');
  });
});
