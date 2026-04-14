import type { DependencyManifest, DocumentHandle, SourceRef } from '@superdoc/v2-model';
import type { FlowBlock } from '@superdoc/contracts';
import type { V2EditingMutationKind } from '../editing/V2EditingSession.js';
import type { V2PendingSelection } from '../editing/V2EditingTypes.js';
import type { WindowRecord } from './streaming-host-types.js';
import {
  cloneWindowRecord,
  mergeProjectedWindowDependencyManifests,
  normalizeSourceRef,
  projectCanonicalWindowFromHandle,
  type BlockSourceRef,
} from './streaming-window-projection.js';

type StructuralReprojectionOptions = {
  readonly documentHandle: DocumentHandle;
  readonly windowRecords: readonly WindowRecord[];
  readonly blockToSourceRef: ReadonlyMap<string, BlockSourceRef>;
  readonly totalBodyChildCount: number;
  readonly pendingSelection?: V2PendingSelection | null;
  readonly anchorParagraphSourceRef?: SourceRef | null;
  readonly mutationKind?: V2EditingMutationKind;
};

export type StructuralReprojectionResult = {
  readonly changed: boolean;
  readonly affectedWindowIndex: number;
  readonly reprojectedWindowCount: number;
  readonly blocks: FlowBlock[];
  readonly blockToSourceRef: Map<string, BlockSourceRef>;
  readonly windowRecords: WindowRecord[];
  readonly nextBodyChildIndex: number;
  readonly totalBodyChildCount: number;
  readonly dependencyManifest: DependencyManifest;
};

export function reprojectStructuralStreamingWindows(
  options: StructuralReprojectionOptions,
): StructuralReprojectionResult | null {
  if (!requiresStructuralReprojection(options.mutationKind)) {
    return null;
  }

  if (options.windowRecords.length === 0) {
    return null;
  }

  if (!options.documentHandle.renderShell()) {
    return null;
  }

  const affectedWindowIndex = findAffectedWindowIndex(options);
  const reprojectStartWindowIndex = Math.max(0, affectedWindowIndex - 1);
  const retainedWindowRecords = options.windowRecords.slice(0, reprojectStartWindowIndex).map(cloneWindowRecord);
  const retainedBlockIds = retainedWindowRecords.flatMap((record) => record.blockIds);
  const nextBlockToSourceRef = new Map<string, BlockSourceRef>();

  for (const blockId of retainedBlockIds) {
    const sourceRef = options.blockToSourceRef.get(blockId);
    if (sourceRef) {
      nextBlockToSourceRef.set(blockId, sourceRef);
    }
  }

  const nextWindowRecords = [...retainedWindowRecords];
  let nextStartBodyChildIndex = getRetainedTailBodyChildIndex(retainedWindowRecords);
  let nextTotalBodyChildCount = options.totalBodyChildCount;
  let reprojectedWindowCount = 0;

  for (
    let sourceWindowIndex = reprojectStartWindowIndex;
    sourceWindowIndex < options.windowRecords.length;
    sourceWindowIndex += 1
  ) {
    if (nextStartBodyChildIndex >= nextTotalBodyChildCount) {
      break;
    }

    const previousRecord = options.windowRecords[sourceWindowIndex];
    const projectedWindow = projectCanonicalWindowFromHandle({
      documentHandle: options.documentHandle,
      startBodyChildIndex: nextStartBodyChildIndex,
      maxBodyChildCount: Math.max(1, previousRecord.bodyChildCount),
      includeDependencyManifest: Boolean(previousRecord.dependencyManifest),
      index: nextWindowRecords.length,
      projectionMode: 'exact',
    });

    nextWindowRecords.push(projectedWindow.windowRecord);
    for (const [blockId, sourceRef] of projectedWindow.blockToSourceRef) {
      nextBlockToSourceRef.set(blockId, normalizeSourceRef(sourceRef));
    }

    nextStartBodyChildIndex = projectedWindow.nextBodyChildIndex;
    nextTotalBodyChildCount = projectedWindow.totalBodyChildCount;
    reprojectedWindowCount += 1;
  }

  const blocks = nextWindowRecords.flatMap((record) => record.blocks);
  return {
    changed: reprojectedWindowCount > 0,
    affectedWindowIndex: reprojectStartWindowIndex,
    reprojectedWindowCount,
    blocks,
    blockToSourceRef: nextBlockToSourceRef,
    windowRecords: nextWindowRecords,
    nextBodyChildIndex: nextStartBodyChildIndex,
    totalBodyChildCount: nextTotalBodyChildCount,
    dependencyManifest: mergeProjectedWindowDependencyManifests(nextWindowRecords),
  };
}

function requiresStructuralReprojection(mutationKind?: V2EditingMutationKind): boolean {
  return (
    mutationKind === 'splitSelection' ||
    mutationKind === 'deleteBackward' ||
    mutationKind === 'deleteForward' ||
    mutationKind === 'undo' ||
    mutationKind === 'redo'
  );
}

function findAffectedWindowIndex(options: StructuralReprojectionOptions): number {
  const candidateSourceRefs = collectCandidateSourceRefs(
    options.pendingSelection,
    options.anchorParagraphSourceRef ?? null,
  );
  if (candidateSourceRefs.length === 0) {
    return 0;
  }

  for (let windowIndex = 0; windowIndex < options.windowRecords.length; windowIndex += 1) {
    const record = options.windowRecords[windowIndex];
    for (const blockId of record.blockIds) {
      const sourceRef = options.blockToSourceRef.get(blockId);
      if (!sourceRef) {
        continue;
      }

      if (candidateSourceRefs.some((candidate) => sameSourceRef(sourceRef, candidate))) {
        return windowIndex;
      }
    }
  }

  return 0;
}

function collectCandidateSourceRefs(
  pendingSelection: V2PendingSelection | null | undefined,
  anchorParagraphSourceRef: SourceRef | null,
): SourceRef[] {
  const candidates: Array<SourceRef | null | undefined> = [];

  if (anchorParagraphSourceRef) {
    candidates.push(anchorParagraphSourceRef);
  }

  if (!pendingSelection) {
    return dedupeSourceRefs(candidates);
  }

  if (pendingSelection.kind === 'caret') {
    candidates.push(pendingSelection.paragraphSourceRef);
    return dedupeSourceRefs(candidates);
  }

  candidates.push(pendingSelection.anchorParagraphSourceRef, pendingSelection.focusParagraphSourceRef);
  return dedupeSourceRefs(candidates);
}

function dedupeSourceRefs(sourceRefs: readonly (SourceRef | null | undefined)[]): SourceRef[] {
  const deduped = new Map<string, SourceRef>();
  for (const sourceRef of sourceRefs) {
    if (!sourceRef) {
      continue;
    }

    deduped.set(toSourceKey(sourceRef), sourceRef);
  }

  return [...deduped.values()];
}

function sameSourceRef(left: BlockSourceRef, right: SourceRef): boolean {
  return (
    left.partUri === right.partUri &&
    left.nodeId === right.nodeId &&
    (left.sourceNodePath == null || right.sourceNodePath == null || left.sourceNodePath === right.sourceNodePath)
  );
}

function toSourceKey(sourceRef: SourceRef): string {
  return [sourceRef.partUri, sourceRef.nodeId, sourceRef.sourceNodePath ?? ''].join('::');
}

function getRetainedTailBodyChildIndex(windowRecords: readonly WindowRecord[]): number {
  const lastRecord = windowRecords[windowRecords.length - 1];
  if (!lastRecord) {
    return 0;
  }

  return lastRecord.startBodyChildIndex + lastRecord.bodyChildCount;
}
