// ---------------------------------------------------------------------------
// Error handling tests — degraded vs hard failures
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import { buildZipArchive } from "../src/opc/zip-writer.js";

function entry(name: string, content: string) {
  return {
    kind: "new" as const,
    name,
    uncompressedBytes: new TextEncoder().encode(content),
  };
}

describe("hard failures", () => {
  it("rejects on completely invalid data", async () => {
    await expect(open(new Uint8Array([0, 0, 0]))).rejects.toThrow();
  });

  it("rejects when [Content_Types].xml is missing", async () => {
    const archive = buildZipArchive([
      entry("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
    ]);
    await expect(open(archive)).rejects.toThrow("[Content_Types].xml");
  });

  it("rejects when _rels/.rels is missing", async () => {
    const archive = buildZipArchive([
      entry("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
    ]);
    await expect(open(archive)).rejects.toThrow("_rels/.rels");
  });

  it("rejects when no officeDocument relationship exists", async () => {
    const archive = buildZipArchive([
      entry("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
      entry("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
    ]);
    await expect(open(archive)).rejects.toThrow("main document part");
  });
});

describe("degraded but preservable cases", () => {
  it("opens successfully even with unknown parts (no content type)", async () => {
    const archive = buildZipArchive([
      entry("[Content_Types].xml", `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
      entry("_rels/.rels", `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
      entry("word/document.xml", `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Test</w:t></w:r></w:p></w:body>
</w:document>`),
      entry("word/unknown-part.dat", "some unknown data"),
    ]);

    const handle = await open(archive);
    const status = await handle.status();
    // Should still open with diagnostics about unknown content type
    expect(status.diagnostics.length).toBeGreaterThan(0);
    await handle.close();
  });
});
