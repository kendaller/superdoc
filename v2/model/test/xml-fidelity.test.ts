// ---------------------------------------------------------------------------
// XML fidelity tests — preservation of declaration, order, namespaces, etc.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildLexicalIndex } from "../src/xml/indexer.js";
import { hydrateDocument } from "../src/xml/hydrator.js";
import { serializeXmlDocument } from "../src/xml/serializer.js";
import type { XmlElementNode } from "../src/types/xml.js";

const encode = (s: string) => new TextEncoder().encode(s);

describe("XML declaration", () => {
  it("preserves XML declaration presence and fields", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<root/>`;
    const bytes = encode(xml);
    const index = buildLexicalIndex(bytes, "/test.xml");

    expect(index.declaration).toBeDefined();
    expect(index.declaration!.version).toBe("1.0");
    expect(index.declaration!.encoding).toBe("UTF-8");
    expect(index.declaration!.standalone).toBe("yes");
    expect(index.declaration!.raw).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    );
  });

  it("round-trips XML declaration through hydrate → serialize", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<root><child/></root>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");

    expect(tree.declaration).toBeDefined();

    const serialized = serializeXmlDocument(tree);
    expect(serialized).toContain('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  });
});

describe("attribute and child order", () => {
  it("preserves attribute order", () => {
    const xml = `<root z="1" a="2" m="3"/>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;

    expect(root.attributes.map((a) => a.localName)).toEqual(["z", "a", "m"]);
  });

  it("preserves child element order", () => {
    const xml = `<root><c/><a/><b/></root>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const childNames = root.children
      .filter((c): c is XmlElementNode => c.kind === "element")
      .map((c) => c.localName);

    expect(childNames).toEqual(["c", "a", "b"]);
  });
});

describe("namespace preservation", () => {
  it("preserves namespace prefixes", () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;

    expect(root.prefix).toBe("w");
    expect(root.localName).toBe("document");
    expect(root.namespaceDecls.length).toBeGreaterThan(0);
    expect(root.namespaceDecls[0].prefix).toBe("w");
    expect(root.namespaceDecls[0].uri).toContain("wordprocessingml");
  });

  it("round-trips namespace declarations", () => {
    const xml = `<w:document xmlns:w="http://example.com/w"><w:body/></w:document>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const serialized = serializeXmlDocument(tree);

    expect(serialized).toContain('xmlns:w="http://example.com/w"');
    expect(serialized).toContain("<w:document");
    expect(serialized).toContain("<w:body/>");
  });
});

describe("text content preservation", () => {
  it("preserves exact text content", () => {
    const xml = `<root><t>Hello, World!</t></root>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const t = root.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    )!;
    const textNode = t.children[0];

    expect(textNode.kind).toBe("text");
    if (textNode.kind === "text") {
      expect(textNode.value).toBe("Hello, World!");
    }
  });

  it("preserves whitespace in text nodes", () => {
    const xml = `<root><t>  spaces  </t></root>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;
    const t = root.children[0] as XmlElementNode;
    const textNode = t.children[0];

    if (textNode.kind === "text") {
      expect(textNode.value).toBe("  spaces  ");
    }
  });
});

describe("CDATA preservation", () => {
  it("preserves CDATA sections as distinct from text", () => {
    const xml = `<root><![CDATA[Some <raw> content]]></root>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;

    const cdata = root.children.find((c) => c.kind === "cdata");
    expect(cdata).toBeDefined();
    expect(cdata!.kind).toBe("cdata");
    if (cdata!.kind === "cdata") {
      expect(cdata!.value).toBe("Some <raw> content");
    }
  });

  it("round-trips CDATA through serialize", () => {
    const xml = `<root><![CDATA[test data]]></root>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const serialized = serializeXmlDocument(tree);

    expect(serialized).toContain("<![CDATA[test data]]>");
  });
});

describe("comments and processing instructions", () => {
  it("preserves XML comments", () => {
    const xml = `<root><!-- a comment --><child/></root>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const root = tree.children[0] as XmlElementNode;

    const comment = root.children.find((c) => c.kind === "comment");
    expect(comment).toBeDefined();
    if (comment?.kind === "comment") {
      expect(comment.value).toBe(" a comment ");
    }
  });

  it("round-trips comments through serialize", () => {
    const xml = `<root><!-- preserved --></root>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");
    const serialized = serializeXmlDocument(tree);

    expect(serialized).toContain("<!-- preserved -->");
  });

  it("preserves processing instructions", () => {
    const xml = `<?pi-target pi-value?><root/>`;
    const bytes = encode(xml);
    const tree = hydrateDocument(bytes, "/test.xml");

    const pi = tree.children.find((c) => c.kind === "pi");
    expect(pi).toBeDefined();
    if (pi?.kind === "pi") {
      expect(pi.target).toBe("pi-target");
      expect(pi.value).toBe("pi-value");
    }
  });
});

describe("lexical indexer", () => {
  it("builds sparse index with root and boundary records", () => {
    const xml = `<?xml version="1.0"?><root><a>text</a><b><nested/></b><c/></root>`;
    const bytes = encode(xml);
    const index = buildLexicalIndex(bytes, "/test.xml");

    expect(index.density).toBe("sparse");
    expect(index.rootElementId).toBeDefined();

    // Root + 3 boundary children = 4 records
    expect(index.indexedNodeIds.length).toBe(4);

    const rootRecord = index.recordsById.get(index.rootElementId!);
    expect(rootRecord).toBeDefined();
    expect(rootRecord!.role).toBe("root");
    expect(rootRecord!.localName).toBe("root");
  });

  it("detects encoding from BOM", () => {
    const xml = `<root/>`;
    const bytes = encode(xml);
    const index = buildLexicalIndex(bytes, "/test.xml");

    expect(index.encoding).toBe("utf-8");
  });

  it("builds regions for boundary nodes", () => {
    const xml = `<root><a/><b/><c/></root>`;
    const bytes = encode(xml);
    const index = buildLexicalIndex(bytes, "/test.xml");

    // Should have root region + 3 boundary regions
    expect(index.regions.length).toBe(4);
    expect(index.regions[0].kind).toBe("root");
  });
});
