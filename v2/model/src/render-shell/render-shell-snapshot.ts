// ---------------------------------------------------------------------------
// Render-shell snapshot — serializable worker/runtime transport shape
//
// RenderShellDocument is a method-based read surface. It is useful on the
// same thread as the PackageSession, but it cannot cross the worker boundary
// directly. This module defines a plain-data snapshot that can be returned by
// worker and in-process runtimes consistently.
// ---------------------------------------------------------------------------

import type { PageGeometry, RenderShellDocument } from './render-shell-document.js';

export type RenderShellSectionSnapshot = {
  index: number;
  pageGeometry: PageGeometry;
  headerRefs: string[];
  footerRefs: string[];
};

export type RenderShellSnapshot = {
  bodyChildCount: number;
  sections: RenderShellSectionSnapshot[];
  primaryPageGeometry?: PageGeometry;
  availableShells: {
    styles: boolean;
    numbering: boolean;
    settings: boolean;
  };
};

export function createRenderShellSnapshot(
  renderShell: RenderShellDocument | undefined,
): RenderShellSnapshot | undefined {
  if (!renderShell) {
    return undefined;
  }

  const sections = renderShell.sectionShells().map((section) => ({
    index: section.index,
    pageGeometry: cloneRequiredPageGeometry(section.pageGeometry),
    headerRefs: [...section.headerRefs],
    footerRefs: [...section.footerRefs],
  }));

  return {
    bodyChildCount: renderShell.bodyChildCount(),
    sections,
    primaryPageGeometry: clonePageGeometry(renderShell.primaryPageGeometry()),
    availableShells: {
      styles: renderShell.styleShell() !== undefined,
      numbering: renderShell.numberingShell() !== undefined,
      settings: renderShell.settingsShell() !== undefined,
    },
  };
}

function clonePageGeometry(pageGeometry: PageGeometry | undefined): PageGeometry | undefined {
  if (!pageGeometry) {
    return undefined;
  }

  return {
    width: pageGeometry.width,
    height: pageGeometry.height,
    margins: {
      top: pageGeometry.margins.top,
      right: pageGeometry.margins.right,
      bottom: pageGeometry.margins.bottom,
      left: pageGeometry.margins.left,
    },
  };
}

function cloneRequiredPageGeometry(pageGeometry: PageGeometry): PageGeometry {
  return clonePageGeometry(pageGeometry)!;
}
