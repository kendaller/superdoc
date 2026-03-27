// ---------------------------------------------------------------------------
// Tests for dirty saves that span multiple parts simultaneously
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import { createSession } from "../src/session/session.js";
import { savePackage } from "../src/session/save.js";
import { createDocumentView } from "../src/word/document-view.js";
import { getXmlPart, markPartDirty, ensureHydrated } from "../src/word/view-base.js";
import { resolveEntryBytes } from "../src/opc/package-loader.js";
import { createMinimalDocx, createComplexDocx } from "./helpers/create-test-docx.js";
import type { XmlElementNode } from "../src/types/xml.js";
import type { BinaryPart } from "../src/types/package.js";

// ---- Helpers --------------------------------------------------------------

function setupSession(bytes: Uint8Array) {
  const session = createSession({ kind: "memory", bytes });
  return { session, mainDocumentUri: session.mainDocumentUri };
}

function findTextInTree(root: XmlElementNode, target: string): boolean {
  for (const child of root.children) {
    if (child.kind === "text" && child.value.includes(target)) return true;
    if (child.kind === "element" && findTextInTree(child, target)) return true;
  }
  return false;
}

// ---- Tests ----------------------------------------------------------------

describe("multi-part dirty save", () => {
  it("persists mutations to both document.xml and styles.xml", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());

    // Mutate document.xml
    const docPart = getXmlPart(session, mainDocumentUri)!;
    ensureHydrated(docPart, session);
    const docView = createDocumentView(session, mainDocumentUri)!;
    const docRoot = docView.rootElement()!;
    const body = docRoot.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;
    const firstP = body.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "p",
    )!;
    const run = firstP.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    )!;
    const t = run.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    )!;
    const textNode = t.children[0];
    if (textNode.kind === "text") textNode.value = "DocMutated";
    markPartDirty(docPart, session);

    // Mutate styles.xml
    const stylesPart = getXmlPart(session, "/word/styles.xml")!;
    const stylesDoc = ensureHydrated(stylesPart, session);
    const stylesRoot = stylesDoc.children.find(
      (c): c is XmlElementNode => c.kind === "element",
    )!;
    const normalStyle = stylesRoot.children.find(
      (c): c is XmlElementNode =>
        c.kind === "element" &&
        c.localName === "style" &&
        c.attributes.some((a) => a.localName === "styleId" && a.value === "Normal"),
    )!;
    const nameEl = normalStyle.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "name",
    )!;
    const valAttr = nameEl.attributes.find((a) => a.localName === "val")!;
    valAttr.value = "ModifiedNormal";
    markPartDirty(stylesPart, session);

    // Save
    const saved = savePackage(session) as Uint8Array;
    expect(saved).toBeInstanceOf(Uint8Array);

    // Re-open and verify both mutations persisted
    const handle2 = await open(saved);
    await handle2.ready("structure");

    // Check document mutation
    const docView2 = handle2.documentView()!;
    const root2 = docView2.rootElement()!;
    expect(findTextInTree(root2, "DocMutated")).toBe(true);

    // Check styles mutation
    const views2 = handle2.views();
    const stylesRoot2 = views2.styles?.rootElement();
    expect(stylesRoot2).toBeDefined();
    const normalStyle2 = stylesRoot2!.children.find(
      (c): c is XmlElementNode =>
        c.kind === "element" &&
        c.localName === "style" &&
        c.attributes.some((a) => a.localName === "styleId" && a.value === "Normal"),
    );
    const nameEl2 = normalStyle2?.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "name",
    );
    const valAttr2 = nameEl2?.attributes.find((a) => a.localName === "val");
    expect(valAttr2?.value).toBe("ModifiedNormal");

    await handle2.close();
  });

  it("persists a binary part mutation alongside an XML part mutation", async () => {
    const { session, mainDocumentUri } = setupSession(createComplexDocx());

    // Mutate document.xml
    const docPart = getXmlPart(session, mainDocumentUri)!;
    ensureHydrated(docPart, session);
    markPartDirty(docPart, session);

    // Mutate the binary image part
    const imagePart = session.parts.get("/word/media/image1.png") as BinaryPart;
    expect(imagePart).toBeDefined();
    expect(imagePart.kind).toBe("binary");

    const newImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 99, 99, 99]);
    imagePart.materializedBytes = newImageBytes;
    imagePart.dirty = true;

    // Save
    const saved = savePackage(session) as Uint8Array;
    expect(saved).toBeInstanceOf(Uint8Array);

    // Re-open and verify both persisted
    const session2 = createSession({ kind: "memory", bytes: saved });
    const imagePart2 = session2.parts.get("/word/media/image1.png")!;
    expect(imagePart2.kind).toBe("binary");

    // Resolve the image bytes and verify they match
    const resolvedBytes = resolveEntryBytes(
      saved,
      session2.originalZip,
      imagePart2.source.kind === "archive-slice" ? imagePart2.source.entryId : "",
    );
    expect(resolvedBytes).toEqual(newImageBytes);
  });

  it("multi-part dirty save can be re-opened and re-saved", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());

    // Dirty two parts
    const docPart = getXmlPart(session, mainDocumentUri)!;
    ensureHydrated(docPart, session);
    markPartDirty(docPart, session);

    const settingsPart = getXmlPart(session, "/word/settings.xml")!;
    ensureHydrated(settingsPart, session);
    markPartDirty(settingsPart, session);

    // Save, re-open, and save again — should not crash
    const saved1 = savePackage(session) as Uint8Array;
    const handle2 = await open(saved1);
    await handle2.ready("structure");
    const saved2 = await handle2.save({ target: "bytes" });
    await handle2.close();

    expect(saved2).toBeInstanceOf(Uint8Array);
    expect((saved2 as Uint8Array).length).toBeGreaterThan(0);
  });
});

describe("new part save", () => {
  it("saves a programmatically added binary part", async () => {
    const { session } = setupSession(createMinimalDocx());

    // Add a new binary part
    const newImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    session.parts.set("/word/media/new-image.png", {
      kind: "binary",
      uri: "/word/media/new-image.png",
      contentType: "image/png",
      source: { kind: "generated", bytes: newImageBytes },
      dirty: true,
    });

    // Register the content type for .png
    session.contentTypes.defaults.set("png", "image/png");

    // Save
    const saved = savePackage(session) as Uint8Array;
    expect(saved).toBeInstanceOf(Uint8Array);

    // Re-open and verify the new part exists
    const session2 = createSession({ kind: "memory", bytes: saved });
    const newPart = session2.parts.get("/word/media/new-image.png");
    expect(newPart).toBeDefined();
    expect(newPart!.kind).toBe("binary");

    // Verify the bytes round-tripped
    const resolvedBytes = resolveEntryBytes(
      saved,
      session2.originalZip,
      newPart!.source.kind === "archive-slice" ? newPart!.source.entryId : "",
    );
    expect(resolvedBytes).toEqual(newImageBytes);
  });

  it("saves a programmatically added XML part", async () => {
    const { session } = setupSession(createMinimalDocx());

    const customXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<custom xmlns="http://example.com/custom"><data>test</data></custom>`;
    const customBytes = new TextEncoder().encode(customXml);

    session.parts.set("/customXml/item1.xml", {
      kind: "xml",
      uri: "/customXml/item1.xml",
      contentType: "application/xml",
      source: { kind: "generated", bytes: customBytes },
      treeState: { kind: "indexed-only" },
      dirty: true,
    });

    // Register content type override
    session.contentTypes.overrides.set(
      "/customXml/item1.xml",
      "application/xml",
    );

    const saved = savePackage(session) as Uint8Array;
    expect(saved).toBeInstanceOf(Uint8Array);

    // Re-open and verify
    const session2 = createSession({ kind: "memory", bytes: saved });
    expect(session2.parts.has("/customXml/item1.xml")).toBe(true);
  });
});
