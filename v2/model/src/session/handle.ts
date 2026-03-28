// ---------------------------------------------------------------------------
// DocumentHandle — public API returned by open()
// ---------------------------------------------------------------------------

import type {
  DocumentHandle,
  PackageViews,
  ReadyStage,
  SaveOptions,
  SaveResult,
  SessionStatus,
  PackageSession,
} from '../types/session.js';
import type { DocumentView } from '../word/document-view.js';
import { createDocumentView } from '../word/document-view.js';
import { createStylesView } from '../word/styles-view.js';
import { createNumberingView } from '../word/numbering-view.js';
import { createSettingsView } from '../word/settings-view.js';
import { createHeadersFootersView } from '../word/headers-footers-view.js';
import { createCommentsView, createFootnotesView, createEndnotesView } from '../word/annotations-view.js';
import { createThemeView } from '../word/theme-view.js';
import { createFontTableView } from '../word/font-table-view.js';
import { createContentTypesView, createRelationshipsView } from '../word/content-types-view.js';
import { advanceToStage, getSessionStatus } from './session.js';
import { savePackage } from './save.js';
import { SemanticModel } from '../model.js';
import { createRenderShellDocument, type RenderShellDocument } from '../render-shell/index.js';

/** Create a DocumentHandle wrapping an internal PackageSession. */
export function createHandle(session: PackageSession): DocumentHandle {
  let closed = false;
  let cachedDocView: DocumentView | undefined;
  let cachedViews: PackageViews | undefined;
  let cachedRenderShell: RenderShellDocument | undefined;
  let cachedSemanticModel: SemanticModel | undefined;

  function assertOpen(): void {
    if (closed) throw new Error('Session is closed');
  }

  return {
    sessionId: session.sessionId,

    async ready(stage: ReadyStage = 'structure'): Promise<void> {
      assertOpen();
      await advanceToStage(session, stage);
    },

    async status(): Promise<SessionStatus> {
      assertOpen();
      return getSessionStatus(session);
    },

    async close(): Promise<void> {
      closed = true;
    },

    async save(options?: SaveOptions): Promise<SaveResult> {
      assertOpen();
      return savePackage(session, options);
    },

    documentView(): DocumentView | undefined {
      assertOpen();
      if (!cachedDocView) {
        cachedDocView = createDocumentView(session, session.mainDocumentUri);
      }
      return cachedDocView;
    },

    renderShell(): RenderShellDocument | undefined {
      assertOpen();
      if (session.currentStage === 'fast-open') return undefined;
      if (!cachedRenderShell) {
        cachedRenderShell = createRenderShellDocument(session);
      }
      return cachedRenderShell;
    },

    semanticModel(): SemanticModel | undefined {
      assertOpen();
      if (session.currentStage !== 'structure') return undefined;
      if (!cachedSemanticModel) {
        const views = this.views();
        cachedSemanticModel = new SemanticModel(session, views);
      }
      return cachedSemanticModel;
    },

    views(): PackageViews {
      assertOpen();
      if (!cachedViews) {
        cachedViews = {
          document: cachedDocView ?? (cachedDocView = createDocumentView(session, session.mainDocumentUri)),
          styles: createStylesView(session),
          numbering: createNumberingView(session),
          settings: createSettingsView(session),
          headersFooters: createHeadersFootersView(session, session.mainDocumentUri),
          comments: createCommentsView(session),
          footnotes: createFootnotesView(session),
          endnotes: createEndnotesView(session),
          theme: createThemeView(session),
          fontTable: createFontTableView(session),
          contentTypes: createContentTypesView(session),
          relationships: createRelationshipsView(session),
        };
      }
      return cachedViews;
    },
  };
}
