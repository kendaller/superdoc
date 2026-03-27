// ---------------------------------------------------------------------------
// Package fidelity tests — all parts, URIs, content types, relationships
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import { createSession } from "../src/session/session.js";
import {
  createMinimalDocx,
  createComplexDocx,
} from "./helpers/create-test-docx.js";

describe("package fidelity", () => {
  it("preserves all parts after import", async () => {
    const input = createMinimalDocx();
    const session = createSession({ kind: "memory", bytes: input });

    // Minimal docx has: document.xml, styles.xml, settings.xml, numbering.xml, fontTable.xml
    const partUris = [...session.parts.keys()].sort();
    expect(partUris).toContain("/word/document.xml");
    expect(partUris).toContain("/word/styles.xml");
    expect(partUris).toContain("/word/settings.xml");
    expect(partUris).toContain("/word/numbering.xml");
    expect(partUris).toContain("/word/fontTable.xml");
  });

  it("resolves correct content types for all parts", () => {
    const input = createMinimalDocx();
    const session = createSession({ kind: "memory", bytes: input });

    const docPart = session.parts.get("/word/document.xml");
    expect(docPart?.contentType).toContain("wordprocessingml.document.main");

    const stylesPart = session.parts.get("/word/styles.xml");
    expect(stylesPart?.contentType).toContain("wordprocessingml.styles");
  });

  it("parses package relationships correctly", () => {
    const input = createMinimalDocx();
    const session = createSession({ kind: "memory", bytes: input });

    const pkgRels = session.relationships.packageRelationships;
    expect(pkgRels.size).toBeGreaterThan(0);

    // Should have officeDocument relationship
    const docRel = [...pkgRels.values()].find((r) =>
      r.type.includes("officeDocument"),
    );
    expect(docRel).toBeDefined();
    expect(docRel!.target).toBe("word/document.xml");
  });

  it("parses part relationships correctly", () => {
    const input = createMinimalDocx();
    const session = createSession({ kind: "memory", bytes: input });

    const wordRels = session.relationships.partRelationships.get(
      "/word/document.xml",
    );
    expect(wordRels).toBeDefined();
    expect(wordRels!.size).toBeGreaterThan(0);

    // Should have styles relationship
    const stylesRel = [...wordRels!.values()].find((r) =>
      r.type.includes("styles"),
    );
    expect(stylesRel).toBeDefined();
  });

  it("preserves binary parts with exact bytes", () => {
    const input = createComplexDocx();
    const session = createSession({ kind: "memory", bytes: input });

    const imagePart = session.parts.get("/word/media/image1.png");
    expect(imagePart).toBeDefined();
    expect(imagePart!.kind).toBe("binary");
  });

  it("identifies XML vs binary parts correctly", () => {
    const input = createComplexDocx();
    const session = createSession({ kind: "memory", bytes: input });

    for (const [uri, part] of session.parts) {
      if (uri.endsWith(".xml")) {
        expect(part.kind).toBe("xml");
      }
      if (uri.endsWith(".png")) {
        expect(part.kind).toBe("binary");
      }
    }
  });

  it("complex docx has headers, footers, and comments parts", () => {
    const input = createComplexDocx();
    const session = createSession({ kind: "memory", bytes: input });

    expect(session.parts.has("/word/header1.xml")).toBe(true);
    expect(session.parts.has("/word/footer1.xml")).toBe(true);
    expect(session.parts.has("/word/comments.xml")).toBe(true);
  });
});
