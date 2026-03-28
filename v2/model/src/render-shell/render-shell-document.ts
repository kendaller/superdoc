// ---------------------------------------------------------------------------
// RenderShellDocument — critical-path read surface for fast first paint
//
// This is NOT a replacement for SemanticModel. It is a deliberately small
// contract providing only what the first visible window needs:
//   - body-child count and windowed access
//   - section shells with page geometry
//   - style, numbering, and settings shells
//
// Available after ready("render-shell"), before ready("structure").
// ---------------------------------------------------------------------------

import type { PackageSession } from '../types/session.js';
import type { XmlElementNode } from '../types/xml.js';
import type { DocumentView, BodyChildDescriptor } from '../word/document-view.js';
import type { StylesView } from '../word/styles-view.js';
import type { NumberingView } from '../word/numbering-view.js';
import type { SettingsView } from '../word/settings-view.js';
import { createDocumentView } from '../word/document-view.js';
import { createStylesView } from '../word/styles-view.js';
import { createNumberingView } from '../word/numbering-view.js';
import { createSettingsView } from '../word/settings-view.js';
import { getAttr } from '../word/tree-helpers.js';
import { resolveRelationshipTarget as resolveRelTargetFromOpc } from '../opc/relationships.js';

// ---- Public types -----------------------------------------------------------

export type PageGeometry = {
  /** Page width in twips. */
  width: number;
  /** Page height in twips. */
  height: number;
  /** Margins in twips. */
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export type SectionShell = {
  index: number;
  sectPr: XmlElementNode;
  pageGeometry: PageGeometry;
  headerRefs: string[];
  footerRefs: string[];
};

export type RenderShellDocument = {
  /** Total number of body children (no hydration needed). */
  bodyChildCount(): number;
  /** Get a window of body children by start index and count. */
  bodyChildWindow(start: number, count: number): BodyChildDescriptor[];
  /** Enumerate section shells with page geometry. */
  sectionShells(): SectionShell[];
  /** Get page geometry for the first (primary) section. */
  primaryPageGeometry(): PageGeometry | undefined;
  /** Style shell — read-only access to styles.xml. */
  styleShell(): StylesView | undefined;
  /** Numbering shell — read-only access to numbering.xml. */
  numberingShell(): NumberingView | undefined;
  /** Settings shell — read-only access to settings.xml. */
  settingsShell(): SettingsView | undefined;
  /** The main document part URI (e.g., "/word/document.xml"). */
  partUri(): string;
  /** Resolve a relationship ID on the main document part to a target URI. */
  resolveRelationshipTarget(relationshipId: string): string | undefined;
};

// ---- Factory ----------------------------------------------------------------

export function createRenderShellDocument(session: PackageSession): RenderShellDocument {
  // Lazily created and cached views — same pattern as DocumentHandle
  let cachedDocView: DocumentView | undefined;
  let cachedStylesView: StylesView | undefined;
  let cachedNumberingView: NumberingView | undefined;
  let cachedSettingsView: SettingsView | undefined;

  function docView(): DocumentView | undefined {
    if (!cachedDocView) {
      cachedDocView = createDocumentView(session, session.mainDocumentUri);
    }
    return cachedDocView;
  }

  return {
    bodyChildCount(): number {
      return docView()?.bodyChildCount() ?? 0;
    },

    bodyChildWindow(start: number, count: number): BodyChildDescriptor[] {
      const dv = docView();
      if (!dv) return [];

      const total = dv.bodyChildCount();
      const end = Math.min(start + count, total);
      const result: BodyChildDescriptor[] = [];

      for (let i = start; i < end; i++) {
        const desc = dv.bodyChild(i);
        if (desc) result.push(desc);
      }

      return result;
    },

    sectionShells(): SectionShell[] {
      const dv = docView();
      if (!dv) return [];

      return dv.sections().map((sec) => ({
        index: sec.index,
        sectPr: sec.sectPr,
        pageGeometry: extractPageGeometry(sec.sectPr),
        headerRefs: sec.headerRefs,
        footerRefs: sec.footerRefs,
      }));
    },

    primaryPageGeometry(): PageGeometry | undefined {
      const dv = docView();
      if (!dv) return undefined;

      const sections = dv.sections();
      if (sections.length === 0) return undefined;

      // The last sectPr in the document body is the "primary" (document-level) section.
      // In OOXML, section breaks in the body define earlier sections;
      // the final sectPr is the document's default section.
      const lastSection = sections[sections.length - 1];
      return extractPageGeometry(lastSection.sectPr);
    },

    styleShell(): StylesView | undefined {
      if (!cachedStylesView) {
        cachedStylesView = createStylesView(session) ?? undefined;
      }
      return cachedStylesView;
    },

    numberingShell(): NumberingView | undefined {
      if (!cachedNumberingView) {
        cachedNumberingView = createNumberingView(session) ?? undefined;
      }
      return cachedNumberingView;
    },

    settingsShell(): SettingsView | undefined {
      if (!cachedSettingsView) {
        cachedSettingsView = createSettingsView(session) ?? undefined;
      }
      return cachedSettingsView;
    },

    partUri(): string {
      return session.mainDocumentUri;
    },

    resolveRelationshipTarget(relationshipId: string): string | undefined {
      const rels = session.relationships.partRelationships.get(session.mainDocumentUri);
      if (!rels) return undefined;

      const record = rels.get(relationshipId);
      if (!record) return undefined;

      if (record.targetMode === 'External') {
        return record.target;
      }

      return resolveRelTargetFromOpc(session.mainDocumentUri, record.target);
    },
  };
}

// ---- Helpers ----------------------------------------------------------------

function extractPageGeometry(sectPr: XmlElementNode): PageGeometry {
  let width = 12240; // Letter width default (twips)
  let height = 15840; // Letter height default (twips)
  let top = 1440;
  let right = 1440;
  let bottom = 1440;
  let left = 1440;

  for (const child of sectPr.children) {
    if (child.kind !== 'element') continue;

    if (child.localName === 'pgSz' && child.prefix === 'w') {
      width = parseInt(getAttr(child, 'w', 'w') ?? '12240', 10);
      height = parseInt(getAttr(child, 'h', 'w') ?? '15840', 10);
    }

    if (child.localName === 'pgMar' && child.prefix === 'w') {
      top = parseInt(getAttr(child, 'top', 'w') ?? '1440', 10);
      right = parseInt(getAttr(child, 'right', 'w') ?? '1440', 10);
      bottom = parseInt(getAttr(child, 'bottom', 'w') ?? '1440', 10);
      left = parseInt(getAttr(child, 'left', 'w') ?? '1440', 10);
    }
  }

  return { width, height, margins: { top, right, bottom, left } };
}
