import type { RenderShellDocument } from '../../render-shell/render-shell-document.js';
import type { StyleResolver } from '../../resolve/style-resolver.js';
import type { ProjectionStats, WindowSpec, WindowedProjectionResult } from './types.js';
import { createStableIdAllocator } from './stable-id.js';
import { createPageEstimateLimiter, type LayoutPageGeometry } from './page-estimate.js';
import { InitialPreviewQualityGate, shouldUseInitialPreviewQualityGate } from './initial-preview-quality.js';
import { twipsToLayoutPx } from './measurement-conversions.js';
import { projectPreviewParagraph } from './paragraph-projector.js';

export type PreviewProjectOptions = {
  resolver?: StyleResolver;
  signal?: AbortSignal;
};

export class PreviewWindowUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewWindowUnsupportedError';
  }
}

export function projectPreviewWindowToFlowBlocks(
  renderShell: RenderShellDocument,
  windowSpec: WindowSpec,
  options?: PreviewProjectOptions,
): WindowedProjectionResult {
  const ids = createStableIdAllocator();
  const primaryGeometry = toLayoutPageGeometry(renderShell.primaryPageGeometry());
  const pageLimiter = createPageEstimateLimiter(windowSpec.stopAfterPageEstimate, primaryGeometry);
  const qualityGate = new InitialPreviewQualityGate(shouldUseInitialPreviewQualityGate(windowSpec.startBodyChildIndex));
  const blocks: WindowedProjectionResult['blocks'] = [];
  const stats: ProjectionStats = {
    fieldHeavyParagraphs: 0,
    plainParagraphs: 0,
    complexParagraphs: 0,
    runsSkipped: 0,
    displayFastPathParagraphs: 0,
    tocDisplayParagraphs: 0,
    displayFastPathRuns: 0,
  };
  let lastProjectedIndex = windowSpec.startBodyChildIndex - 1;
  const totalCount = renderShell.bodyChildCount();
  const endIndex = Math.min(windowSpec.startBodyChildIndex + windowSpec.maxBodyChildCount, totalCount);

  for (let bodyChildIndex = windowSpec.startBodyChildIndex; bodyChildIndex < endIndex; bodyChildIndex++) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const record = renderShell.bodyChildPreview(bodyChildIndex);
    if (!record) {
      continue;
    }

    if (record.kind === 'unsupported') {
      throw new PreviewWindowUnsupportedError(
        `Preview projection does not support ${record.localName} at body child ${record.index}: ${record.reason}`,
      );
    }

    qualityGate.observe(record);

    const blockCountBeforeProjection = blocks.length;
    const paragraphBlock = projectPreviewParagraph(record, ids, options?.resolver);
    blocks.push(paragraphBlock);
    lastProjectedIndex = record.index;

    switch (record.classification) {
      case 'plain':
        stats.plainParagraphs += 1;
        break;
      case 'field-display':
        stats.fieldHeavyParagraphs += 1;
        stats.displayFastPathParagraphs += 1;
        stats.displayFastPathRuns += record.runs.length;
        break;
      case 'toc-display':
        stats.fieldHeavyParagraphs += 1;
        stats.displayFastPathParagraphs += 1;
        stats.tocDisplayParagraphs += 1;
        stats.displayFastPathRuns += record.runs.length;
        break;
    }

    pageLimiter.observeBlocks(blocks.slice(blockCountBeforeProjection));
    if (pageLimiter.hasReachedLimit() && qualityGate.isSatisfied()) {
      break;
    }
  }

  return {
    blocks,
    continuation: {
      nextBodyChildIndex: lastProjectedIndex + 1,
      hasMore: lastProjectedIndex + 1 < totalCount,
      totalBodyChildCount: totalCount,
    },
    blockToSourceRef: ids.blockToSourceRef,
    sectionMetadata: {
      sectionBreaks: [],
      ...(primaryGeometry ? { primaryPageGeometry: primaryGeometry } : {}),
    },
    projectionStats: stats,
  };
}

function toLayoutPageGeometry(
  geometry: ReturnType<RenderShellDocument['primaryPageGeometry']>,
): LayoutPageGeometry | undefined {
  if (!geometry) {
    return undefined;
  }

  return {
    width: twipsToLayoutPx(geometry.width),
    height: twipsToLayoutPx(geometry.height),
    margins: {
      top: twipsToLayoutPx(geometry.margins.top),
      right: twipsToLayoutPx(geometry.margins.right),
      bottom: twipsToLayoutPx(geometry.margins.bottom),
      left: twipsToLayoutPx(geometry.margins.left),
    },
  };
}
