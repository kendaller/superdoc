// ---------------------------------------------------------------------------
// Tests for public API surface (Task #16)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import {
  createMinimalDocx,
  createMultiParagraphDocx,
} from "./helpers/create-test-docx.js";
import type { XmlElementNode } from "../src/types/xml.js";

describe("public API: DocumentHandle.documentView()", () => {
  it("returns a DocumentView from the handle", async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready("structure");

    const view = handle.documentView();
    expect(view).toBeDefined();
    expect(view!.partUri).toContain("document.xml");
    await handle.close();
  });

  it("documentView().bodyChildCount() works through public API", async () => {
    const handle = await open(createMultiParagraphDocx(["A", "B"]));
    await handle.ready("structure");

    const view = handle.documentView()!;
    // 2 paragraphs + 1 sectPr = 3
    expect(view.bodyChildCount()).toBe(3);
    await handle.close();
  });

  it("documentView().bodyChild() returns elements through public API", async () => {
    const handle = await open(createMultiParagraphDocx(["Hello", "World"]));
    await handle.ready("structure");

    const view = handle.documentView()!;
    const first = view.bodyChild(0);
    expect(first).toBeDefined();
    expect(first!.localName).toBe("p");
    await handle.close();
  });

  it("documentView().markDirty() + save() works end-to-end", async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready("structure");

    const view = handle.documentView()!;
    const root = view.rootElement()!;

    // Mutate something
    const body = root.children.find(
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
    if (textNode.kind === "text") {
      textNode.value = "PublicAPIModified";
    }

    view.markDirty();
    const result = await handle.save();
    expect(result).toBeInstanceOf(Uint8Array);
    expect((result as Uint8Array).length).toBeGreaterThan(0);

    // Re-open and verify
    const handle2 = await open(result as Uint8Array);
    expect(handle2.sessionId).toBeDefined();
    await handle2.close();
    await handle.close();
  });

  it("documentView() is cached across calls", async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready("structure");

    const view1 = handle.documentView();
    const view2 = handle.documentView();
    expect(view1).toBe(view2);
    await handle.close();
  });
});

describe("public API: handle.views()", () => {
  it("returns all typed views through the public API", async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready("structure");

    const views = handle.views();
    expect(views.document).toBeDefined();
    expect(views.contentTypes).toBeDefined();
    expect(views.relationships).toBeDefined();
    // styles/numbering/theme may be undefined for minimal docx
    await handle.close();
  });

  it("views() is cached across calls", async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready("structure");

    const v1 = handle.views();
    const v2 = handle.views();
    expect(v1).toBe(v2);
    await handle.close();
  });
});

describe("public API: handle.semanticModel()", () => {
  it("returns undefined before structure is ready", async () => {
    const handle = await open(createMinimalDocx());

    expect(handle.semanticModel()).toBeUndefined();

    await handle.close();
  });

  it("returns a cached semantic model after structure is ready", async () => {
    const handle = await open(createMultiParagraphDocx(["One", "Two"]));
    await handle.ready("structure");

    const model1 = handle.semanticModel();
    const model2 = handle.semanticModel();

    expect(model1).toBeDefined();
    expect(model1).toBe(model2);
    expect(model1!.mainStory()).toBeDefined();
    expect(model1!.allEntities("paragraph").length).toBe(2);

    await handle.close();
  });
});
