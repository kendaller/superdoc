// ---------------------------------------------------------------------------
// Tests for streaming save (Task #18)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import {
  createMinimalDocx,
  createMultiParagraphDocx,
} from "./helpers/create-test-docx.js";
import type { XmlElementNode } from "../src/types/xml.js";

describe("streaming save", () => {
  it("save({target:'stream'}) returns a ReadableStream with multiple chunks", async () => {
    const bytes = createMinimalDocx();
    const handle = await open(bytes);
    await handle.ready("structure");

    // Mutate to trigger dirty save (which has more chunks)
    const view = handle.documentView()!;
    const root = view.rootElement()!;
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
    if (t.children[0].kind === "text") t.children[0].value = "Streamed";
    view.markDirty();

    const result = await handle.save({ target: "stream" });
    expect(result).toBeInstanceOf(ReadableStream);

    // Read all chunks from the stream
    const reader = (result as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Should have multiple chunks (local headers + central dir + EOCD)
    expect(chunks.length).toBeGreaterThan(1);

    // Concatenated result should be a valid archive
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalLength).toBeGreaterThan(0);

    await handle.close();
  });

  it("streamed dirty save produces a valid re-openable archive", async () => {
    const handle = await open(createMultiParagraphDocx(["Stream", "Test"]));
    await handle.ready("structure");

    const view = handle.documentView()!;
    const first = view.bodyChild(0)!;
    const run = first.element.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    );
    const t = run?.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    );
    if (t && t.children[0].kind === "text") t.children[0].value = "StreamedOK";
    view.markDirty();

    const stream = await handle.save({ target: "stream" }) as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    await handle.close();

    // Concatenate and re-open
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { combined.set(c, off); off += c.length; }

    const handle2 = await open(combined);
    await handle2.ready("structure");
    const view2 = handle2.documentView()!;
    expect(view2.bodyChildCount()).toBe(3); // 2 paragraphs + sectPr
    await handle2.close();
  });
});
