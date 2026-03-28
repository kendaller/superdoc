// ---------------------------------------------------------------------------
// Session, handle, and lifecycle types
// ---------------------------------------------------------------------------

import type { ZipSnapshot } from './zip.js';
import type {
  ArchiveByteSource,
  AsyncArchiveReader,
  ContentTypesModel,
  PackagePart,
  PartUri,
  RelationshipIndex,
} from './package.js';
import type { DocumentView } from '../word/document-view.js';
import type { StylesView } from '../word/styles-view.js';
import type { NumberingView } from '../word/numbering-view.js';
import type { SettingsView } from '../word/settings-view.js';
import type { HeadersFootersView } from '../word/headers-footers-view.js';
import type { AnnotationCollectionView } from '../word/annotations-view.js';
import type { ThemeView } from '../word/theme-view.js';
import type { FontTableView } from '../word/font-table-view.js';
import type { ContentTypesView, RelationshipsView } from '../word/content-types-view.js';

// ---- Ready stages ---------------------------------------------------------

export type ReadyStage = 'fast-open' | 'render-shell' | 'structure';

// ---- Document handle (public API) -----------------------------------------

export type DocumentHandle = {
  sessionId: string;
  ready(stage?: ReadyStage, signal?: AbortSignal): Promise<void>;
  status(): Promise<SessionStatus>;
  close(): Promise<void>;
  save(options?: SaveOptions): Promise<SaveResult>;
  /** Get a typed view over the main document part. */
  documentView(): DocumentView | undefined;
  /** Get all typed views for the package. Views are lazily created and cached. */
  views(): PackageViews;
  /**
   * Get the render-shell surface for fast first paint.
   * Available after ready("render-shell"). Returns undefined before that stage.
   * This is a read-only critical-path surface — not a replacement for semanticModel().
   */
  renderShell(): import('../render-shell/render-shell-document.js').RenderShellDocument | undefined;
  /**
   * Get the semantic model for the document.
   * Lazily created on first access; requires ready("structure") first.
   * Returns undefined if the session is not yet at the "structure" stage.
   */
  semanticModel(): import('../model.js').SemanticModel | undefined;
};

/** Bundle of all typed views for a .docx package. */
export type PackageViews = {
  document: DocumentView | undefined;
  styles: StylesView | undefined;
  numbering: NumberingView | undefined;
  settings: SettingsView | undefined;
  headersFooters: HeadersFootersView | undefined;
  comments: AnnotationCollectionView | undefined;
  footnotes: AnnotationCollectionView | undefined;
  endnotes: AnnotationCollectionView | undefined;
  theme: ThemeView | undefined;
  fontTable: FontTableView | undefined;
  contentTypes: ContentTypesView;
  relationships: RelationshipsView;
};

// ---- Session status -------------------------------------------------------

export type SessionStatus = {
  sessionId: string;
  currentRevision: string;
  currentStage: ReadyStage;
  diagnostics: SessionDiagnostic[];
  metrics: {
    partCount: number;
    xmlPartCount: number;
    binaryPartCount: number;
    indexedXmlPartCount: number;
    hydratedXmlPartCount: number;
  };
};

export type SessionDiagnostic = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  stage: ReadyStage | 'save';
  message: string;
  partUri?: string;
};

// ---- Save types -----------------------------------------------------------

export type SaveResult = Uint8Array | Blob | ReadableStream<Uint8Array>;

export type SaveOptions = {
  target?: 'bytes' | 'blob' | 'stream';
  mode?: 'auto' | 'original-if-clean' | 'rebuild';
};

// ---- Internal session -----------------------------------------------------

export type PackageSession = {
  sessionId: string;
  originalArchive: ArchiveByteSource;
  originalZip: ZipSnapshot;
  currentRevision: string;
  mainDocumentUri: PartUri;
  parts: Map<PartUri, PackagePart>;
  relationships: RelationshipIndex;
  contentTypes: ContentTypesModel;
  diagnostics: SessionDiagnostic[];
  currentStage: ReadyStage;
  /** For lazy Blob/range-reader sessions — reads entry bytes on demand. */
  asyncReader?: AsyncArchiveReader;
};
