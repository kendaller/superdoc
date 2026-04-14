import { DATA_ATTRS } from '@superdoc/dom-contract';
import { EMPTY_EDITABLE_TEXT_PLACEHOLDER } from './V2EditableDocumentSnapshot.js';

export function patchRenderedParagraphDraftText(blockElement: HTMLElement, text: string): boolean {
  const segmentElements = Array.from(blockElement.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.SD_SEGMENT_ID}]`));
  if (segmentElements.length === 0) {
    return false;
  }

  const preservedSliceLengths = segmentElements.map((element) => {
    const start = parseNumericAttribute(element.getAttribute(DATA_ATTRS.SD_SEGMENT_START));
    const end = parseNumericAttribute(element.getAttribute(DATA_ATTRS.SD_SEGMENT_END));
    if (start != null && end != null && end >= start) {
      return end - start;
    }

    return normalizeRenderedLength(element.textContent ?? '');
  });

  if (text.length === 0) {
    applyEmptyParagraphPatch(segmentElements);
    return true;
  }

  let offset = 0;
  segmentElements.forEach((element, index) => {
    const isLast = index === segmentElements.length - 1;
    const preservedLength = Math.max(0, preservedSliceLengths[index] ?? 0);
    const nextLength = isLast ? text.length - offset : Math.min(preservedLength, text.length - offset);
    const normalizedLength = Math.max(0, nextLength);
    const nextText = text.slice(offset, offset + normalizedLength);

    element.textContent = nextText;
    element.setAttribute(DATA_ATTRS.SD_SEGMENT_START, String(offset));
    element.setAttribute(DATA_ATTRS.SD_SEGMENT_END, String(offset + nextText.length));
    offset += nextText.length;
  });

  if (offset < text.length) {
    const lastElement = segmentElements[segmentElements.length - 1];
    const nextText = text.slice(parseNumericAttribute(lastElement.getAttribute(DATA_ATTRS.SD_SEGMENT_START)) ?? 0);
    const nextStart = text.length - nextText.length;
    lastElement.textContent = nextText;
    lastElement.setAttribute(DATA_ATTRS.SD_SEGMENT_START, String(nextStart));
    lastElement.setAttribute(DATA_ATTRS.SD_SEGMENT_END, String(text.length));
  }

  return true;
}

function applyEmptyParagraphPatch(segmentElements: readonly HTMLElement[]): void {
  segmentElements.forEach((element, index) => {
    element.textContent = index === 0 ? EMPTY_EDITABLE_TEXT_PLACEHOLDER : '';
    element.setAttribute(DATA_ATTRS.SD_SEGMENT_START, '0');
    element.setAttribute(DATA_ATTRS.SD_SEGMENT_END, '0');
  });
}

function parseNumericAttribute(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRenderedLength(text: string): number {
  return text === EMPTY_EDITABLE_TEXT_PLACEHOLDER ? 0 : text.length;
}
