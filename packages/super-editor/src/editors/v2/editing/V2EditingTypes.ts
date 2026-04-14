import type { EntityRef, SourceRef } from '@superdoc/v2-model';

export type V2ResolvedTextPosition = {
  readonly blockId: string;
  readonly order: number;
  readonly storyId: string;
  readonly paragraphRef: EntityRef;
  readonly paragraphSourceRef: SourceRef;
  readonly paragraphOffset: number;
  readonly paragraphLength: number;
  readonly runRef: EntityRef;
  readonly runSourceRef: SourceRef;
  readonly runIndex: number;
  readonly segmentIndex: number;
  readonly segmentId: string;
  readonly segmentStart: number;
  readonly segmentEnd: number;
  readonly runTextStart: number;
  readonly runTextEnd: number;
  readonly offsetInSegment: number;
  readonly offsetInRun: number;
};

export type V2ResolvedSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'caret'; readonly anchor: V2ResolvedTextPosition; readonly focus: V2ResolvedTextPosition }
  | { readonly kind: 'range'; readonly anchor: V2ResolvedTextPosition; readonly focus: V2ResolvedTextPosition };

export type V2SelectionBounds = {
  readonly start: V2ResolvedTextPosition;
  readonly end: V2ResolvedTextPosition;
  readonly isBackward: boolean;
};

export type V2PendingSelection =
  | { readonly kind: 'caret'; readonly paragraphSourceRef: SourceRef; readonly paragraphOffset: number }
  | {
      readonly kind: 'range';
      readonly anchorParagraphSourceRef: SourceRef;
      readonly anchorOffset: number;
      readonly focusParagraphSourceRef: SourceRef;
      readonly focusOffset: number;
    };
