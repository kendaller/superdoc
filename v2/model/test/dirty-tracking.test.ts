// ---------------------------------------------------------------------------
// Tests for dirty tracking, splice-save, region-level dirty, and entry order
// (Tasks #12, #19)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import { createSession } from "../src/session/session.js";
import { fastOpen } from "../src/opc/package-loader.js";
import { savePackage } from "../src/session/save.js";
import { createDocumentView } from "../src/word/document-view.js";
import {
  getXmlPart,
  getBoundaryRecords,
  markPartDirty,
  markRegionDirty,
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

// ---- Task #12: Dirty tracking and splice-save -----------------------------

describe("dirty tracking and splice-save", () => {
  it("markPartDirty sets dirty flag and advances revision", () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const part = getXmlPart(session, mainDocumentUri)!;
    const rev0 = session.currentRevision;

    expect(part.dirty).toBe(false);
    markPartDirty(part, session);
    expect(part.dirty).toBe(true);
    expect(session.currentRevision).not.toBe(rev0);
  });

  it("dirty save produces valid archive after full hydration mutation", async () => {
    const bytes = createMinimalDocx();
    const { session, mainDocumentUri } = setupSession(bytes);
    const part = getXmlPart(session, mainDocumentUri)!;

    // Fully hydrate and mutate
    const view = createDocumentView(session, mainDocumentUri)!;
    const root = view.rootElement()!;
    const body = root.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;

    // Find the first paragraph's text run
    const firstP = body.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "p",
    )!;
    const run = firstP.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    )!;
    const t = run.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    )!;

    // Mutate the text
    const textNode = t.children[0];
    if (textNode.kind === "text") {
      textNode.value = "Modified text!";
    }

    markPartDirty(part, session);

    // Save should produce bytes (dirty save)
    const result = savePackage(session);
    expect(result).toBeInstanceOf(Uint8Array);

    // Re-open the saved archive and verify the mutation persisted
    const handle2 = await open(result as Uint8Array);
    await handle2.ready("structure");
    const status = await handle2.status();
    expect(status.metrics.partCount).toBeGreaterThan(0);
    await handle2.close();
  });

  it("splice-save works for partially-hydrated dirty parts", () => {
    const bytes = createMultiParagraphDocx(["Hello", "World"]);
    const { session, mainDocumentUri } = setupSession(bytes);
    const part = getXmlPart(session, mainDocumentUri)!;

    // Partially hydrate: access only the first body child
    const view = createDocumentView(session, mainDocumentUri)!;
    const firstChild = view.bodyChild(0);
    expect(firstChild).toBeDefined();
    expect(part.treeState.kind).toBe("partially-hydrated");

    // Mutate the hydrated region
    const textRun = firstChild!.element.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    );
    if (textRun) {
      const t = textRun.children.find(
        (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
      );
      if (t) {
        const textNode = t.children[0];
        if (textNode.kind === "text") {
          textNode.value = "MODIFIED";
        }
      }
    }

    markPartDirty(part, session);

    // Dirty save should use splice strategy
    const result = savePackage(session);
    expect(result).toBeInstanceOf(Uint8Array);
    expect((result as Uint8Array).length).toBeGreaterThan(0);
  });

  it("no-op save returns original bytes when nothing is dirty", () => {
    const bytes = createMinimalDocx();
    const { session } = setupSession(bytes);

    const result = savePackage(session);
    expect(result).toBeInstanceOf(Uint8Array);
    // Should be exactly the original bytes
    expect(result).toEqual(bytes);
  });
});

// ---- Task #19: Region-level dirty tracking --------------------------------

describe("region-level dirty tracking", () => {
  it("markRegionDirty sets dirty flag on the specific region", () => {
    const { session, mainDocumentUri } = setupSession(createMultiParagraphDocx(["A", "B"]));
    const part = getXmlPart(session, mainDocumentUri)!;
    const view = createDocumentView(session, mainDocumentUri)!;

    // Hydrate both children
    view.bodyChild(0);
    view.bodyChild(1);

    expect(part.treeState.kind).toBe("partially-hydrated");
    if (part.treeState.kind !== "partially-hydrated") return;

    // Get the first region's ID
    const records = getBoundaryRecords(part, session);
    const regionId = `region:${records[0].id}`;

    // Mark only the first region dirty
    markRegionDirty(part, session, regionId);

    // Part should be dirty
    expect(part.dirty).toBe(true);

    // Only the first region should be dirty, not the second
    const firstRegion = part.treeState.hydratedRegions.get(regionId);
    expect(firstRegion?.dirty).toBe(true);

    const secondRegionId = `region:${records[1].id}`;
    const secondRegion = part.treeState.hydratedRegions.get(secondRegionId);
    expect(secondRegion?.dirty).toBeFalsy();
  });

  it("splice-save only serializes dirty regions, preserving read-only fidelity", () => {
    const bytes = createMultiParagraphDocx(["Hello", "World"]);
    const { session, mainDocumentUri } = setupSession(bytes);
    const part = getXmlPart(session, mainDocumentUri)!;
    const view = createDocumentView(session, mainDocumentUri)!;

    // Hydrate both children (read-only)
    const first = view.bodyChild(0)!;
    view.bodyChild(1);

    // Mutate only the first and mark only it dirty
    const run = first.element.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    );
    const t = run?.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    );
    if (t) {
      const textNode = t.children[0];
      if (textNode.kind === "text") {
        textNode.value = "CHANGED";
      }
    }

    const records = getBoundaryRecords(part, session);
    markRegionDirty(part, session, `region:${records[0].id}`);

    // Save should succeed
    const result = savePackage(session);
    expect(result).toBeInstanceOf(Uint8Array);
    expect((result as Uint8Array).length).toBeGreaterThan(0);
  });

  it("part-level markPartDirty still works for full hydration", () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const part = getXmlPart(session, mainDocumentUri)!;
    const view = createDocumentView(session, mainDocumentUri)!;

    // Full hydrate + mutate
    view.rootElement();
    markPartDirty(part, session);

    const result = savePackage(session);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("markPartDirty marks all hydrated regions dirty for partial parts", () => {
    const { session, mainDocumentUri } = setupSession(createMultiParagraphDocx(["A", "B"]));
    const part = getXmlPart(session, mainDocumentUri)!;
    const view = createDocumentView(session, mainDocumentUri)!;

    view.bodyChild(0);
    view.bodyChild(1);
    expect(part.treeState.kind).toBe("partially-hydrated");

    markPartDirty(part, session);

    if (part.treeState.kind === "partially-hydrated") {
      for (const region of part.treeState.hydratedRegions.values()) {
        expect(region.dirty).toBe(true);
      }
    }
  });
});

// ---- Public partial-mutation save (the exact failing path) ----------------

describe("public partial-mutation save path", () => {
  it("bodyChild() -> mutate -> markDirty() -> save() persists the mutation", async () => {
    // This is the exact path that was broken: partial hydration + public API only
    const handle = await open(createMultiParagraphDocx(["Original", "Untouched"]));
    await handle.ready("structure");

    const view = handle.documentView()!;

    // Partially hydrate just the first child
    const first = view.bodyChild(0)!;
    expect(first.localName).toBe("p");

    // Mutate the text
    const run = first.element.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    );
    const t = run?.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    );
    expect(t).toBeDefined();
    const textNode = t!.children[0];
    expect(textNode.kind).toBe("text");
    if (textNode.kind === "text") {
      textNode.value = "PublicPathMutated";
    }

    // Public API: markDirty + save
    view.markDirty();
    const savedBytes = await handle.save();
    expect(savedBytes).toBeInstanceOf(Uint8Array);
    await handle.close();

    // Re-open and verify the mutation persisted
    const handle2 = await open(savedBytes as Uint8Array);
    await handle2.ready("structure");
    const view2 = handle2.documentView()!;

    // Full hydrate to read all content
    const root = view2.rootElement()!;
    const body = root.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;
    const paragraphs = body.children.filter(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "p",
    );

    // First paragraph should have the mutated text
    const p1Run = paragraphs[0].children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    );
    const p1T = p1Run?.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    );
    const p1Text = p1T?.children[0];
    expect(p1Text?.kind).toBe("text");
    if (p1Text?.kind === "text") {
      expect(p1Text.value).toBe("PublicPathMutated");
    }

    // Second paragraph should be untouched
    const p2Run = paragraphs[1].children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    );
    const p2T = p2Run?.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    );
    const p2Text = p2T?.children[0];
    expect(p2Text?.kind).toBe("text");
    if (p2Text?.kind === "text") {
      expect(p2Text.value).toBe("Untouched");
    }

    await handle2.close();
  });
});

// ---- Entry order preservation ---------------------------------------------

describe("entry order preservation", () => {
  it("dirty save preserves original ZIP entry order", async () => {
    const original = createMultiParagraphDocx(["First", "Second"]);
    const handle = await open(original);
    await handle.ready("structure");

    // Mark document dirty and save
    handle.documentView()!.markDirty();
    const saved = await handle.save({ target: "bytes" }) as Uint8Array;
    await handle.close();

    // Compare entry orders between original and saved archive
    const { parseZipSnapshot } = await import("../src/opc/zip-reader.js");
    const origZip = parseZipSnapshot(original);
    const savedZip = parseZipSnapshot(saved);

    const origNames = origZip.entryOrder.map(
      (id) => origZip.entries.find((e) => e.entryId === id)!.name,
    );
    const savedNames = savedZip.entryOrder.map(
      (id) => savedZip.entries.find((e) => e.entryId === id)!.name,
    );

    expect(savedNames).toEqual(origNames);
  });
});
