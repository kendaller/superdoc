// ---------------------------------------------------------------------------
// Document-API integration adapter — Phase 6
//
// Translates document-api operation calls (keyed by their canonical
// operation key, e.g. "paragraph.insertText") into semantic operations
// understood by the v2 model's operation compiler.
//
// This adapter is the bridge between the v1 document-api contract
// (operation-definitions.ts) and the v2 semantic operation vocabulary
// (operations/types.ts). It allows the v2 model to serve as a drop-in
// backend for the existing document-api surface without requiring
// consumers to change their calling code.
//
// Design choices:
//   - Returns undefined for unsupported operations (not errors).
//     The caller decides how to handle unsupported ops (e.g. fall back
//     to the PM-backed adapter).
//   - Operation IDs are generated from a monotonic counter, scoped to
//     the adapter instance lifetime. They are session-local and not
//     suitable for cross-session deduplication.
//   - The adapter is stateless beyond the counter — it does not cache
//     model queries or track applied operations.
// ---------------------------------------------------------------------------

import type { SemanticModel } from '../model.js';
import type { SemanticOperation } from './types.js';
import type { EntityKind } from '../entities/types.js';
import type { EntityRef, SourceRef } from '../identity/types.js';
import { sourceRefsEqual } from '../identity/types.js';

/**
 * Adapter that translates document-api-style operation calls into
 * semantic operations.
 *
 * Only the initial set of semantic operations is wired. Remaining
 * document-api operations return `undefined` (not yet supported by
 * the v2 backend).
 */
export class DocumentApiAdapter {
  private _nextId = 1;

  readonly model: SemanticModel;

  constructor(model: SemanticModel) {
    this.model = model;
  }

  /**
   * Translate a document-api operation into a semantic operation.
   * Returns `undefined` if the operation is not yet supported.
   */
  translate(operationKey: string, args: Record<string, unknown>): SemanticOperation | undefined {
    switch (operationKey) {
      case 'paragraph.insertText':
        return this.translateInsertText(args);
      case 'paragraph.setStyle':
        return this.translateSetParagraphStyle(args);
      case 'paragraph.split':
        return this.translateSplitParagraph(args);
      case 'paragraph.merge':
        return this.translateMergeParagraphs(args);
      case 'paragraph.insert':
        return this.translateInsertParagraph(args);
      case 'run.toggleBold':
        return this.translateToggleBold(args);
      default:
        return undefined;
    }
  }

  /** List of document-api operation keys supported by this adapter. */
  supportedOperations(): string[] {
    return [
      'paragraph.insertText',
      'paragraph.setStyle',
      'paragraph.split',
      'paragraph.merge',
      'paragraph.insert',
      'run.toggleBold',
    ];
  }

  // ---- Translate methods (private) ------------------------------------------

  private translateInsertText(args: Record<string, unknown>): SemanticOperation | undefined {
    const target = resolveRunTargetRef(this.model, args);
    if (!target) return undefined;

    const text = args.text;
    if (typeof text !== 'string') return undefined;

    const deleteLength = args.deleteLength;
    if (deleteLength !== undefined && typeof deleteLength !== 'number') return undefined;

    return {
      id: this.nextOpId(),
      label: 'Insert text',
      kind: 'insertText',
      target,
      text,
      ...(typeof deleteLength === 'number' && { deleteLength }),
      ...(hasInlinePosition(args) && {
        position: {
          segmentIndex: args.segmentIndex as number,
          charOffset: args.charOffset as number,
        },
      }),
    };
  }

  private translateSetParagraphStyle(args: Record<string, unknown>): SemanticOperation | undefined {
    const target = resolveStructuralTargetRef(this.model, args, 'targetRef', 'targetSourceRef', 'paragraph');
    if (!target) return undefined;

    const styleId = args.styleId;
    if (typeof styleId !== 'string') return undefined;

    return {
      id: this.nextOpId(),
      label: 'Set paragraph style',
      kind: 'setParagraphStyle',
      target,
      styleId,
    };
  }

  private translateSplitParagraph(args: Record<string, unknown>): SemanticOperation | undefined {
    const target = resolveStructuralTargetRef(this.model, args, 'targetRef', 'targetSourceRef', 'paragraph');
    if (!target) return undefined;

    const runIndex = args.runIndex;
    const charOffset = args.charOffset;
    if (typeof runIndex !== 'number' || typeof charOffset !== 'number') return undefined;

    return {
      id: this.nextOpId(),
      label: 'Split paragraph',
      kind: 'splitParagraph',
      target,
      at: { runIndex, charOffset },
    };
  }

  private translateMergeParagraphs(args: Record<string, unknown>): SemanticOperation | undefined {
    const first = resolveStructuralTargetRef(this.model, args, 'firstRef', 'firstSourceRef', 'paragraph');
    const second = resolveStructuralTargetRef(this.model, args, 'secondRef', 'secondSourceRef', 'paragraph');
    if (!first || !second) return undefined;

    return {
      id: this.nextOpId(),
      label: 'Merge paragraphs',
      kind: 'mergeParagraphs',
      first,
      second,
    };
  }

  private translateInsertParagraph(args: Record<string, unknown>): SemanticOperation | undefined {
    const relativeTo = resolveStructuralTargetRef(
      this.model,
      args,
      'relativeToRef',
      'relativeToSourceRef',
      'paragraph',
    );
    if (!relativeTo) return undefined;

    const position = args.position;
    if (position !== 'before' && position !== 'after') return undefined;

    return {
      id: this.nextOpId(),
      label: 'Insert paragraph',
      kind: 'insertParagraph',
      position,
      relativeTo,
      ...(typeof args.styleId === 'string' && { styleId: args.styleId }),
    };
  }

  private translateToggleBold(args: Record<string, unknown>): SemanticOperation | undefined {
    const target = resolveRunTargetRef(this.model, args);
    if (!target) return undefined;

    const value = args.value;
    if (typeof value !== 'boolean') return undefined;

    return {
      id: this.nextOpId(),
      label: 'Toggle bold',
      kind: 'toggleBold',
      target,
      value,
    };
  }

  // ---- ID generation --------------------------------------------------------

  private nextOpId(): string {
    return `doc-api:${this._nextId++}`;
  }
}

// ---- Argument helpers -------------------------------------------------------

function resolveRunTargetRef(model: SemanticModel, args: Record<string, unknown>): EntityRef | undefined {
  const direct = resolveEntityRef(args, 'targetRef');
  if (direct) {
    return direct;
  }

  const paragraphSourceRef = resolveSourceRef(args, 'paragraphSourceRef');
  const targetSourceRef = resolveSourceRef(args, 'targetSourceRef');

  if (paragraphSourceRef && targetSourceRef) {
    const paragraph = model.entityBySourceRef(paragraphSourceRef);
    if (!paragraph || paragraph.kind !== 'paragraph') {
      return undefined;
    }

    const run = model
      .runs(paragraph.ref)
      .find((candidate) => candidate.sourceRefs.some((sourceRef) => sourceRefsEqual(sourceRef, targetSourceRef)));

    return run?.ref;
  }

  if (targetSourceRef) {
    const entity = model.entityBySourceRef(targetSourceRef);
    return entity?.kind === 'run' ? entity.ref : undefined;
  }

  return undefined;
}

function resolveStructuralTargetRef<K extends EntityKind>(
  model: SemanticModel,
  args: Record<string, unknown>,
  entityKey: string,
  sourceKey: string,
  expectedKind: K,
): EntityRef | undefined {
  const direct = resolveEntityRef(args, entityKey);
  if (direct) {
    return direct;
  }

  const sourceRef = resolveSourceRef(args, sourceKey);
  if (!sourceRef) {
    return undefined;
  }

  const entity = model.entityBySourceRef(sourceRef);
  return entity?.kind === expectedKind ? entity.ref : undefined;
}

/**
 * Extract an EntityRef from args by key.
 * Accepts either a string (treated as the id) or an object with an `id` field.
 */
function resolveEntityRef(args: Record<string, unknown>, key: string): EntityRef | undefined {
  const raw = args[key];

  if (typeof raw === 'string') {
    return { id: raw };
  }

  if (raw !== null && typeof raw === 'object' && 'id' in raw) {
    const id = (raw as Record<string, unknown>).id;
    if (typeof id === 'string') {
      return { id };
    }
  }

  return undefined;
}

function resolveSourceRef(args: Record<string, unknown>, key: string): SourceRef | undefined {
  const raw = args[key];
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const { partUri, nodeId, sourceNodePath } = raw as Record<string, unknown>;
  if (typeof partUri !== 'string' || typeof nodeId !== 'string') {
    return undefined;
  }

  if (sourceNodePath !== undefined && typeof sourceNodePath !== 'string') {
    return undefined;
  }

  return sourceNodePath !== undefined ? { partUri, nodeId, sourceNodePath } : { partUri, nodeId };
}

/** Check whether args contain an inline position (segmentIndex + charOffset). */
function hasInlinePosition(args: Record<string, unknown>): boolean {
  return typeof args.segmentIndex === 'number' && typeof args.charOffset === 'number';
}
