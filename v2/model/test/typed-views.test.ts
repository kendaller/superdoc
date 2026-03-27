// ---------------------------------------------------------------------------
// Typed views tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createSession, getArchiveBytes } from "../src/session/session.js";
import { advanceToStage } from "../src/session/session.js";
import {
  createMinimalDocx,
  createComplexDocx,
} from "./helpers/create-test-docx.js";
import { createDocumentView } from "../src/word/document-view.js";
import { createStylesView } from "../src/word/styles-view.js";
import { createNumberingView } from "../src/word/numbering-view.js";
import { createSettingsView } from "../src/word/settings-view.js";
import { createFontTableView } from "../src/word/font-table-view.js";
import { createHeadersFootersView } from "../src/word/headers-footers-view.js";
import { createCommentsView } from "../src/word/annotations-view.js";
import { createContentTypesView, createRelationshipsView } from "../src/word/content-types-view.js";
import { fastOpen } from "../src/opc/package-loader.js";

function setupSession(bytes: Uint8Array) {
  const session = createSession({ kind: "memory", bytes });
  const { mainDocumentUri } = fastOpen({ kind: "memory", bytes });
  return { session, mainDocumentUri };
}

describe("documentView", () => {
  it("enumerates body children", () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const view = createDocumentView(session, mainDocumentUri);

    expect(view).toBeDefined();
    const children = view!.bodyChildren();
    expect(children.length).toBeGreaterThan(0);

    // Should have at least a paragraph and a sectPr
    const kinds = children.map((c) => c.kind);
    expect(kinds).toContain("w:p");
  });

  it("counts body children", () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const view = createDocumentView(session, mainDocumentUri);

    expect(view!.bodyChildCount()).toBeGreaterThan(0);
  });

  it("gets a body child by index", () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const view = createDocumentView(session, mainDocumentUri);

    const first = view!.bodyChild(0);
    expect(first).toBeDefined();
    expect(first!.index).toBe(0);
  });

  it("finds sections with header/footer refs in complex docx", () => {
    const { session, mainDocumentUri } = setupSession(createComplexDocx());
    const view = createDocumentView(session, mainDocumentUri);

    const sections = view!.sections();
    expect(sections.length).toBeGreaterThan(0);

    // Complex docx has header and footer references
    const sect = sections[0];
    expect(sect.headerRefs.length).toBeGreaterThan(0);
    expect(sect.footerRefs.length).toBeGreaterThan(0);
  });
});

describe("stylesView", () => {
  it("lists styles", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createStylesView(session);

    expect(view).toBeDefined();
    const styles = view!.list();
    expect(styles.length).toBeGreaterThan(0);
  });

  it("looks up a style by ID", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createStylesView(session);

    const normal = view!.byId("Normal");
    expect(normal).toBeDefined();
    expect(normal!.name).toBe("Normal");
  });

  it("resolves basedOn chain", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createStylesView(session);

    const chain = view!.basedOnChain("Heading1");
    expect(chain).toContain("Heading1");
    expect(chain).toContain("Normal");
  });
});

describe("numberingView", () => {
  it("lists abstract numbering definitions", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createNumberingView(session);

    expect(view).toBeDefined();
    const abstracts = view!.abstractNums();
    expect(abstracts.length).toBeGreaterThan(0);
    expect(abstracts[0].abstractNumId).toBe("0");
  });

  it("lists numbering instances", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createNumberingView(session);

    const instances = view!.numInstances();
    expect(instances.length).toBeGreaterThan(0);
  });

  it("resolves numId to abstractNumId", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createNumberingView(session);

    const abstractNumId = view!.resolveAbstractNumId("1");
    expect(abstractNumId).toBe("0");
  });
});

describe("settingsView", () => {
  it("accesses settings by name", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createSettingsView(session);

    expect(view).toBeDefined();
    const tabStop = view!.getSetting("defaultTabStop");
    expect(tabStop).toBeDefined();
  });

  it("gets setting val", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createSettingsView(session);

    const val = view!.getSettingVal("defaultTabStop");
    expect(val).toBe("720");
  });
});

describe("fontTableView", () => {
  it("lists fonts", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createFontTableView(session);

    expect(view).toBeDefined();
    const fonts = view!.list();
    expect(fonts.length).toBeGreaterThan(0);
  });

  it("looks up font by name", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createFontTableView(session);

    const calibri = view!.byName("Calibri");
    expect(calibri).toBeDefined();
  });
});

describe("headersFootersView", () => {
  it("lists headers and footers from complex docx", () => {
    const { session, mainDocumentUri } = setupSession(createComplexDocx());
    const view = createHeadersFootersView(session, mainDocumentUri);

    expect(view).toBeDefined();
    const items = view!.list();
    expect(items.length).toBeGreaterThan(0);

    const header = items.find((i) => i.type === "header");
    const footer = items.find((i) => i.type === "footer");
    expect(header).toBeDefined();
    expect(footer).toBeDefined();
  });

  it("hydrates header content lazily", () => {
    const { session, mainDocumentUri } = setupSession(createComplexDocx());
    const view = createHeadersFootersView(session, mainDocumentUri);
    const items = view!.list();
    const header = items.find((i) => i.type === "header")!;

    const root = header.element();
    expect(root).toBeDefined();
    expect(root!.localName).toBe("hdr");
  });
});

describe("commentsView", () => {
  it("lists comments from complex docx", () => {
    const { session } = setupSession(createComplexDocx());
    const view = createCommentsView(session);

    expect(view).toBeDefined();
    const comments = view!.list();
    expect(comments.length).toBe(1);
    expect(comments[0].wordId).toBe("1");
  });
});

describe("contentTypesView", () => {
  it("resolves content type for a known part", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createContentTypesView(session);

    const ct = view.getContentType("/word/document.xml");
    expect(ct).toContain("wordprocessingml.document.main");
  });

  it("lists defaults and overrides", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createContentTypesView(session);

    expect(view.defaults().length).toBeGreaterThan(0);
    expect(view.overrides().length).toBeGreaterThan(0);
  });
});

describe("relationshipsView", () => {
  it("accesses package relationships", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createRelationshipsView(session);

    const pkgRels = view.packageRelationships();
    expect(pkgRels.size).toBeGreaterThan(0);
  });

  it("accesses part relationships", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createRelationshipsView(session);

    const partRels = view.partRelationships("/word/document.xml");
    expect(partRels).toBeDefined();
    expect(partRels!.size).toBeGreaterThan(0);
  });

  it("finds relationships by type", () => {
    const { session } = setupSession(createMinimalDocx());
    const view = createRelationshipsView(session);

    const styleRels = view.findByType(
      "/word/document.xml",
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
    );
    expect(styleRels.length).toBe(1);
  });
});
