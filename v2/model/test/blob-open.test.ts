// ---------------------------------------------------------------------------
// Tests for Blob / range-reader open paths (Task #10)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import { createMinimalDocx } from "./helpers/create-test-docx.js";

describe("Blob open", () => {
  it("opens a .docx from a Blob", async () => {
    const bytes = createMinimalDocx();
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const handle = await open(blob);

    expect(handle.sessionId).toBeDefined();
    const status = await handle.status();
    expect(status.metrics.partCount).toBeGreaterThan(0);
    await handle.close();
  });

  it("opens from a blob ArchiveByteSource", async () => {
    const bytes = createMinimalDocx();
    const blob = new Blob([bytes]);
    const handle = await open({ kind: "blob", blob, size: bytes.length });

    expect(handle.sessionId).toBeDefined();
    await handle.close();
  });

  it("opens from a range-reader ArchiveByteSource", async () => {
    const bytes = createMinimalDocx();
    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        if (!range) return bytes;
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    expect(handle.sessionId).toBeDefined();
    await handle.close();
  });
});
