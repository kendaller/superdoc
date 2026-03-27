import { describe, it, expect } from 'vitest';
import { classifyPart } from '../../src/raw-surface/part-classification.js';

describe('classifyPart', () => {
  it('classifies word/document.xml as main-document', () => {
    expect(classifyPart('word/document.xml')).toBe('main-document');
  });

  it('classifies headers', () => {
    expect(classifyPart('word/header1.xml')).toBe('header');
    expect(classifyPart('word/header2.xml')).toBe('header');
  });

  it('classifies footers', () => {
    expect(classifyPart('word/footer1.xml')).toBe('footer');
  });

  it('classifies footnotes and endnotes', () => {
    expect(classifyPart('word/footnotes.xml')).toBe('footnotes');
    expect(classifyPart('word/endnotes.xml')).toBe('endnotes');
  });

  it('classifies comments', () => {
    expect(classifyPart('word/comments.xml')).toBe('comments');
    expect(classifyPart('word/commentsExtended.xml')).toBe('comments-extended');
  });

  it('classifies styles, numbering, settings', () => {
    expect(classifyPart('word/styles.xml')).toBe('styles');
    expect(classifyPart('word/numbering.xml')).toBe('numbering');
    expect(classifyPart('word/settings.xml')).toBe('settings');
  });

  it('classifies theme parts', () => {
    expect(classifyPart('word/theme/theme1.xml')).toBe('theme');
  });

  it('classifies font table', () => {
    expect(classifyPart('word/fontTable.xml')).toBe('font-table');
  });

  it('classifies relationship files', () => {
    expect(classifyPart('_rels/.rels')).toBe('relationships');
    expect(classifyPart('word/_rels/document.xml.rels')).toBe('relationships');
  });

  it('classifies content types', () => {
    expect(classifyPart('[Content_Types].xml')).toBe('content-types');
  });

  it('classifies custom XML', () => {
    expect(classifyPart('customXml/item1.xml')).toBe('custom-xml');
  });

  it('classifies doc props', () => {
    expect(classifyPart('docProps/app.xml')).toBe('doc-props');
    expect(classifyPart('docProps/core.xml')).toBe('doc-props');
  });

  it('classifies glossary document', () => {
    expect(classifyPart('word/glossary/document.xml')).toBe('glossary-document');
  });

  it('returns unknown-xml-part for unrecognized paths', () => {
    expect(classifyPart('word/webSettings.xml')).toBe('unknown-xml-part');
    expect(classifyPart('something/random.xml')).toBe('unknown-xml-part');
  });
});
