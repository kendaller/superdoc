// ---------------------------------------------------------------------------
// Test fixture builder for v2/analysis
// ---------------------------------------------------------------------------
// Creates minimal valid .docx files using fflate directly.
// No dependency on v2/model — this package must remain independent.
// ---------------------------------------------------------------------------

import { zipSync, type Zippable } from 'fflate';

const encoder = new TextEncoder();

function xmlEntry(content: string): Uint8Array {
  return encoder.encode(content);
}

function utf16LeXmlEntry(content: string): Uint8Array {
  const body = Buffer.from(content, 'utf16le');
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
}

function buildZip(entries: Record<string, Uint8Array>): Uint8Array {
  const zippable: Zippable = {};
  for (const [path, data] of Object.entries(entries)) {
    // Handle nested paths by building the tree structure
    const parts = path.split('/');
    let current: Zippable = zippable;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]] as Zippable;
    }
    current[parts[parts.length - 1]] = data;
  }
  return zipSync(zippable);
}

// ---------------------------------------------------------------------------
// Shared XML fragments
// ---------------------------------------------------------------------------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const WORD_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Minimal valid .docx with one paragraph. */
export function createMinimalDocx(): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:b/></w:rPr>
        <w:t>Hello</w:t>
      </w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  return buildZip({
    '[Content_Types].xml': xmlEntry(CONTENT_TYPES),
    '_rels/.rels': xmlEntry(ROOT_RELS),
    'word/_rels/document.xml.rels': xmlEntry(WORD_RELS),
    'word/document.xml': xmlEntry(documentXml),
    'word/styles.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`),
  });
}

/** .docx with header, footer, and comments. */
export function createDocxWithHeaderFooterComments(): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
</Types>`;

  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

  return buildZip({
    '[Content_Types].xml': xmlEntry(contentTypes),
    '_rels/.rels': xmlEntry(ROOT_RELS),
    'word/_rels/document.xml.rels': xmlEntry(wordRels),
    'word/document.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Body</w:t></w:r></w:p>
  </w:body>
</w:document>`),
    'word/styles.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`),
    'word/header1.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Header</w:t></w:r></w:p>
</w:hdr>`),
    'word/footer1.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Footer</w:t></w:r></w:p>
</w:ftr>`),
    'word/comments.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="1" w:author="Tester" w:date="2026-01-01T00:00:00Z">
    <w:p><w:r><w:t>A comment</w:t></w:r></w:p>
  </w:comment>
</w:comments>`),
    // 1x1 transparent PNG (binary — should not be XML-scanned)
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]),
  });
}

/** .docx with mc:AlternateContent markup. */
export function createDocxWithAlternateContent(): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p>
      <mc:AlternateContent>
        <mc:Choice Requires="w14">
          <w:r><w:rPr><w14:textFill/></w:rPr><w:t>New</w:t></w:r>
        </mc:Choice>
        <mc:Fallback>
          <w:r><w:t>Old</w:t></w:r>
        </mc:Fallback>
      </mc:AlternateContent>
    </w:p>
  </w:body>
</w:document>`;

  return buildZip({
    '[Content_Types].xml': xmlEntry(CONTENT_TYPES),
    '_rels/.rels': xmlEntry(ROOT_RELS),
    'word/_rels/document.xml.rels': xmlEntry(WORD_RELS),
    'word/document.xml': xmlEntry(documentXml),
    'word/styles.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`),
  });
}

/** .docx with a non-standard namespace prefix for wordprocessingml. */
export function createDocxWithNonStandardPrefix(): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wordml:document xmlns:wordml="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <wordml:body>
    <wordml:p>
      <wordml:r><wordml:t>Hello</wordml:t></wordml:r>
    </wordml:p>
  </wordml:body>
</wordml:document>`;

  return buildZip({
    '[Content_Types].xml': xmlEntry(CONTENT_TYPES),
    '_rels/.rels': xmlEntry(ROOT_RELS),
    'word/_rels/document.xml.rels': xmlEntry(WORD_RELS),
    'word/document.xml': xmlEntry(documentXml),
    'word/styles.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`),
  });
}

/** .docx with a custom/unknown XML part. */
export function createDocxWithCustomXml(): Uint8Array {
  return buildZip({
    '[Content_Types].xml': xmlEntry(CONTENT_TYPES),
    '_rels/.rels': xmlEntry(ROOT_RELS),
    'word/_rels/document.xml.rels': xmlEntry(WORD_RELS),
    'word/document.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p/></w:body>
</w:document>`),
    'word/styles.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`),
    'customXml/item1.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8"?>
<ns0:root xmlns:ns0="http://example.com/custom">
  <ns0:field ns0:name="test" ns0:value="123"/>
</ns0:root>`),
  });
}

/** Minimal valid .docx whose main document part is UTF-16LE encoded. */
export function createUtf16MainDocumentDocx(): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-16" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Hello UTF-16</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

  return buildZip({
    '[Content_Types].xml': xmlEntry(CONTENT_TYPES),
    '_rels/.rels': xmlEntry(ROOT_RELS),
    'word/_rels/document.xml.rels': xmlEntry(WORD_RELS),
    'word/document.xml': utf16LeXmlEntry(documentXml),
    'word/styles.xml': xmlEntry(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`),
  });
}

/** Build a raw ZIP containing arbitrary entries (for edge case tests). */
export function buildRawZip(entries: Record<string, Uint8Array>): Uint8Array {
  return buildZip(entries);
}

export { xmlEntry };
