// ---------------------------------------------------------------------------
// Headless Import Wrapper
// ---------------------------------------------------------------------------
// Entry point for corpus analysis tooling. Imports a DOCX document using a
// real headless Editor (with all standard extensions loaded) and produces
// V1ResolvedProvenance without requiring PresentationEditor or DOM.
//
// The headless Editor instance can be reused across documents in a corpus
// run — the schema doesn't change between documents.
//
// Fidelity guarantee: this path must produce identical import results to the
// normal editor path for the same DOCX input.
// ---------------------------------------------------------------------------

import { Editor } from '../../Editor.js';
import { getStarterExtensions } from '../../../extensions/index.js';
import { SuperConverter } from '../SuperConverter.js';
import { createDocument } from '../../helpers/createDocument.js';
import { buildPositionMapFromPmDoc } from '../../presentation-editor/utils/PositionMapFromPm.js';
import { resolveProvenance, type StoryInput } from './resolved-provenance.js';
import type { V1ResolvedProvenance, V1StoryRef } from './provenance-types.js';
import type { Node as PMNode, Schema } from 'prosemirror-model';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** DOCX file entry from archive extraction. */
export type DocxFileEntry = {
  name: string;
  content: string;
};

/** Options for headless import. */
export type HeadlessImportOptions = {
  /** Unique document identifier for provenance artifacts. */
  docId: string;
  /** Optional document fingerprint (e.g., hash of DOCX bytes). */
  docFingerprint?: string;
  /** Reusable headless editor (from createHeadlessEditor). If omitted, one is created. */
  editor?: InstanceType<typeof Editor>;
};

/** Result of headless import with provenance. */
export type HeadlessImportResult = {
  /** The resolved provenance snapshot. */
  provenance: V1ResolvedProvenance;
  /** The PM doc node. */
  pmDoc: PMNode;
  /** The converter with all import side effects. */
  converter: InstanceType<typeof SuperConverter>;
};

// ---------------------------------------------------------------------------
// Headless Editor Factory
// ---------------------------------------------------------------------------

/**
 * Create a reusable headless Editor with all standard extensions loaded.
 *
 * The returned editor has a real PM schema but no DOM attachment, no view,
 * and no PresentationEditor. It can be reused across corpus documents.
 */
export function createHeadlessEditor(): InstanceType<typeof Editor> {
  return new Editor({
    isHeadless: true,
    mode: 'docx',
    documentId: 'headless-analysis',
    extensions: getStarterExtensions(),
  });
}

// ---------------------------------------------------------------------------
// Headless Import
// ---------------------------------------------------------------------------

/**
 * Import a DOCX document headlessly and produce a V1ResolvedProvenance snapshot.
 *
 * This is the primary entry point for corpus analysis tooling.
 *
 * @param docxFiles - The DOCX file entries (name + content pairs from archive)
 * @param options - Import configuration
 */
export function headlessImport(docxFiles: DocxFileEntry[], options: HeadlessImportOptions): HeadlessImportResult {
  const { docId, docFingerprint } = options;
  const editor = options.editor ?? createHeadlessEditor();

  // Create converter with provenance enabled
  const converter = new SuperConverter({
    docx: docxFiles,
    media: {},
    fonts: {},
  });
  (converter as any)._enableProvenance = true;

  // Run the import pipeline (getSchema → createDocumentJson → handlers)
  const schema: Schema = editor.schema;
  const pmDocJson = converter.getSchema(editor);
  if (!pmDocJson) {
    throw new Error(`Headless import failed for ${docId}: getSchema returned null`);
  }

  // Create PM doc from the preserved JSON
  const pmDoc: PMNode = schema.nodeFromJSON(pmDocJson);

  // Build per-story inputs for provenance resolution
  const stories: StoryInput[] = buildStoryInputs(converter, schema);

  // Resolve provenance using the preserved JSON snapshots
  const provenanceCollector = (converter as any)._provenanceCollector;
  if (!provenanceCollector) {
    throw new Error(`Headless import failed for ${docId}: provenance collector not available`);
  }

  const collected = provenanceCollector.finalize();
  const provenance = resolveProvenance(collected, stories, docId, docFingerprint);

  return { provenance, pmDoc, converter };
}

// ---------------------------------------------------------------------------
// Story Input Builder
// ---------------------------------------------------------------------------

/**
 * Build StoryInput entries for all stories in the converter.
 *
 * Uses the preserved importer-emitted JSON snapshots (NOT doc.toJSON()).
 */
export function buildStoryInputs(converter: any, schema: Schema): StoryInput[] {
  const stories: StoryInput[] = [];

  // Main document
  const mainJson = converter._importedPmDocJson;
  if (mainJson) {
    stories.push({
      storyRef: { storyKind: 'main', storyKey: 'main' },
      partUri: 'word/document.xml',
      jsonDoc: mainJson,
      schema,
    });
  }

  // Headers
  if (converter.headers) {
    for (const [rId, headerDoc] of Object.entries(converter.headers)) {
      if (headerDoc && typeof headerDoc === 'object') {
        stories.push({
          storyRef: { storyKind: 'header', storyKey: `header:${rId}` },
          partUri: converter._headerPartUris?.[rId] ?? `word/header-${rId}.xml`,
          jsonDoc: headerDoc,
          schema,
        });
      }
    }
  }

  // Footers
  if (converter.footers) {
    for (const [rId, footerDoc] of Object.entries(converter.footers)) {
      if (footerDoc && typeof footerDoc === 'object') {
        stories.push({
          storyRef: { storyKind: 'footer', storyKey: `footer:${rId}` },
          partUri: converter._footerPartUris?.[rId] ?? `word/footer-${rId}.xml`,
          jsonDoc: footerDoc,
          schema,
        });
      }
    }
  }

  // Comments (wrap content arrays in synthetic doc nodes)
  if (converter.comments) {
    for (const comment of converter.comments) {
      if (comment?.elements?.length) {
        stories.push({
          storyRef: {
            storyKind: 'comment',
            storyKey: `comment:${comment.importedId ?? comment.commentId}`,
          },
          partUri: 'word/comments.xml',
          jsonDoc: { type: 'doc', content: comment.elements },
          schema,
        });
      }
    }
  }

  // Footnotes (wrap content arrays in synthetic doc nodes)
  if (converter.footnotes) {
    for (const fn of converter.footnotes) {
      if (fn?.content?.length) {
        stories.push({
          storyRef: { storyKind: 'footnote', storyKey: `footnote:${fn.id}` },
          partUri: 'word/footnotes.xml',
          jsonDoc: { type: 'doc', content: fn.content },
          schema,
        });
      }
    }
  }

  // Endnotes (wrap content arrays in synthetic doc nodes)
  if (converter.endnotes) {
    for (const en of converter.endnotes) {
      if (en?.content?.length) {
        stories.push({
          storyRef: { storyKind: 'endnote', storyKey: `endnote:${en.id}` },
          partUri: 'word/endnotes.xml',
          jsonDoc: { type: 'doc', content: en.content },
          schema,
        });
      }
    }
  }

  return stories;
}
