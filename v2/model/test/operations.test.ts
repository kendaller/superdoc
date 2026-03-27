import { beforeEach, describe, expect, it } from "vitest";
import type { EntityRef } from "../src/identity/types.js";
import { createSession, advanceToStage } from "../src/session/session.js";
import { createHandle } from "../src/session/handle.js";
import { resolvePartBytes } from "../src/session/part-bytes.js";
import {
  applySemanticOperation,
  resetOperationCounter,
  SemanticHistory,
} from "../src/operations/index.js";
import { createMinimalDocx } from "./helpers/create-test-docx.js";
import { createFormattedParagraphDocx } from "./helpers/create-rich-docx.js";

function textSegmentsForRun(model: Awaited<ReturnType<typeof openSemanticModel>>["model"], runRef: EntityRef): string {
  return model.segments(runRef)
    .filter((segment) => segment.segmentKind === "text")
    .map((segment) => segment.text)
    .join("");
}

function readDocumentXml(
  session: ReturnType<typeof createSession>,
): string {
  const documentPart = session.parts.get("/word/document.xml");
  if (!documentPart || documentPart.kind !== "xml") {
    throw new Error("Document part is missing");
  }

  return new TextDecoder().decode(resolvePartBytes(documentPart, session));
}

async function openSemanticModel(bytes: Uint8Array) {
  const session = createSession({ kind: "memory", bytes });
  await advanceToStage(session, "structure");
  const handle = createHandle(session);
  const model = handle.semanticModel();
  if (!model) {
    throw new Error("Semantic model was not created");
  }

  return { session, handle, model };
}

describe("semantic operations", () => {
  beforeEach(() => {
    resetOperationCounter();
  });

  it("applies insertText and semantic undo without losing surrounding OOXML", async () => {
    const { session, model } = await openSemanticModel(createMinimalDocx("Hello"));
    const history = new SemanticHistory();
    const paragraph = model.allParagraphs()[0];
    const run = model.runs(paragraph.ref)[0];

    const applyResult = await applySemanticOperation(
      {
        id: "insert-1",
        label: "Insert punctuation",
        kind: "insertText",
        target: run.ref,
        text: "!",
        position: { segmentIndex: 0, charOffset: 5 },
      },
      model,
      session,
      history,
    );

    expect(applyResult.ok).toBe(true);
    expect(readDocumentXml(session)).toContain("<w:t>Hello!</w:t>");

    const undoOp = history.undo();
    expect(undoOp).toBeDefined();
    const undoResult = await applySemanticOperation(undoOp!, model, session);
    expect(undoResult.ok).toBe(true);
    expect(readDocumentXml(session)).toContain("<w:t>Hello</w:t>");
    expect(readDocumentXml(session)).not.toContain("<w:t>Hello!</w:t>");
  });

  it("updates only the paragraph style reference when setParagraphStyle is applied", async () => {
    const { session, model } = await openSemanticModel(createFormattedParagraphDocx());
    const paragraph = model.allParagraphs()[0];

    const result = await applySemanticOperation(
      {
        id: "style-1",
        label: "Set paragraph style",
        kind: "setParagraphStyle",
        target: paragraph.ref,
        styleId: "Normal",
      },
      model,
      session,
    );

    expect(result.ok).toBe(true);

    const xml = readDocumentXml(session);
    expect(xml).toMatch(/<w:pStyle(?:\s+xmlns:w="[^"]+")?\s+w:val="Normal"/);
    expect(xml).toContain("<w:spacing");
    expect(xml).toContain("<w:jc");
    expect(xml).toContain("<w:ind");
    expect(xml).toContain("<w:pBdr");
    expect(xml).toContain("<w:tabs>");
  });

  it("removes only the bold toggle while preserving the rest of run properties", async () => {
    const { session, model } = await openSemanticModel(createFormattedParagraphDocx());
    const paragraph = model.allParagraphs()[0];
    const run = model.runs(paragraph.ref)[0];

    const result = await applySemanticOperation(
      {
        id: "bold-1",
        label: "Disable bold",
        kind: "toggleBold",
        target: run.ref,
        value: false,
      },
      model,
      session,
    );

    expect(result.ok).toBe(true);

    const xml = readDocumentXml(session);
    expect(xml).not.toMatch(/<w:b(?:\s|\/|>)/);
    expect(xml).toContain("<w:sz");
    expect(xml).toContain("<w:rFonts");
    expect(xml).toContain("<w:color");
    expect(xml).toContain("Bold Red Title");
  });

  it("splits and merges a paragraph while preserving run structure", async () => {
    const { session, model } = await openSemanticModel(createFormattedParagraphDocx());
    const history = new SemanticHistory();
    const paragraph = model.allParagraphs()[0];

    const splitResult = await applySemanticOperation(
      {
        id: "split-1",
        label: "Split paragraph",
        kind: "splitParagraph",
        target: paragraph.ref,
        at: { runIndex: 0, charOffset: 4 },
      },
      model,
      session,
      history,
    );

    expect(splitResult.ok).toBe(true);

    let xml = readDocumentXml(session);
    expect(xml).toContain(">Bold<");
    expect(xml).toContain("> Red Title<");

    const undoOp = history.undo();
    expect(undoOp?.kind).toBe("mergeParagraphs");

    const mergeResult = await applySemanticOperation(undoOp!, model, session);
    expect(mergeResult.ok).toBe(true);

    const mergedParagraph = model.allParagraphs()[0];
    const mergedRunTexts = model.runs(mergedParagraph.ref).map((run) => textSegmentsForRun(model, run.ref));

    expect(mergedRunTexts).toEqual([
      "Bold",
      " Red Title",
      " Italic Underline",
    ]);
  });
});
