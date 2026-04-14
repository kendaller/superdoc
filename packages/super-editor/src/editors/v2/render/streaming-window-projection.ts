import { StyleResolver, projectWindowToFlowBlocks } from '@superdoc/v2-model';
import type { DependencyManifest, DocumentHandle, SourceRef, WindowedProjectionResult } from '@superdoc/v2-model';
import type { FlowBlock } from '@superdoc/contracts';
import type { WindowRecord } from './streaming-host-types.js';

export type BlockSourceRef = {
  readonly partUri: string;
  readonly nodeId: string;
  readonly sourceNodePath?: string;
};

export type CanonicalProjectedWindow = {
  readonly windowRecord: WindowRecord;
  readonly blockToSourceRef: Map<string, BlockSourceRef>;
  readonly nextBodyChildIndex: number;
  readonly totalBodyChildCount: number;
  readonly dependencyManifest?: DependencyManifest;
  readonly projectionStats?: WindowedProjectionResult['projectionStats'];
};

type NormalizeProjectedWindowOptions = {
  readonly windowResult: WindowedProjectionResult;
  readonly startBodyChildIndex: number;
  readonly index: number;
  readonly projectionMode: 'preview' | 'exact';
};

type ProjectWindowFromHandleOptions = {
  readonly documentHandle: DocumentHandle;
  readonly startBodyChildIndex: number;
  readonly maxBodyChildCount: number;
  readonly index: number;
  readonly projectionMode?: 'preview' | 'exact';
  readonly stopAfterPageEstimate?: number;
  readonly includeDependencyManifest?: boolean;
};

export function normalizeProjectedWindow(options: NormalizeProjectedWindowOptions): CanonicalProjectedWindow {
  const { windowResult, startBodyChildIndex, index, projectionMode } = options;
  const blocks = toContractFlowBlocks(windowResult.blocks);
  const nextBodyChildIndex = windowResult.continuation.nextBodyChildIndex;
  const totalBodyChildCount = windowResult.continuation.totalBodyChildCount;
  const blockToSourceRef = new Map<string, BlockSourceRef>();

  for (const [blockId, sourceRef] of windowResult.blockToSourceRef) {
    blockToSourceRef.set(blockId, normalizeSourceRef(sourceRef));
  }

  return {
    windowRecord: {
      index,
      startBodyChildIndex,
      bodyChildCount: Math.max(0, nextBodyChildIndex - startBodyChildIndex),
      blockCount: blocks.length,
      blockIds: blocks.map((block) => block.id),
      blocks,
      sectionMetadataDelta: windowResult.sectionMetadata,
      projectionMode,
      ...(windowResult.dependencyManifest
        ? { dependencyManifest: cloneDependencyManifest(windowResult.dependencyManifest) }
        : {}),
      status: 'projected',
    },
    blockToSourceRef,
    nextBodyChildIndex,
    totalBodyChildCount,
    ...(windowResult.dependencyManifest
      ? { dependencyManifest: cloneDependencyManifest(windowResult.dependencyManifest) }
      : {}),
    ...(windowResult.projectionStats ? { projectionStats: windowResult.projectionStats } : {}),
  };
}

export function projectCanonicalWindowFromHandle(options: ProjectWindowFromHandleOptions): CanonicalProjectedWindow {
  const {
    documentHandle,
    startBodyChildIndex,
    maxBodyChildCount,
    index,
    projectionMode = 'exact',
    stopAfterPageEstimate,
    includeDependencyManifest,
  } = options;
  const renderShell = documentHandle.renderShell();
  if (!renderShell) {
    throw new Error('[streaming-window-projection] Document handle has no render shell');
  }

  const views = documentHandle.views();
  const resolver = new StyleResolver(views.styles?.rootElement(), views.numbering?.rootElement());
  const windowResult = projectWindowToFlowBlocks(
    renderShell,
    {
      startBodyChildIndex,
      maxBodyChildCount,
      ...(stopAfterPageEstimate != null ? { stopAfterPageEstimate } : {}),
      ...(includeDependencyManifest ? { includeDependencyManifest: true } : {}),
    },
    { resolver },
  );

  return normalizeProjectedWindow({
    windowResult,
    startBodyChildIndex,
    index,
    projectionMode,
  });
}

export function mergeProjectedWindowDependencyManifests(
  windowRecords: readonly Pick<WindowRecord, 'dependencyManifest'>[],
): DependencyManifest {
  const merged: DependencyManifest = {
    headerFooterRefs: [],
    footnoteRefs: [],
    endnoteRefs: [],
    commentRefs: [],
    imageRefs: [],
    hyperlinkRefs: [],
  };

  const headerFooterRefs = new Map<string, DependencyManifest['headerFooterRefs'][number]>();
  const footnoteRefs = new Map<string, DependencyManifest['footnoteRefs'][number]>();
  const endnoteRefs = new Map<string, DependencyManifest['endnoteRefs'][number]>();
  const commentRefs = new Map<string, DependencyManifest['commentRefs'][number]>();
  const imageRefs = new Map<string, DependencyManifest['imageRefs'][number]>();
  const hyperlinkRefs = new Map<string, DependencyManifest['hyperlinkRefs'][number]>();

  for (const record of windowRecords) {
    const manifest = record.dependencyManifest;
    if (!manifest) {
      continue;
    }

    for (const entry of manifest.headerFooterRefs) {
      headerFooterRefs.set(`${entry.type}:${entry.relationshipId}`, entry);
    }
    for (const entry of manifest.footnoteRefs) {
      footnoteRefs.set(entry.footnoteId, entry);
    }
    for (const entry of manifest.endnoteRefs) {
      endnoteRefs.set(entry.endnoteId, entry);
    }
    for (const entry of manifest.commentRefs) {
      commentRefs.set(entry.commentId, entry);
    }
    for (const entry of manifest.imageRefs) {
      imageRefs.set(`${entry.sourcePartUri}:${entry.relationshipId}`, entry);
    }
    for (const entry of manifest.hyperlinkRefs) {
      hyperlinkRefs.set(entry.relationshipId, entry);
    }
  }

  merged.headerFooterRefs = [...headerFooterRefs.values()];
  merged.footnoteRefs = [...footnoteRefs.values()];
  merged.endnoteRefs = [...endnoteRefs.values()];
  merged.commentRefs = [...commentRefs.values()];
  merged.imageRefs = [...imageRefs.values()];
  merged.hyperlinkRefs = [...hyperlinkRefs.values()];
  return merged;
}

export function cloneWindowRecord(record: WindowRecord): WindowRecord {
  return {
    ...record,
    blockIds: [...record.blockIds],
    blocks: [...record.blocks],
    sectionMetadataDelta: {
      ...record.sectionMetadataDelta,
      sectionBreaks: [...record.sectionMetadataDelta.sectionBreaks],
      ...(record.sectionMetadataDelta.primaryPageGeometry
        ? {
            primaryPageGeometry: {
              ...record.sectionMetadataDelta.primaryPageGeometry,
              margins: { ...record.sectionMetadataDelta.primaryPageGeometry.margins },
            },
          }
        : {}),
    },
    ...(record.dependencyManifest ? { dependencyManifest: cloneDependencyManifest(record.dependencyManifest) } : {}),
  };
}

export function normalizeSourceRef(sourceRef: SourceRef): BlockSourceRef {
  return {
    partUri: sourceRef.partUri,
    nodeId: sourceRef.nodeId,
    ...(sourceRef.sourceNodePath ? { sourceNodePath: sourceRef.sourceNodePath } : {}),
  };
}

export function cloneDependencyManifest(manifest: DependencyManifest): DependencyManifest {
  return {
    headerFooterRefs: [...manifest.headerFooterRefs],
    footnoteRefs: [...manifest.footnoteRefs],
    endnoteRefs: [...manifest.endnoteRefs],
    commentRefs: [...manifest.commentRefs],
    imageRefs: [...manifest.imageRefs],
    hyperlinkRefs: [...manifest.hyperlinkRefs],
  };
}

function toContractFlowBlocks(blocks: WindowedProjectionResult['blocks']): FlowBlock[] {
  return blocks as unknown as FlowBlock[];
}
