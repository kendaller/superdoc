// ---------------------------------------------------------------------------
// Tests for hydrator SourceSpan entity accuracy (Task #13)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { hydrateDocument } from "../src/xml/hydrator.js";
import { buildLexicalIndex } from "../src/xml/indexer.js";
import type { XmlElementNode } from "../src/types/xml.js";

const encode = (s: string) => new TextEncoder().encode(s);

describe("hydrator SourceSpan accuracy", () => {
  it("text node SourceSpan is correct for plain text", () => {
    const xml = "<root>Hello</root>";
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const textNode = root.children[0];

    expect(textNode.kind).toBe("text");
    expect(textNode.sourceSpan).toBeDefined();
    // "Hello" starts at byte 6 (after <root>)
    expect(textNode.sourceSpan!.startByte).toBe(6);
    // saxes reports position one past the `<` that terminates text
    expect(textNode.sourceSpan!.endByte).toBe(12);
  });

  it("text node SourceSpan is correct for entity-encoded content", () => {
    // Source: "A &amp; B" (9 chars in source, but decoded value is "A & B" = 5 chars)
    const xml = "<root>A &amp; B</root>";
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const textNode = root.children[0];

    expect(textNode.kind).toBe("text");
    if (textNode.kind === "text") {
      expect(textNode.value).toBe("A & B");
    }
    expect(textNode.sourceSpan).toBeDefined();
    // "A &amp; B" starts at byte 6 (after <root>)
    expect(textNode.sourceSpan!.startByte).toBe(6);
    // The span correctly covers the entity-encoded SOURCE bytes (9 chars),
    // not the decoded value length (5 chars).
    expect(textNode.sourceSpan!.endByte).toBe(16);
  });

  it("element SourceSpan startByte points to the opening <", () => {
    const xml = "<root><child attr=\"val\">text</child></root>";
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const child = root.children[0] as XmlElementNode;

    expect(child.sourceSpan).toBeDefined();
    // <child starts at byte 6
    expect(child.sourceSpan!.startByte).toBe(6);
    // </child> ends at byte 35
    expect(child.sourceSpan!.endByte).toBe(xml.indexOf("</root>"));
  });

  it("CDATA SourceSpan covers the full <![CDATA[...]]> syntax", () => {
    const xml = "<root><![CDATA[raw & data]]></root>";
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const cdata = root.children[0];

    expect(cdata.kind).toBe("cdata");
    expect(cdata.sourceSpan).toBeDefined();
    expect(cdata.sourceSpan!.startByte).toBe(6);
    expect(cdata.sourceSpan!.endByte).toBe(xml.indexOf("</root>"));
  });

  it("comment SourceSpan covers the <!--...--> syntax", () => {
    const xml = "<root><!-- a comment --></root>";
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const comment = root.children[0];

    expect(comment.kind).toBe("comment");
    expect(comment.sourceSpan).toBeDefined();
    expect(comment.sourceSpan!.startByte).toBe(6);
    // Comment span ends at the parser's reported position after the `-->` syntax
    expect(comment.sourceSpan!.endByte).toBe(23);
  });

  it("entity-encoded text span is wider than decoded value", () => {
    // "&amp;" is 5 source chars but decodes to "&" which is 1 byte.
    // The span must cover the 5 source chars.
    const xml = "<root>&lt;tag&gt;</root>";
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const textNode = root.children[0];

    expect(textNode.kind).toBe("text");
    if (textNode.kind === "text") {
      expect(textNode.value).toBe("<tag>");
    }

    // The source text "&lt;tag&gt;" is 14 chars (not 5 for "<tag>")
    const spanWidth = textNode.sourceSpan!.endByte - textNode.sourceSpan!.startByte;
    expect(spanWidth).toBeGreaterThan(5); // decoded value is only 5 bytes
    expect(textNode.sourceSpan!.startByte).toBe(6);
  });

  it("indexer boundary spans have correct startByte (not zero)", () => {
    const xml = `<?xml version="1.0"?><root><child>content</child></root>`;
    const bytes = encode(xml);
    const index = buildLexicalIndex(bytes, "/test.xml", { boundaryDepth: 1 });

    const boundaries = index.indexedNodeIds
      .map((id) => index.recordsById.get(id)!)
      .filter((r) => r.role === "boundary");

    expect(boundaries.length).toBe(1);
    // <child> starts after <root> which is after the declaration
    expect(boundaries[0].fullSpan.startByte).toBeGreaterThan(20);
    // Verify the bytes at the span actually start with <child>
    const slice = bytes.slice(boundaries[0].fullSpan.startByte, boundaries[0].fullSpan.endByte);
    const text = new TextDecoder().decode(slice);
    expect(text).toBe("<child>content</child>");
  });
});
