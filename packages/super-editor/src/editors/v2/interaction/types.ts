// ---------------------------------------------------------------------------
// V2 Interaction Types
//
// Shared type definitions for the native v2 interaction contract.
// These types are the canonical shapes for block targeting, inline
// targeting, position hits, and selection geometry.
// ---------------------------------------------------------------------------

import type { EntityRef, StoryPosition, StoryRange } from '@superdoc/v2-model';

// ---- Block targeting --------------------------------------------------------

/** Editable content category for a rendered block. */
export type EditableKind = 'paragraph' | 'table' | 'image' | 'other';

/** Result of resolving a clicked/hovered block from the DOM. */
export type V2BlockTarget = {
  readonly blockId: string;
  readonly entityRef: EntityRef;
  readonly rect?: DOMRect;
  readonly pageIndex?: number;
  readonly editableKind: EditableKind;
};

// ---- Inline targeting (Phase 2B) --------------------------------------------

/** Inline segment target within a run. */
export type V2SegmentTarget = {
  readonly segmentId: string;
  readonly charOffset: number;
};

/** Result of resolving a pointer hit to a native v2 position. */
export type V2PositionHit = {
  readonly kind: 'v2';
  readonly blockId: string;
  readonly entityRef?: EntityRef;
  readonly storyPosition?: StoryPosition;
  readonly segmentTarget?: V2SegmentTarget;
  readonly geometry: {
    readonly pageIndex: number;
    readonly x: number;
    readonly y: number;
  };
};

// ---- Selection geometry (Phase 2C) ------------------------------------------

/** Request for computing selection rectangles. */
export type V2SelectionRectsRequest =
  | { readonly kind: 'block'; readonly blockId: string }
  | { readonly kind: 'entity'; readonly entityRef: EntityRef }
  | { readonly kind: 'storyRange'; readonly range: StoryRange };

/** Native v2 selection state. */
export type V2SelectionState =
  | { readonly kind: 'collapsed'; readonly position: StoryPosition }
  | { readonly kind: 'range'; readonly range: StoryRange }
  | { readonly kind: 'block'; readonly blockId: string; readonly entityRef: EntityRef }
  | { readonly kind: 'none' };
