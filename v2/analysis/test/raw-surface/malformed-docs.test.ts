import { describe, it, expect } from 'vitest';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { buildRawZip, xmlEntry } from '../helpers/create-test-docx.js';

describe('malformed document handling', () => {
  it('does not crash on invalid XML in a part', async () => {
    const bytes = buildRawZip({
      '[Content_Types].xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>`),
      '_rels/.rels': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
      // This is intentionally malformed XML
      'word/document.xml': xmlEntry(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Before error</w:t></w:r>
    <<< INVALID XML HERE >>>
  </w:body>
</w:document>`),
    });

    // Should not throw
    const result = await scanRawSurface(bytes, 'malformed.docx');

    // Should have diagnostics
    const xmlErrors = result.packageIndex.scanDiagnostics.filter((d) => d.code === 'xml-parse-error');
    expect(xmlErrors.length).toBeGreaterThan(0);

    // Should still have scanned other parts
    expect(result.facts.length).toBeGreaterThan(0);
  });

  it('reports not-xml diagnostic for XML-extension files with binary content', async () => {
    const bytes = buildRawZip({
      '[Content_Types].xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>`),
      '_rels/.rels': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
      // .xml extension but binary content
      'word/document.xml': new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]),
    });

    const result = await scanRawSurface(bytes, 'binary-xml.docx');

    const notXmlDiags = result.packageIndex.scanDiagnostics.filter((d) => d.code === 'not-xml');
    expect(notXmlDiags.length).toBeGreaterThan(0);

    // The entry should be marked as failed
    const docEntry = result.packageIndex.entries.find((e) => e.path === 'word/document.xml');
    expect(docEntry?.parseStatus).toBe('failed');
  });

  it('classifies binary parts correctly and skips them', async () => {
    const bytes = buildRawZip({
      '[Content_Types].xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="png" ContentType="image/png"/>
</Types>`),
      '_rels/.rels': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
      'word/media/image1.png': new Uint8Array([137, 80, 78, 71, 13, 10]),
    });

    const result = await scanRawSurface(bytes, 'binary.docx');

    const pngEntry = result.packageIndex.entries.find((e) => e.path === 'word/media/image1.png');
    expect(pngEntry?.entryKind).toBe('binary');
    expect(pngEntry?.parseStatus).toBe('skipped');
  });

  it('includes diagnostics in the summary', async () => {
    const bytes = buildRawZip({
      '[Content_Types].xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>`),
      '_rels/.rels': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
      'word/document.xml': new Uint8Array([0x00, 0x01]),
    });

    const result = await scanRawSurface(bytes, 'test.docx');
    expect(result.summary.scanDiagnostics.length).toBeGreaterThan(0);
  });
});
