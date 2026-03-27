// ---------------------------------------------------------------------------
// Analysis occurrence projection tests
//
// Validates: projectToOccurrences() output including occurrence structure,
// field population, text extraction, entity counts, multi-story coverage,
// and trace chain building.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createSession, advanceToStage } from "../src/session/session.js";
import { createHandle } from "../src/session/handle.js";
import { SemanticModel } from "../src/model.js";
import { projectToOccurrences } from "../src/projections/analysis/project.js";
import { buildTraceChain, buildTraceEntry } from "../src/projections/analysis/trace.js";
import { projectToFlowBlocks } from "../src/projections/layout/project.js";
import type {
  SemanticOccurrence,
  AnalysisResult,
} from "../src/projections/analysis/types.js";
import {
  createMinimalDocx,
  createMultiParagraphDocx,
  createComplexDocx,
} from "./helpers/create-test-docx.js";
import {
  createFormattedParagraphDocx,
  createTableDocx,
  createSdtDocx,
  createInlineSegmentsDocx,
} from "./helpers/create-rich-docx.js";

// ---- Helpers ----------------------------------------------------------------

const DOC_ID = "test-doc-001";

async function buildModelDirect(bytes: Uint8Array): Promise<SemanticModel> {
  const session = createSession({ kind: "memory", bytes });
  await advanceToStage(session, "structure");
  const handle = createHandle(session);
  const views = handle.views();
  return new SemanticModel(session, views);
}

function occurrencesOfKind(
  result: AnalysisResult,
  kind: string,
): SemanticOccurrence[] {
  return result.occurrences.filter((o) => o.entityKind === kind);
}

// ---- Basic occurrence generation --------------------------------------------

describe("analysis projection: basic", () => {
  it("produces an AnalysisResult with occurrences for a minimal docx", async () => {
    const bytes = createMinimalDocx("Hello, World!");
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    expect(result.docId).toBe(DOC_ID);
    expect(result.occurrences.length).toBeGreaterThan(0);
    expect(result.entityCount).toBeGreaterThan(0);
    expect(typeof result.diagnosticCount).toBe("number");
  });

  it("includes occurrences for main story, paragraphs, runs, and styles", async () => {
    const bytes = createMinimalDocx("Hello");
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const kinds = new Set(result.occurrences.map((o) => o.entityKind));
    expect(kinds.has("mainStory")).toBe(true);
    expect(kinds.has("paragraph")).toBe(true);
    expect(kinds.has("run")).toBe(true);
    expect(kinds.has("style")).toBe(true);
  });

  it("produces deterministic sort order across identical inputs", async () => {
    const bytes = createMinimalDocx("Determinism test");
    const model1 = await buildModelDirect(bytes);
    const model2 = await buildModelDirect(bytes);

    const r1 = projectToOccurrences(model1, DOC_ID);
    const r2 = projectToOccurrences(model2, DOC_ID);

    expect(r1.occurrences.length).toBe(r2.occurrences.length);
    for (let i = 0; i < r1.occurrences.length; i++) {
      expect(r1.occurrences[i].entityKind).toBe(r2.occurrences[i].entityKind);
      expect(r1.occurrences[i].entityRef.id).toBe(
        r2.occurrences[i].entityRef.id,
      );
    }
  });
});

// ---- Occurrence fields ------------------------------------------------------

describe("analysis projection: occurrence fields", () => {
  it("populates docId, entityRef, entityKind, and occurrenceId on every occurrence", async () => {
    const bytes = createMinimalDocx("Fields test");
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    for (const occ of result.occurrences) {
      expect(occ.docId).toBe(DOC_ID);
      expect(occ.entityRef).toBeDefined();
      expect(occ.entityRef.id).toBeTruthy();
      expect(occ.entityKind).toBeTruthy();
      expect(occ.occurrenceId).toMatch(/^occ:/);
    }
  });

  it("includes sourceNodePath on source-backed occurrences", async () => {
    const bytes = createComplexDocx();
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const paragraph = occurrencesOfKind(result, "paragraph")
      .find((occurrence) => occurrence.sourceRef?.sourceNodePath?.startsWith("w:hdr/"));
    const commentThread = occurrencesOfKind(result, "commentThread")[0];

    expect(paragraph?.sourceRef?.sourceNodePath).toBe("w:hdr/w:p[1]");
    expect(commentThread?.sourceRef?.sourceNodePath).toBe("w:comments/w:comment[1]");
  });

  it("includes storyId on structural entities", async () => {
    const bytes = createMinimalDocx("Story check");
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const paragraphs = occurrencesOfKind(result, "paragraph");
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    // Paragraphs in the main story should have a storyId
    for (const p of paragraphs) {
      expect(p.storyId).toBeTruthy();
    }
  });

  it("provides supportStatus flags on all occurrences", async () => {
    const bytes = createMinimalDocx("Support status");
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    for (const occ of result.occurrences) {
      expect(occ.supportStatus).toBeDefined();
      expect(typeof occ.supportStatus.preserved).toBe("boolean");
      expect(typeof occ.supportStatus.semanticRead).toBe("boolean");
      expect(typeof occ.supportStatus.layoutProjected).toBe("boolean");
    }
  });

  it("marks paragraph, run, table kinds as layoutProjected", async () => {
    const bytes = createTableDocx();
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const projectedKinds = ["paragraph", "run", "table", "tableRow", "tableCell", "section"];
    for (const kind of projectedKinds) {
      const occs = occurrencesOfKind(result, kind);
      for (const occ of occs) {
        expect(occ.supportStatus.layoutProjected).toBe(true);
      }
    }
  });
});

// ---- Text extraction --------------------------------------------------------

describe("analysis projection: text extraction", () => {
  it("extracts text from paragraph occurrences", async () => {
    const bytes = createMinimalDocx("Hello, World!");
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const paragraphs = occurrencesOfKind(result, "paragraph");
    const withText = paragraphs.filter((p) => p.text !== undefined);
    expect(withText.length).toBeGreaterThanOrEqual(1);
    expect(withText.some((p) => p.text!.includes("Hello, World!"))).toBe(true);
  });

  it("extracts text from all paragraphs in multi-paragraph docx", async () => {
    const texts = ["Alpha", "Beta", "Gamma"];
    const bytes = createMultiParagraphDocx(texts);
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const paragraphs = occurrencesOfKind(result, "paragraph");
    const extractedTexts = paragraphs
      .map((p) => p.text)
      .filter((t) => t !== undefined);

    for (const expected of texts) {
      expect(extractedTexts.some((t) => t!.includes(expected))).toBe(true);
    }
  });

  it("extracts style names from style occurrences", async () => {
    const bytes = createMinimalDocx("test");
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const styles = occurrencesOfKind(result, "style");
    expect(styles.length).toBeGreaterThanOrEqual(1);
    // At least the Normal style should have a text/name
    const normalStyle = styles.find(
      (s) => s.text === "Normal" || s.snapshot?.name === "Normal",
    );
    expect(normalStyle).toBeDefined();
  });
});

// ---- Entity count -----------------------------------------------------------

describe("analysis projection: entity count", () => {
  it("reports entityCount roughly matching total occurrences", async () => {
    const bytes = createMinimalDocx("Count test");
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    // entityCount comes from model.entityCount(), which should match
    // the number of occurrences since we iterate all entity kinds
    expect(result.entityCount).toBe(result.occurrences.length);
  });

  it("has more occurrences for complex docx than minimal", async () => {
    const minBytes = createMinimalDocx("Simple");
    const complexBytes = createComplexDocx();

    const minModel = await buildModelDirect(minBytes);
    const complexModel = await buildModelDirect(complexBytes);

    const minResult = projectToOccurrences(minModel, DOC_ID);
    const complexResult = projectToOccurrences(complexModel, DOC_ID);

    expect(complexResult.occurrences.length).toBeGreaterThan(
      minResult.occurrences.length,
    );
  });
});

// ---- Multi-story coverage ---------------------------------------------------

describe("analysis projection: multi-story", () => {
  it("includes occurrences from header and footer stories", async () => {
    const bytes = createComplexDocx();
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const kinds = new Set(result.occurrences.map((o) => o.entityKind));
    // Complex docx has header and footer parts
    expect(kinds.has("headerStory") || kinds.has("footerStory")).toBe(true);
  });

  it("includes comment-related entities from complex docx", async () => {
    const bytes = createComplexDocx();
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    // Complex docx has a comment range
    const commentRanges = occurrencesOfKind(result, "commentRange");
    expect(commentRanges.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- Snapshot properties ----------------------------------------------------

describe("analysis projection: snapshots", () => {
  it("includes styleId in paragraph snapshots", async () => {
    const bytes = createFormattedParagraphDocx();
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const paragraphs = occurrencesOfKind(result, "paragraph");
    const heading = paragraphs.find((p) => p.snapshot?.styleId === "Heading1");
    expect(heading).toBeDefined();
  });

  it("includes bold/italic in run snapshots", async () => {
    const bytes = createFormattedParagraphDocx();
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const runs = occurrencesOfKind(result, "run");
    const boldRun = runs.find((r) => r.snapshot?.bold === true);
    expect(boldRun).toBeDefined();

    const italicRun = runs.find((r) => r.snapshot?.italic === true);
    expect(italicRun).toBeDefined();
  });

  it("includes SDT metadata in content control snapshots", async () => {
    const bytes = createSdtDocx();
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const sdts = occurrencesOfKind(result, "contentControl");
    expect(sdts.length).toBeGreaterThanOrEqual(1);

    const withTag = sdts.find((s) => s.snapshot?.tag !== undefined);
    expect(withTag).toBeDefined();
  });

  it("includes field instruction metadata for field ranges", async () => {
    const bytes = createInlineSegmentsDocx();
    const model = await buildModelDirect(bytes);
    const result = projectToOccurrences(model, DOC_ID);

    const fieldRanges = occurrencesOfKind(result, "fieldRange");
    expect(fieldRanges.length).toBe(1);
    expect(fieldRanges[0].sourceRef?.sourceNodePath).toBe("w:body/w:p[3]/w:r[1]/w:fldChar[1]");
    expect(fieldRanges[0].snapshot?.instructionText).toBe(" PAGE ");
    expect(fieldRanges[0].snapshot?.fieldType).toBe("page");
  });
});

// ---- Trace chain ------------------------------------------------------------

describe("analysis projection: trace chain", () => {
  it("buildTraceChain returns a valid TraceEntry for a known entity", async () => {
    const bytes = createMinimalDocx("Trace test");
    const model = await buildModelDirect(bytes);
    // Expand so entities are available
    model.expandAllStories();

    const paragraphs = model.allEntities("paragraph");
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);

    const trace = buildTraceChain(model, paragraphs[0].ref);
    expect(trace).toBeDefined();
    expect(trace!.sourceRef).toBeDefined();
    expect(trace!.entityRef).toBeDefined();
    expect(trace!.entityRef.id).toBe(paragraphs[0].ref.id);
  });

  it("buildTraceChain includes a projectionRef when layout projection data is provided", async () => {
    const bytes = createTableDocx();
    const model = await buildModelDirect(bytes);
    const projection = projectToFlowBlocks(model);
    const paragraph = model.allParagraphs().find((entity) => {
      const text = model.runs(entity.ref)
        .flatMap((run) => model.segments(run.ref))
        .map((segment) => "text" in segment ? segment.text : "")
        .join("");
      return text.includes("Cell A");
    });

    expect(paragraph).toBeDefined();

    const trace = buildTraceChain(model, paragraph!.ref, projection.blockToEntityRef);
    expect(trace?.projectionRef?.id).toBeDefined();
    expect(trace?.projectionRef?.sourceEntityRef.id).toBe(paragraph!.ref.id);
  });

  it("buildTraceEntry returns undefined for entity without source refs", async () => {
    // Construct a mock entity without source refs to test the defensive path.
    // Since buildTraceEntry checks entity.sourceRefs[0], an entity with
    // empty sourceRefs should return undefined.
    const mockEntity = {
      ref: { id: "e:test:0" },
      kind: "paragraph" as const,
      sourceRefs: [] as any[],
      storyId: undefined,
      parentRef: undefined,
      childRefs: () => [],
      raw: () => ({}),
    };
    const result = buildTraceEntry(mockEntity as any);
    expect(result).toBeUndefined();
  });

  it("buildTraceChain returns undefined for unknown entityRef", async () => {
    const bytes = createMinimalDocx("Unknown ref");
    const model = await buildModelDirect(bytes);

    const trace = buildTraceChain(model, { id: "e:nonexistent:999" });
    expect(trace).toBeUndefined();
  });
});
