import type { SourceRef } from '@superdoc/v2-model';
import type {
  V2EditableDocumentSnapshot,
  V2EditableParagraph,
  V2EditableTextSegment,
} from './V2EditableDocumentSnapshot.js';
import type {
  V2PendingSelection,
  V2ResolvedSelection,
  V2ResolvedTextPosition,
  V2SelectionBounds,
} from './V2EditingTypes.js';

type Affinity = 'backward' | 'forward';

export class V2EditableIndex {
  readonly #snapshot: V2EditableDocumentSnapshot;
  readonly #paragraphsByPathSourceKey = new Map<string, V2EditableParagraph>();
  readonly #paragraphsByExactSourceKey = new Map<string, V2EditableParagraph>();
  readonly #paragraphsByLooseSourceKey = new Map<string, V2EditableParagraph>();

  constructor(snapshot: V2EditableDocumentSnapshot) {
    this.#snapshot = snapshot;
    snapshot.orderedParagraphs.forEach((paragraph) => {
      if (paragraph.paragraphSourceRef.sourceNodePath) {
        this.#paragraphsByPathSourceKey.set(toPathSourceKey(paragraph.paragraphSourceRef), paragraph);
      }
      this.#paragraphsByExactSourceKey.set(toExactSourceKey(paragraph.paragraphSourceRef), paragraph);
      this.#paragraphsByLooseSourceKey.set(toLooseSourceKey(paragraph.paragraphSourceRef), paragraph);
    });
  }

  get snapshot(): V2EditableDocumentSnapshot {
    return this.#snapshot;
  }

  paragraphByBlockId(blockId: string): V2EditableParagraph | undefined {
    return this.#snapshot.paragraphsByBlockId.get(blockId);
  }

  paragraphBySourceRef(sourceRef: SourceRef): V2EditableParagraph | undefined {
    return (
      (sourceRef.sourceNodePath ? this.#paragraphsByPathSourceKey.get(toPathSourceKey(sourceRef)) : undefined) ??
      this.#paragraphsByExactSourceKey.get(toExactSourceKey(sourceRef)) ??
      this.#paragraphsByLooseSourceKey.get(toLooseSourceKey(sourceRef))
    );
  }

  previousParagraph(paragraph: V2EditableParagraph): V2EditableParagraph | undefined {
    const index = this.#snapshot.orderedParagraphs.findIndex((candidate) => candidate.blockId === paragraph.blockId);
    if (index <= 0) {
      return undefined;
    }

    return this.#snapshot.orderedParagraphs[index - 1];
  }

  nextParagraph(paragraph: V2EditableParagraph): V2EditableParagraph | undefined {
    const index = this.#snapshot.orderedParagraphs.findIndex((candidate) => candidate.blockId === paragraph.blockId);
    if (index === -1 || index >= this.#snapshot.orderedParagraphs.length - 1) {
      return undefined;
    }

    return this.#snapshot.orderedParagraphs[index + 1];
  }

  resolveBySourceRef(
    sourceRef: SourceRef,
    offset: number,
    affinity: Affinity = 'forward',
  ): V2ResolvedTextPosition | null {
    const paragraph = this.paragraphBySourceRef(sourceRef);
    if (!paragraph) {
      return null;
    }

    return this.resolveParagraphOffset(paragraph, offset, affinity);
  }

  resolveParagraphOffset(
    paragraph: V2EditableParagraph,
    offset: number,
    affinity: Affinity = 'forward',
  ): V2ResolvedTextPosition | null {
    if (!paragraph.supported || paragraph.segments.length === 0) {
      return null;
    }

    const paragraphOffset = clampOffset(offset, paragraph.text.length);
    const segment = this.#resolveSegment(paragraph, paragraphOffset, affinity);
    if (!segment) {
      return null;
    }

    const offsetInSegment = clampOffset(paragraphOffset - segment.paragraphStart, segment.text.length);
    const order = this.#snapshot.orderedParagraphs.findIndex((candidate) => candidate.blockId === paragraph.blockId);

    return {
      blockId: paragraph.blockId,
      order,
      storyId: paragraph.storyId,
      paragraphRef: paragraph.paragraphRef,
      paragraphSourceRef: paragraph.paragraphSourceRef,
      paragraphOffset,
      paragraphLength: paragraph.text.length,
      runRef: segment.runRef,
      runSourceRef: segment.runSourceRef,
      runIndex: segment.runIndex,
      segmentIndex: segment.segmentIndex,
      segmentId: segment.segmentId,
      segmentStart: segment.paragraphStart,
      segmentEnd: segment.paragraphEnd,
      runTextStart: segment.runTextStart,
      runTextEnd: segment.runTextEnd,
      offsetInSegment,
      offsetInRun: segment.runTextStart + offsetInSegment,
    };
  }

  moveByCharacter(position: V2ResolvedTextPosition, delta: -1 | 1): V2ResolvedTextPosition | null {
    if (delta === -1) {
      if (position.paragraphOffset > 0) {
        return this.resolveBySourceRef(position.paragraphSourceRef, position.paragraphOffset - 1, 'backward');
      }

      const paragraph = this.paragraphBySourceRef(position.paragraphSourceRef);
      if (!paragraph) {
        return null;
      }

      const previousParagraph = this.previousParagraph(paragraph);
      if (!previousParagraph || !previousParagraph.supported) {
        return this.resolveBySourceRef(position.paragraphSourceRef, 0, 'forward');
      }

      return this.resolveBySourceRef(previousParagraph.paragraphSourceRef, previousParagraph.text.length, 'backward');
    }

    if (position.paragraphOffset < position.paragraphLength) {
      return this.resolveBySourceRef(position.paragraphSourceRef, position.paragraphOffset + 1, 'forward');
    }

    const paragraph = this.paragraphBySourceRef(position.paragraphSourceRef);
    if (!paragraph) {
      return null;
    }

    const nextParagraph = this.nextParagraph(paragraph);
    if (!nextParagraph || !nextParagraph.supported) {
      return this.resolveBySourceRef(position.paragraphSourceRef, position.paragraphLength, 'backward');
    }

    return this.resolveBySourceRef(nextParagraph.paragraphSourceRef, 0, 'forward');
  }

  comparePositions(left: V2ResolvedTextPosition, right: V2ResolvedTextPosition): number {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.paragraphOffset - right.paragraphOffset;
  }

  normalizeSelection(selection: V2ResolvedSelection): V2SelectionBounds | null {
    if (selection.kind === 'none') {
      return null;
    }

    if (this.comparePositions(selection.anchor, selection.focus) <= 0) {
      return {
        start: selection.anchor,
        end: selection.focus,
        isBackward: false,
      };
    }

    return {
      start: selection.focus,
      end: selection.anchor,
      isBackward: true,
    };
  }

  restorePendingSelection(pending: V2PendingSelection): V2ResolvedSelection | null {
    if (pending.kind === 'caret') {
      const position = this.resolveBySourceRef(pending.paragraphSourceRef, pending.paragraphOffset, 'forward');
      if (!position) {
        return null;
      }

      return {
        kind: 'caret',
        anchor: position,
        focus: position,
      };
    }

    const anchor = this.resolveBySourceRef(pending.anchorParagraphSourceRef, pending.anchorOffset, 'forward');
    const focus = this.resolveBySourceRef(pending.focusParagraphSourceRef, pending.focusOffset, 'forward');
    if (!anchor || !focus) {
      return null;
    }

    if (anchor.paragraphOffset === focus.paragraphOffset && anchor.blockId === focus.blockId) {
      return {
        kind: 'caret',
        anchor,
        focus,
      };
    }

    return {
      kind: 'range',
      anchor,
      focus,
    };
  }

  #resolveSegment(
    paragraph: V2EditableParagraph,
    offset: number,
    affinity: Affinity,
  ): V2EditableTextSegment | undefined {
    if (offset <= 0) {
      return paragraph.segments[0];
    }

    const lastSegment = paragraph.segments[paragraph.segments.length - 1];
    if (offset >= paragraph.text.length) {
      return lastSegment;
    }

    for (let index = 0; index < paragraph.segments.length; index += 1) {
      const segment = paragraph.segments[index];
      if (offset < segment.paragraphEnd) {
        return segment;
      }

      if (offset === segment.paragraphEnd) {
        if (affinity === 'backward' || index === paragraph.segments.length - 1) {
          return segment;
        }

        return paragraph.segments[index + 1];
      }
    }

    return lastSegment;
  }
}

function toLooseSourceKey(sourceRef: SourceRef): string {
  return `${sourceRef.partUri}::${sourceRef.nodeId}`;
}

function toPathSourceKey(sourceRef: SourceRef): string {
  return `${sourceRef.partUri}::${sourceRef.sourceNodePath}`;
}

function toExactSourceKey(sourceRef: SourceRef): string {
  if (!sourceRef.sourceNodePath) {
    return toLooseSourceKey(sourceRef);
  }

  return `${toPathSourceKey(sourceRef)}::${sourceRef.nodeId}`;
}

function clampOffset(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return max;
  }

  return Math.max(0, Math.min(Math.trunc(value), max));
}
