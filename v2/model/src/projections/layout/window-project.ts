// ---------------------------------------------------------------------------
// Windowed projection entry point
//
// Projects a bounded window of body children from a RenderShellDocument
// to layout-compatible FlowBlock[] without requiring a full semantic model.
//
// This is the fast-first-paint path. It operates directly on the render-shell
// surface, extracting raw properties from hydrated XML nodes and projecting
// them through the same projection logic used by the full semantic model path.
// ---------------------------------------------------------------------------

import type { RenderShellDocument, SectionShell } from '../../render-shell/render-shell-document.js';
import type { BodyChildDescriptor } from '../../word/document-view.js';
import type { StyleResolver } from '../../resolve/style-resolver.js';
import type { FlowBlock, ProjectionStats, SectionBreakBlock, WindowSpec, WindowedProjectionResult } from './types.js';
import type { ProjectionFeeder } from './feeder.js';
import type { DependencyCollector } from './dependency-manifest.js';
import { createStableIdAllocator, type StableIdAllocator } from './stable-id.js';
import { createDependencyCollector } from './dependency-manifest.js';
import {
  createRenderShellFeeder,
  bodyChildToFeederNode,
  sectionElementToFeederNode,
  stashFieldRegions,
} from './render-shell-feeder.js';
import { projectParagraphFromFeeder } from './paragraph-projector.js';
import { projectTableFromFeeder } from './table-projector.js';
import { projectSectionFromFeeder } from './section-projector.js';
import { createPageEstimateLimiter, type LayoutPageGeometry } from './page-estimate.js';
import { classifyParagraphFieldRegions } from './paragraph-classifier.js';
import { computePathFromRoot } from '../../graph/source-path.js';
import { findChildElement, getAttr } from '../../word/tree-helpers.js';
import { twipsToLayoutPx } from './measurement-conversions.js';

export type WindowProjectOptions = {
  /** Style resolver for cascaded properties. Optional. */
  resolver?: StyleResolver;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
};

/**
 * Project a window of body children from a RenderShellDocument to FlowBlocks.
 *
 * Does NOT require SemanticModel or Entity objects.
 *
 * @param renderShell - The render-shell document (available after `ready("render-shell")`)
 * @param windowSpec - What range of body children to project
 * @param options - Optional resolver and abort signal
 * @returns A WindowedProjectionResult with blocks, continuation, trace map, section metadata, and optional dependency manifest
 */
export function projectWindowToFlowBlocks(
  renderShell: RenderShellDocument,
  windowSpec: WindowSpec,
  options?: WindowProjectOptions,
): WindowedProjectionResult {
  const ids = createStableIdAllocator();
  const deps = windowSpec.includeDependencyManifest ? createDependencyCollector() : undefined;
  const primaryGeometry = toLayoutPageGeometry(renderShell.primaryPageGeometry());
  const pageLimiter = createPageEstimateLimiter(windowSpec.stopAfterPageEstimate, primaryGeometry);

  const partUri = renderShell.partUri();
  const feeder = createRenderShellFeeder(partUri, (_sourcePartUri, relId) =>
    renderShell.resolveRelationshipTarget(relId),
  );

  // Get the body-child window from the render-shell
  const descriptors = renderShell.bodyChildWindow(windowSpec.startBodyChildIndex, windowSpec.maxBodyChildCount);

  const blocks: FlowBlock[] = [];
  const sectionBreaks: SectionBreakBlock[] = [];
  const stats: ProjectionStats = {
    fieldHeavyParagraphs: 0,
    plainParagraphs: 0,
    complexParagraphs: 0,
    runsSkipped: 0,
  };
  let lastProjectedIndex = windowSpec.startBodyChildIndex - 1;

  for (const desc of descriptors) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const blockCountBeforeProjection = blocks.length;
    projectBodyChild(
      desc,
      partUri,
      feeder,
      ids,
      blocks,
      sectionBreaks,
      renderShell.bodyChildPath(desc.index),
      options?.resolver,
      deps,
      stats,
    );
    lastProjectedIndex = desc.index;

    pageLimiter.observeBlocks(blocks.slice(blockCountBeforeProjection));
    if (pageLimiter.hasReachedLimit()) {
      break;
    }
  }

  // Build result
  const totalCount = renderShell.bodyChildCount();

  return {
    blocks,
    continuation: {
      nextBodyChildIndex: lastProjectedIndex + 1,
      hasMore: lastProjectedIndex + 1 < totalCount,
      totalBodyChildCount: totalCount,
    },
    blockToSourceRef: ids.blockToSourceRef,
    sectionMetadata: {
      sectionBreaks,
      ...(primaryGeometry ? { primaryPageGeometry: primaryGeometry } : {}),
    },
    ...(deps ? { dependencyManifest: deps.finalize() } : {}),
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

// ---- Body child dispatch ----------------------------------------------------

function projectBodyChild(
  desc: BodyChildDescriptor,
  partUri: string,
  feeder: ProjectionFeeder,
  ids: StableIdAllocator,
  blocks: FlowBlock[],
  sectionBreaks: SectionBreakBlock[],
  bodyChildPath: string | undefined,
  resolver?: StyleResolver,
  deps?: DependencyCollector,
  stats?: ProjectionStats,
): void {
  const el = desc.element;

  switch (desc.localName) {
    case 'p': {
      const node = bodyChildToFeederNode(el, partUri, bodyChildPath);
      if (!node || node.kind !== 'paragraph') break;

      // Classify paragraph field regions for the display-first fast path.
      // Stashing the result lets the feeder skip instruction-region runs.
      const fieldRegions = classifyParagraphFieldRegions(el);
      switch (fieldRegions.complexity) {
        case 'field-display':
          stashFieldRegions(node, fieldRegions);
          if (stats) {
            stats.fieldHeavyParagraphs++;
            stats.runsSkipped += fieldRegions.instructionRunIds.size;
          }
          break;
        case 'plain':
          if (stats) {
            stats.plainParagraphs++;
          }
          break;
        case 'complex':
          if (stats) {
            stats.complexParagraphs++;
          }
          break;
      }

      blocks.push(projectParagraphFromFeeder(node, feeder, ids, resolver, deps));

      // Check for inline sectPr in this paragraph
      const raw = node.raw();
      if (raw.hasSectPr) {
        const shell = resolveSectionShell(desc);
        if (shell) {
          const sectionNode = sectionElementToFeederNode(
            shell.sectPr,
            partUri,
            bodyChildPath ? computePathFromRoot(el, bodyChildPath, shell.sectPr) : undefined,
          );
          const sectionBlock = projectSectionFromFeeder(sectionNode, ids);
          blocks.push(sectionBlock);
          sectionBreaks.push(sectionBlock);
          collectSectionDeps(shell, deps);
        }
      }
      break;
    }

    case 'tbl': {
      const node = bodyChildToFeederNode(el, partUri, bodyChildPath);
      if (!node || node.kind !== 'table') break;

      blocks.push(projectTableFromFeeder(node, feeder, ids, resolver, deps));
      break;
    }

    case 'sdt': {
      // Content control is transparent: recurse into sdtContent children
      const sdtContent = findChildElement(el, 'sdtContent', 'w');
      if (!sdtContent) break;

      for (const child of sdtContent.children) {
        if (child.kind !== 'element') continue;

        // Create synthetic BodyChildDescriptor for the inner element
        const innerDesc: BodyChildDescriptor = {
          index: desc.index,
          kind: child.kind,
          localName: child.localName,
          element: child,
        };
        projectBodyChild(
          innerDesc,
          partUri,
          feeder,
          ids,
          blocks,
          sectionBreaks,
          bodyChildPath ? computePathFromRoot(el, bodyChildPath, child) : undefined,
          resolver,
          deps,
          stats,
        );
      }
      break;
    }

    case 'sectPr': {
      // Standalone body-level section (the document's final section)
      const sectionNode = sectionElementToFeederNode(el, partUri, bodyChildPath);
      const sectionBlock = projectSectionFromFeeder(sectionNode, ids);
      blocks.push(sectionBlock);
      sectionBreaks.push(sectionBlock);

      const shell = resolveSectionShell(desc);
      if (shell) {
        collectSectionDeps(shell, deps);
      }
      break;
    }

    // preservedBlock, drawing, etc. — no layout representation yet
    default:
      break;
  }
}

// ---- Section dependency collection ------------------------------------------

function resolveSectionShell(desc: BodyChildDescriptor): SectionShell | undefined {
  const sectPr = findSectionElement(desc.element);
  if (!sectPr) {
    return undefined;
  }

  const headerRefs: string[] = [];
  const footerRefs: string[] = [];

  for (const child of sectPr.children) {
    if (child.kind !== 'element') {
      continue;
    }

    if (child.localName === 'headerReference' && child.prefix === 'w') {
      const relationshipId = getAttr(child, 'id', 'r');
      if (typeof relationshipId === 'string' && relationshipId.length > 0) {
        headerRefs.push(relationshipId);
      }
    }

    if (child.localName === 'footerReference' && child.prefix === 'w') {
      const relationshipId = getAttr(child, 'id', 'r');
      if (typeof relationshipId === 'string' && relationshipId.length > 0) {
        footerRefs.push(relationshipId);
      }
    }
  }

  return {
    index: desc.index,
    sectPr,
    pageGeometry: {
      width: parseTwipsAttr(sectPr, 'pgSz', 'w', 'w', 12240),
      height: parseTwipsAttr(sectPr, 'pgSz', 'h', 'w', 15840),
      margins: {
        top: parseTwipsAttr(sectPr, 'pgMar', 'top', 'w', 1440),
        right: parseTwipsAttr(sectPr, 'pgMar', 'right', 'w', 1440),
        bottom: parseTwipsAttr(sectPr, 'pgMar', 'bottom', 'w', 1440),
        left: parseTwipsAttr(sectPr, 'pgMar', 'left', 'w', 1440),
      },
    },
    headerRefs,
    footerRefs,
  };
}

function findSectionElement(
  bodyChildElement: BodyChildDescriptor['element'],
): BodyChildDescriptor['element'] | undefined {
  if (bodyChildElement.localName === 'sectPr' && bodyChildElement.prefix === 'w') {
    return bodyChildElement;
  }

  if (bodyChildElement.localName !== 'p' || bodyChildElement.prefix !== 'w') {
    return undefined;
  }

  const pPr = findChildElement(bodyChildElement, 'pPr', 'w');
  return pPr ? findChildElement(pPr, 'sectPr', 'w') : undefined;
}

function parseTwipsAttr(
  sectPr: BodyChildDescriptor['element'],
  childLocalName: string,
  attrName: string,
  attrPrefix: string,
  fallback: number,
): number {
  const child = findChildElement(sectPr, childLocalName, 'w');
  if (!child) {
    return fallback;
  }

  const rawValue = getAttr(child, attrName, attrPrefix);
  const parsed = typeof rawValue === 'string' ? Number.parseInt(rawValue, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectSectionDeps(shell: SectionShell, deps?: DependencyCollector): void {
  if (!deps) return;

  for (const ref of shell.headerRefs) {
    deps.addHeaderFooter(ref, 'header');
  }
  for (const ref of shell.footerRefs) {
    deps.addHeaderFooter(ref, 'footer');
  }
}
