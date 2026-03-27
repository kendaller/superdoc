// ---------------------------------------------------------------------------
// Part Classification
// ---------------------------------------------------------------------------
// Assigns a stable `PartKind` to each package entry based on its path.
// This is a reporting convenience only — it never changes scan behavior.
// Unknown XML parts are classified as "unknown-xml-part" and still scanned.
// ---------------------------------------------------------------------------

import type { PartKind } from './types.js';

type ClassificationRule = {
  test: (path: string) => boolean;
  kind: PartKind;
};

const CLASSIFICATION_RULES: ClassificationRule[] = [
  { test: (p) => p === 'word/document.xml', kind: 'main-document' },
  { test: (p) => p === 'word/glossary/document.xml', kind: 'glossary-document' },
  { test: (p) => /^word\/header\d*\.xml$/.test(p), kind: 'header' },
  { test: (p) => /^word\/footer\d*\.xml$/.test(p), kind: 'footer' },
  { test: (p) => p === 'word/footnotes.xml', kind: 'footnotes' },
  { test: (p) => p === 'word/endnotes.xml', kind: 'endnotes' },
  { test: (p) => p === 'word/comments.xml', kind: 'comments' },
  { test: (p) => p === 'word/commentsExtended.xml', kind: 'comments-extended' },
  { test: (p) => p === 'word/styles.xml', kind: 'styles' },
  { test: (p) => p === 'word/numbering.xml', kind: 'numbering' },
  { test: (p) => p === 'word/settings.xml', kind: 'settings' },
  { test: (p) => p.startsWith('word/theme/'), kind: 'theme' },
  { test: (p) => p === 'word/fontTable.xml', kind: 'font-table' },
  { test: (p) => p.endsWith('.rels'), kind: 'relationships' },
  { test: (p) => p === '[Content_Types].xml', kind: 'content-types' },
  { test: (p) => p.startsWith('customXml/'), kind: 'custom-xml' },
  { test: (p) => p.startsWith('docProps/'), kind: 'doc-props' },
];

/** Classify a package entry path into a stable PartKind. */
export function classifyPart(entryPath: string): PartKind {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.test(entryPath)) return rule.kind;
  }
  return 'unknown-xml-part';
}
