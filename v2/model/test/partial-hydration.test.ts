// ---------------------------------------------------------------------------
// Tests for partial hydration and edit preservation (Tasks #11, #17)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createSession } from "../src/session/session.js";
import { fastOpen } from "../src/opc/package-loader.js";
import { createDocumentView } from "../src/word/document-view.js";
import {
  getXmlPart,
  getBoundaryRecords,
} from "../src/word/view-base.js";
import {
  createMinimalDocx,
  createMultiParagraphDocx,
} from "./helpers/create-test-docx.js";
import type { XmlElementNode } from "../src/types/xml.js";

function setupSession(bytes: Uint8Array) {
  const session = createSession({ kind: "memory", bytes });
  const { mainDocumentUri } = fastOpen({ kind: "memory", bytes });
  return { session, mainDocumentUri };
}

// ---- Task #11: Partial hydration ------------------------------------------

describe("partial hydration", () => {
  it("bodyChildCount uses index only — no hydration", () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const part = getXmlPart(session, mainDocumentUri)!;

    const view = createDocumentView(session, mainDocumentUri)!;
    const count = view.bodyChildCount();

    expect(count).toBeGreaterThan(0);
    // Part should be indexed but NOT hydrated
    expect(part.lexicalIndex).toBeDefined();
    expect(part.treeState.kind).toBe("indexed-only");
  });

  it("bodyChild(i) hydrates only that region, not the entire part", () => {
    const { session, mainDocumentUri } = setupSession(createMultiParagraphDocx(["A", "B", "C"]));
    const part = getXmlPart(session, mainDocumentUri)!;

    const view = createDocumentView(session, mainDocumentUri)!;

    // Access just the first body child
    const first = view.bodyChild(0);
    expect(first).toBeDefined();
    expect(first!.localName).toBe("p");

    // Part should be partially hydrated, not fully
    expect(part.treeState.kind).toBe("partially-hydrated");
    if (part.treeState.kind === "partially-hydrated") {
      // Only one region should be hydrated
      expect(part.treeState.hydratedRegions.size).toBe(1);
    }
  });

  it("accessing multiple body children hydrates multiple regions", () => {
    const { session, mainDocumentUri } = setupSession(createMultiParagraphDocx(["A", "B", "C"]));
    const part = getXmlPart(session, mainDocumentUri)!;

    const view = createDocumentView(session, mainDocumentUri)!;
    view.bodyChild(0);
    view.bodyChild(1);

    expect(part.treeState.kind).toBe("partially-hydrated");
    if (part.treeState.kind === "partially-hydrated") {
      expect(part.treeState.hydratedRegions.size).toBe(2);
    }
  });

  it("bodyChildren() hydrates all boundary regions", () => {
    const { session, mainDocumentUri } = setupSession(createMultiParagraphDocx(["A", "B"]));
    const part = getXmlPart(session, mainDocumentUri)!;

    const view = createDocumentView(session, mainDocumentUri)!;
    const children = view.bodyChildren();

    // Should have 2 paragraphs + 1 sectPr = 3 children
    expect(children.length).toBe(3);
    expect(part.treeState.kind).toBe("partially-hydrated");
  });

  it("getBoundaryRecords returns ordered boundary elements", () => {
    const { session, mainDocumentUri } = setupSession(createMultiParagraphDocx(["A", "B", "C"]));
    const part = getXmlPart(session, mainDocumentUri)!;

    const records = getBoundaryRecords(part, session);
    // 3 paragraphs + 1 sectPr = 4 boundaries
    expect(records.length).toBe(4);
    expect(records[0].localName).toBe("p");
    expect(records[3].localName).toBe("sectPr");
  });

  it("rootElement() triggers full hydration", () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const part = getXmlPart(session, mainDocumentUri)!;

    const view = createDocumentView(session, mainDocumentUri)!;
    const root = view.rootElement();

    expect(root).toBeDefined();
    expect(root!.localName).toBe("document");
    expect(part.treeState.kind).toBe("fully-hydrated");
  });
});

// ---- Task #17: ensureHydrated preserves partial edits ---------------------

describe("ensureHydrated preserves partial edits", () => {
  it("mutations via bodyChild() survive rootElement() full hydration", () => {
    const { session, mainDocumentUri } = setupSession(createMultiParagraphDocx(["Original", "Keep"]));
    const part = getXmlPart(session, mainDocumentUri)!;
    const view = createDocumentView(session, mainDocumentUri)!;

    // Partially hydrate first paragraph and mutate it
    const first = view.bodyChild(0)!;
    const run = first.element.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    );
    const t = run?.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    );
    if (t) {
      const textNode = t.children[0];
      if (textNode.kind === "text") {
        textNode.value = "MUTATED";
      }
    }
    expect(part.treeState.kind).toBe("partially-hydrated");

    // Now request full hydration via rootElement()
    const root = view.rootElement()!;
    expect(part.treeState.kind).toBe("fully-hydrated");

    // The mutation should be preserved in the full tree
    const body = root.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;
    const firstP = body.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "p",
    )!;
    const firstRun = firstP.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    );
    const firstT = firstRun?.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    );
    const text = firstT?.children[0];
    expect(text?.kind).toBe("text");
    if (text?.kind === "text") {
      expect(text.value).toBe("MUTATED");
    }
  });

  it("multiple partial regions are preserved when transitioning to full", () => {
    const { session, mainDocumentUri } = setupSession(
      createMultiParagraphDocx(["A", "B", "C"]),
    );
    const part = getXmlPart(session, mainDocumentUri)!;
    const view = createDocumentView(session, mainDocumentUri)!;

    // Hydrate and mutate two regions
    const child0 = view.bodyChild(0)!;
    const child1 = view.bodyChild(1)!;

    // Mutate both — find text nodes
    for (const child of [child0, child1]) {
      const run = child.element.children.find(
        (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
      );
      const t = run?.children.find(
        (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
      );
      if (t) {
        const textNode = t.children[0];
        if (textNode.kind === "text") {
          textNode.value = `MUTATED-${child.index}`;
        }
      }
    }

    expect(part.treeState.kind).toBe("partially-hydrated");

    // Full hydration
    const root = view.rootElement()!;
    expect(part.treeState.kind).toBe("fully-hydrated");

    // Both mutations should be preserved
    const body = root.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;
    const paragraphs = body.children.filter(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "p",
    );

    for (let i = 0; i < 2; i++) {
      const run = paragraphs[i].children.find(
        (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
      );
      const t = run?.children.find(
        (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
      );
      const text = t?.children[0];
      if (text?.kind === "text") {
        expect(text.value).toBe(`MUTATED-${i}`);
      }
    }
  });
});
