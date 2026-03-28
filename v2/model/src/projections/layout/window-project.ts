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
import type { FlowBlock, SectionBreakBlock, WindowSpec, WindowedProjectionResult } from './types.js';
import type { ProjectionFeeder } from './feeder.js';
import type { DependencyCollector } from './dependency-manifest.js';
import { createStableIdAllocator, type StableIdAllocator } from './stable-id.js';
import { createDependencyCollector } from './dependency-manifest.js';
import { createRenderShellFeeder, bodyChildToFeederNode, sectionElementToFeederNode } from './render-shell-feeder.js';
import { projectParagraphFromFeeder } from './paragraph-projector.js';
import { projectTableFromFeeder } from './table-projector.js';
import { projectSectionFromFeeder } from './section-projector.js';
import { createPageEstimateLimiter, type LayoutPageGeometry } from './page-estimate.js';
import { computePathFromRoot, qualifiedName } from '../../graph/source-path.js';
import { findChildElement } from '../../word/tree-helpers.js';
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
  const bodyChildPathByIndex = buildBodyChildPathMap(renderShell, descriptors.at(-1)?.index);

  // Build section shell lookup by body-child index
  const sectionShells = renderShell.sectionShells();
  const sectionByIndex = new Map<number, SectionShell>();
  for (const shell of sectionShells) {
    sectionByIndex.set(shell.index, shell);
  }

  const blocks: FlowBlock[] = [];
  const sectionBreaks: SectionBreakBlock[] = [];
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
      sectionByIndex,
      bodyChildPathByIndex.get(desc.index),
      options?.resolver,
      deps,
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
  sectionByIndex: Map<number, SectionShell>,
  bodyChildPath: string | undefined,
  resolver?: StyleResolver,
  deps?: DependencyCollector,
): void {
  const el = desc.element;

  switch (desc.localName) {
    case 'p': {
      const node = bodyChildToFeederNode(el, partUri, bodyChildPath);
      if (!node || node.kind !== 'paragraph') break;

      blocks.push(projectParagraphFromFeeder(node, feeder, ids, resolver, deps));

      // Check for inline sectPr in this paragraph
      const raw = node.raw();
      if (raw.hasSectPr) {
        const shell = sectionByIndex.get(desc.index);
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
          sectionByIndex,
          bodyChildPath ? computePathFromRoot(el, bodyChildPath, child) : undefined,
          resolver,
          deps,
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

      const shell = sectionByIndex.get(desc.index);
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

function collectSectionDeps(shell: SectionShell, deps?: DependencyCollector): void {
  if (!deps) return;

  for (const ref of shell.headerRefs) {
    deps.addHeaderFooter(ref, 'header');
  }
  for (const ref of shell.footerRefs) {
    deps.addHeaderFooter(ref, 'footer');
  }
}

function buildBodyChildPathMap(
  renderShell: RenderShellDocument,
  lastIndexInWindow: number | undefined,
): Map<number, string> {
  if (lastIndexInWindow === undefined || lastIndexInWindow < 0) {
    return new Map<number, string>();
  }

  const bodyChildren = renderShell.bodyChildWindow(0, lastIndexInWindow + 1);
  const siblingCountByQualifiedName = new Map<string, number>();
  const pathByIndex = new Map<number, string>();

  for (const bodyChild of bodyChildren) {
    const qname = qualifiedName(bodyChild.element);
    const nextSiblingIndex = (siblingCountByQualifiedName.get(qname) ?? 0) + 1;
    siblingCountByQualifiedName.set(qname, nextSiblingIndex);
    pathByIndex.set(bodyChild.index, `w:body/${qname}[${nextSiblingIndex}]`);
  }

  return pathByIndex;
}
