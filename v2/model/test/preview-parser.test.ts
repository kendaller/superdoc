import { describe, expect, it } from 'vitest';
import { parsePreviewBodyChild } from '../src/render-shell/preview-parser.js';

describe('parsePreviewBodyChild', () => {
  it('drops drawing text from preview runs while preserving in-flow text metrics', () => {
    const record = parsePreviewBodyChild({
      index: 0,
      partUri: '/word/document.xml',
      localName: 'p',
      sourceSpan: { startByte: 0, endByte: 128 },
      bodyChildPath: 'w:body/w:p[1]',
      rootWrapperOpenTag:
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      rootWrapperCloseTag: '</w:document>',
      fragmentText: [
        '<w:p>',
        '  <w:r>',
        '    <w:drawing>',
        '      <w:t>Decorative Title</w:t>',
        '    </w:drawing>',
        '  </w:r>',
        '  <w:r>',
        '    <w:t>TABLE OF CONTENTS</w:t>',
        '  </w:r>',
        '</w:p>',
      ].join(''),
    });

    expect(record.kind).toBe('paragraph');
    if (record.kind !== 'paragraph') {
      throw new Error('Expected a paragraph preview record');
    }

    const visibleText = record.runs
      .flatMap((run) => run.raw.segments)
      .map((segment) => ('text' in segment ? segment.text : ''))
      .join('');

    expect(record.containsDrawing).toBe(true);
    expect(record.visibleTextOutsideDrawingLength).toBe('TABLEOFCONTENTS'.length);
    expect(visibleText).toBe('TABLE OF CONTENTS');
  });
});
