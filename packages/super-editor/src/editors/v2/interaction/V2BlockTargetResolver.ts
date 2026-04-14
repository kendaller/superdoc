// ---------------------------------------------------------------------------
// V2 Block Target Resolver
//
// Resolves clicked/hovered DOM elements into typed block targets.
// Uses data-block-id from DomPainter and blockToEntityRef from the
// latest projection to join rendered DOM back to semantic entities.
//
// This resolver is the canonical activation path for Phase 3's
// overlay editing MVP. It does not depend on PM positions.
// ---------------------------------------------------------------------------

import { DATASET_KEYS } from '@superdoc/dom-contract';
import type { EntityRef, SemanticModel } from '@superdoc/v2-model';
import type { V2BlockTarget, EditableKind } from './types.js';

// ---- Resolver ---------------------------------------------------------------

/**
 * Resolve block targets from DOM events without PM positions.
 *
 * Usage:
 * ```ts
 * const resolver = new V2BlockTargetResolver(model, blockToEntityRef);
 * element.addEventListener('click', (e) => {
 *   const target = resolver.resolveFromEvent(e);
 *   if (target) activateOverlayEditor(target);
 * });
 * ```
 */
export class V2BlockTargetResolver {
  readonly #model: SemanticModel;
  #blockToEntityRef: ReadonlyMap<string, EntityRef>;

  constructor(model: SemanticModel, blockToEntityRef: ReadonlyMap<string, EntityRef>) {
    this.#model = model;
    this.#blockToEntityRef = blockToEntityRef;
  }

  /** Update the projection maps after a rerender. */
  updateProjection(blockToEntityRef: ReadonlyMap<string, EntityRef>): void {
    this.#blockToEntityRef = blockToEntityRef;
  }

  /** Resolve a block target from a mouse/pointer event. */
  resolveFromEvent(event: MouseEvent | PointerEvent): V2BlockTarget | null {
    const element = event.target;
    if (!(element instanceof HTMLElement)) return null;
    return this.resolveFromElement(element);
  }

  /** Resolve a block target from a DOM element (walks up to find block boundary). */
  resolveFromElement(element: HTMLElement): V2BlockTarget | null {
    const blockElement = findBlockElement(element);
    if (!blockElement) return null;

    const blockId = blockElement.dataset[DATASET_KEYS.BLOCK_ID];
    if (!blockId) return null;

    return this.resolveFromBlockId(blockId, blockElement);
  }

  /** Resolve a block target directly from a known block ID. */
  resolveFromBlockId(blockId: string, blockElement?: HTMLElement): V2BlockTarget | null {
    const entityRef = this.#blockToEntityRef.get(blockId);
    if (!entityRef) return null;

    const entity = this.#model.entity(entityRef);
    if (!entity) return null;

    const editableKind = classifyEditableKind(entity.kind);

    return {
      blockId,
      entityRef,
      rect: blockElement?.getBoundingClientRect(),
      editableKind,
    };
  }
}

// ---- Helpers ----------------------------------------------------------------

/**
 * Walk up the DOM tree to find the nearest element with a data-block-id attribute.
 * Stops at reasonable depth to avoid walking the entire document.
 */
function findBlockElement(element: HTMLElement): HTMLElement | null {
  const MAX_DEPTH = 20;
  let current: HTMLElement | null = element;

  for (let i = 0; i < MAX_DEPTH && current; i++) {
    if (current.dataset[DATASET_KEYS.BLOCK_ID]) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

/** Classify an entity kind into an editable content category. */
function classifyEditableKind(entityKind: string): EditableKind {
  switch (entityKind) {
    case 'paragraph':
      return 'paragraph';
    case 'table':
      return 'table';
    case 'drawing':
      return 'image';
    default:
      return 'other';
  }
}
