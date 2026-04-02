import type { ParagraphRawProperties, RunRawProperties } from '../entities/types.js';
import type { SourceSpan } from '../types/xml.js';

export type PreviewParagraphClassification = 'plain' | 'field-display' | 'toc-display';

export type PreviewRunRecord = {
  readonly raw: Pick<RunRawProperties, 'formatting' | 'segments'>;
};

export type PreviewParagraphRecord = {
  readonly kind: 'paragraph';
  readonly index: number;
  readonly partUri: string;
  readonly localName: 'p';
  readonly bodyChildPath?: string;
  readonly sourceSpan: SourceSpan;
  readonly raw: ParagraphRawProperties;
  readonly runs: readonly PreviewRunRecord[];
  readonly classification: PreviewParagraphClassification;
  /**
   * True when the paragraph contains any `w:drawing` content.
   *
   * This includes text-box-backed drawings. Preview first-paint selection uses
   * this to avoid treating decorative cover/title content as sufficient initial
   * content when the useful in-flow content starts later.
   */
  readonly containsDrawing: boolean;
  /**
   * Count of non-whitespace text characters that originate outside drawing
   * content. This is a cheap proxy for "meaningful in-flow text" when
   * selecting the initial preview window.
   */
  readonly visibleTextOutsideDrawingLength: number;
};

export type UnsupportedPreviewBodyChild = {
  readonly kind: 'unsupported';
  readonly index: number;
  readonly partUri: string;
  readonly localName: string;
  readonly bodyChildPath?: string;
  readonly sourceSpan: SourceSpan;
  readonly reason: string;
};

export type PreviewBodyChildRecord = PreviewParagraphRecord | UnsupportedPreviewBodyChild;
