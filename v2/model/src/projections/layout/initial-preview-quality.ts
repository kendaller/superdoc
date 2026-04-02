import type { PreviewBodyChildRecord } from '../../render-shell/preview-types.js';

const MIN_USEFUL_PARAGRAPHS = 6;
const MIN_USEFUL_TEXT_CHARACTERS = 160;
const MIN_USEFUL_TEXT_LENGTH = 8;
const MIN_TOC_PARAGRAPHS = 10;

/**
 * Quality gate for the opening preview window.
 *
 * The first visible render should not stop after decorative cover/title
 * content alone. This gate keeps the opening preview window scanning until it
 * includes enough useful in-flow text, even after the rough page estimate has
 * already been satisfied.
 */
export class InitialPreviewQualityGate {
  #enabled: boolean;
  #usefulParagraphs = 0;
  #usefulTextCharacters = 0;
  #tocParagraphs = 0;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  observe(record: PreviewBodyChildRecord): void {
    if (!this.#enabled || record.kind !== 'paragraph') {
      return;
    }

    if (record.classification === 'toc-display') {
      this.#tocParagraphs += 1;
    }

    if (record.containsDrawing) {
      return;
    }

    if (record.visibleTextOutsideDrawingLength >= MIN_USEFUL_TEXT_LENGTH) {
      this.#usefulParagraphs += 1;
      this.#usefulTextCharacters += record.visibleTextOutsideDrawingLength;
    }
  }

  isSatisfied(): boolean {
    if (!this.#enabled) {
      return true;
    }

    if (this.#tocParagraphs >= MIN_TOC_PARAGRAPHS) {
      return true;
    }

    return (
      this.#usefulParagraphs >= MIN_USEFUL_PARAGRAPHS &&
      this.#usefulTextCharacters >= MIN_USEFUL_TEXT_CHARACTERS
    );
  }
}

export function shouldUseInitialPreviewQualityGate(startBodyChildIndex: number): boolean {
  return startBodyChildIndex === 0;
}
