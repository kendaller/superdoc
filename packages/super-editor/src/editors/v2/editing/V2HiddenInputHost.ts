import { createHiddenHost, type HiddenHostElements } from '../../v1/core/presentation-editor/dom/HiddenHost.js';

const SENTINEL_TEXT = '\u200B';

export class V2HiddenInputHost {
  readonly #elements: HiddenHostElements;
  readonly #input: HTMLDivElement;

  constructor(doc: Document, widthPx: number) {
    this.#elements = createHiddenHost(doc, widthPx);
    this.#input = doc.createElement('div');
    this.#input.className = 'v2-hidden-input-host';
    this.#input.setAttribute('contenteditable', 'true');
    this.#input.setAttribute('role', 'textbox');
    this.#input.setAttribute('aria-multiline', 'true');
    this.#input.style.whiteSpace = 'pre-wrap';
    this.#input.style.outline = 'none';
    this.#input.style.minHeight = '1px';
    this.#input.style.caretColor = 'transparent';
    this.#resetBuffer();

    this.#elements.host.appendChild(this.#input);
    doc.body.appendChild(this.#elements.wrapper);
  }

  get element(): HTMLDivElement {
    return this.#input;
  }

  focus(): void {
    this.#input.focus({ preventScroll: true });
    this.#placeCaretAtEnd();
  }

  reset(): void {
    this.#resetBuffer();
    this.#placeCaretAtEnd();
  }

  destroy(): void {
    this.#elements.wrapper.remove();
  }

  #resetBuffer(): void {
    this.#input.textContent = SENTINEL_TEXT;
  }

  #placeCaretAtEnd(): void {
    const selection = this.#input.ownerDocument.defaultView?.getSelection();
    if (!selection) {
      return;
    }

    const textNode = this.#input.firstChild;
    if (!textNode) {
      return;
    }

    const range = this.#input.ownerDocument.createRange();
    range.setStart(textNode, textNode.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
