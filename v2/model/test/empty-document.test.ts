// ---------------------------------------------------------------------------
// Tests for empty document edge cases
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import { createEmptyDocx } from "./helpers/create-test-docx.js";

describe("empty document (body with only sectPr)", () => {
  it("opens without errors", async () => {
    const handle = await open(createEmptyDocx());
    await handle.ready("structure");
    const status = await handle.status();
    expect(status.metrics.partCount).toBeGreaterThan(0);
    await handle.close();
  });

  it("bodyChildCount() returns 1 for the sectPr", async () => {
    const handle = await open(createEmptyDocx());
    await handle.ready("structure");
    const view = handle.documentView()!;
    expect(view.bodyChildCount()).toBe(1);
    await handle.close();
  });

  it("bodyChildren() returns just the sectPr", async () => {
    const handle = await open(createEmptyDocx());
    await handle.ready("structure");
    const view = handle.documentView()!;
    const children = view.bodyChildren();
    expect(children).toHaveLength(1);
    expect(children[0].localName).toBe("sectPr");
    await handle.close();
  });

  it("sections() finds the sectPr", async () => {
    const handle = await open(createEmptyDocx());
    await handle.ready("structure");
    const view = handle.documentView()!;
    expect(view.sections()).toHaveLength(1);
    await handle.close();
  });

  it("round-trips correctly", async () => {
    const input = createEmptyDocx();
    const handle = await open(input);
    const output = await handle.save({ target: "bytes" });
    await handle.close();

    expect(output).toEqual(input);

    // Re-open the saved output
    const handle2 = await open(output as Uint8Array);
    await handle2.ready("structure");
    expect(handle2.documentView()!.bodyChildCount()).toBe(1);
    await handle2.close();
  });

  it("rootElement() works on empty document", async () => {
    const handle = await open(createEmptyDocx());
    await handle.ready("structure");
    const root = handle.documentView()!.rootElement();
    expect(root).toBeDefined();
    expect(root!.localName).toBe("document");
    await handle.close();
  });
});

describe("empty document (truly empty body)", () => {
  it("opens without errors", async () => {
    const handle = await open(createEmptyDocx({ includeSectPr: false }));
    await handle.ready("structure");
    const status = await handle.status();
    expect(status.metrics.partCount).toBeGreaterThan(0);
    await handle.close();
  });

  it("bodyChildCount() returns 0", async () => {
    const handle = await open(createEmptyDocx({ includeSectPr: false }));
    await handle.ready("structure");
    expect(handle.documentView()!.bodyChildCount()).toBe(0);
    await handle.close();
  });

  it("bodyChildren() returns empty array", async () => {
    const handle = await open(createEmptyDocx({ includeSectPr: false }));
    await handle.ready("structure");
    expect(handle.documentView()!.bodyChildren()).toEqual([]);
    await handle.close();
  });

  it("round-trips correctly", async () => {
    const input = createEmptyDocx({ includeSectPr: false });
    const handle = await open(input);
    const output = await handle.save({ target: "bytes" });
    await handle.close();
    expect(output).toEqual(input);
  });
});
