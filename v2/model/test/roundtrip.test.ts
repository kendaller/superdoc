// ---------------------------------------------------------------------------
// Archive fidelity tests — no-op round-trip must return exact input bytes
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import {
  createMinimalDocx,
  createMultiParagraphDocx,
  createComplexDocx,
} from "./helpers/create-test-docx.js";

describe("no-op round-trip", () => {
  it("returns exact input bytes for a minimal docx", async () => {
    const input = createMinimalDocx();
    const handle = await open(input);
    const output = await handle.save({ target: "bytes" });
    await handle.close();

    expect(output).toBeInstanceOf(Uint8Array);
    expect(output).toEqual(input);
  });

  it("returns exact input bytes for a multi-paragraph docx", async () => {
    const input = createMultiParagraphDocx([
      "First paragraph",
      "Second paragraph",
      "Third paragraph",
    ]);
    const handle = await open(input);
    const output = await handle.save({ target: "bytes" });
    await handle.close();

    expect(output).toEqual(input);
  });

  it("returns exact input bytes for a complex docx with headers/footers/comments", async () => {
    const input = createComplexDocx();
    const handle = await open(input);
    const output = await handle.save({ target: "bytes" });
    await handle.close();

    expect(output).toEqual(input);
  });

  it("works with explicit original-if-clean mode", async () => {
    const input = createMinimalDocx();
    const handle = await open(input);
    const output = await handle.save({ target: "bytes", mode: "original-if-clean" });
    await handle.close();

    expect(output).toEqual(input);
  });
});
