const CARET_CLASS_NAME = 'v2-native-selection-overlay__caret';
const RANGE_CLASS_NAME = 'v2-native-selection-overlay__range';

export class V2SelectionOverlay {
  readonly #layer: HTMLDivElement;

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.#layer = doc.createElement('div');
    this.#layer.className = 'v2-native-selection-overlay';
    this.#layer.style.position = 'absolute';
    this.#layer.style.inset = '0';
    this.#layer.style.pointerEvents = 'none';
    this.#layer.style.zIndex = '5';

    const computedPosition = container.style.position;
    if (!computedPosition) {
      container.style.position = 'relative';
    }

    container.appendChild(this.#layer);
  }

  clear(): void {
    this.#layer.replaceChildren();
  }

  renderCaret(rect: DOMRect): void {
    this.clear();

    const caret = this.#layer.ownerDocument.createElement('div');
    caret.className = CARET_CLASS_NAME;
    caret.style.position = 'absolute';
    caret.style.left = `${rect.left}px`;
    caret.style.top = `${rect.top}px`;
    caret.style.width = '2px';
    caret.style.height = `${Math.max(1, rect.height)}px`;
    caret.style.background = 'var(--sd-ui-text, #111827)';
    caret.style.borderRadius = '1px';
    caret.style.animation = 'v2-native-caret-blink 1.1s steps(1) infinite';

    this.#layer.appendChild(caret);
  }

  renderRange(rects: readonly DOMRect[]): void {
    this.clear();

    rects.forEach((rect) => {
      const highlight = this.#layer.ownerDocument.createElement('div');
      highlight.className = RANGE_CLASS_NAME;
      highlight.style.position = 'absolute';
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${Math.max(1, rect.width)}px`;
      highlight.style.height = `${Math.max(1, rect.height)}px`;
      highlight.style.background = 'rgba(51, 132, 255, 0.28)';
      highlight.style.borderRadius = '2px';
      this.#layer.appendChild(highlight);
    });
  }

  destroy(): void {
    this.#layer.remove();
  }
}

export function ensureV2SelectionOverlayStyles(doc: Document): void {
  if (doc.getElementById('v2-native-selection-overlay-styles')) {
    return;
  }

  const style = doc.createElement('style');
  style.id = 'v2-native-selection-overlay-styles';
  style.textContent = `
    @keyframes v2-native-caret-blink {
      0%, 45% { opacity: 1; }
      46%, 100% { opacity: 0; }
    }
  `;
  doc.head.appendChild(style);
}
