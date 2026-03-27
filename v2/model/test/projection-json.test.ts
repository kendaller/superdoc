import { describe, expect, it } from "vitest";
import { createSession, advanceToStage } from "../src/session/session.js";
import { createHandle } from "../src/session/handle.js";
import { projectToSemanticJson } from "../src/projections/json/project.js";
import {
  createInlineImageDocx,
  createInlineSegmentsDocx,
} from "./helpers/create-rich-docx.js";

async function projectJson(bytes: Uint8Array) {
  const session = createSession({ kind: "memory", bytes });
  await advanceToStage(session, "structure");
  const handle = createHandle(session);
  const model = handle.semanticModel();
  if (!model) {
    throw new Error("Semantic model was not created");
  }
  return projectToSemanticJson(model);
}

describe("semantic JSON projection", () => {
  it("preserves inline field-code segments instead of flattening them away", async () => {
    const json = await projectJson(createInlineSegmentsDocx());
    const fieldParagraph = json.stories[0]?.blocks.find(
      (block) =>
        block.kind === "paragraph"
        && block.runs.some((run) =>
          (run.segments ?? []).some(
            (segment) => segment.kind === "fieldChar" || segment.kind === "instrText",
          ),
        ),
    );
    if (!fieldParagraph || fieldParagraph.kind !== "paragraph") {
      throw new Error("Paragraph block was not projected");
    }

    const fieldSegments = fieldParagraph.runs.flatMap((run) => run.segments ?? []);
    expect(fieldSegments.some((segment) => segment.kind === "fieldChar")).toBe(true);
    expect(fieldSegments.some((segment) => segment.kind === "instrText")).toBe(true);
  });

  it("preserves inline drawing segments in the semantic JSON run model", async () => {
    const json = await projectJson(createInlineImageDocx());
    const paragraph = json.stories[0]?.blocks.find((block) => block.kind === "paragraph");
    if (!paragraph || paragraph.kind !== "paragraph") {
      throw new Error("Paragraph block was not projected");
    }

    const drawingSegment = paragraph.runs
      .flatMap((run) => run.segments ?? [])
      .find((segment) => segment.kind === "drawing");

    expect(drawingSegment).toEqual({
      kind: "drawing",
      isInline: true,
    });
  });
});
