// ---------------------------------------------------------------------------
// Session and handle lifecycle tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import { createMinimalDocx, createComplexDocx } from "./helpers/create-test-docx.js";

describe("open()", () => {
  it("returns a DocumentHandle with a sessionId", async () => {
    const input = createMinimalDocx();
    const handle = await open(input);

    expect(handle.sessionId).toBeDefined();
    expect(typeof handle.sessionId).toBe("string");
    await handle.close();
  });

  it("accepts Uint8Array directly", async () => {
    const input = createMinimalDocx();
    const handle = await open(input);

    expect(handle.sessionId).toBeDefined();
    await handle.close();
  });

  it("accepts ArchiveByteSource", async () => {
    const input = createMinimalDocx();
    const handle = await open({ kind: "memory", bytes: input });

    expect(handle.sessionId).toBeDefined();
    await handle.close();
  });

  it("throws on invalid ZIP", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(open(garbage)).rejects.toThrow();
  });
});

describe("ready stages", () => {
  it("can advance to fast-open (already there after open)", async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready("fast-open");
    const status = await handle.status();
    expect(["fast-open", "structure"]).toContain(status.currentStage);
    await handle.close();
  });

  it("can advance to structure stage", async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready("structure");
    const status = await handle.status();
    expect(status.currentStage).toBe("structure");
    await handle.close();
  });

});

describe("status()", () => {
  it("returns correct metrics for minimal docx", async () => {
    const handle = await open(createMinimalDocx());
    const status = await handle.status();

    expect(status.metrics.partCount).toBeGreaterThan(0);
    expect(status.metrics.xmlPartCount).toBeGreaterThan(0);
    expect(status.metrics.binaryPartCount).toBe(0);
    await handle.close();
  });

  it("returns correct metrics for complex docx", async () => {
    const handle = await open(createComplexDocx());
    const status = await handle.status();

    expect(status.metrics.xmlPartCount).toBeGreaterThan(3);
    expect(status.metrics.binaryPartCount).toBeGreaterThan(0);
    await handle.close();
  });

  it("reports indexed parts after structure stage", async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready("structure");
    const status = await handle.status();

    expect(status.metrics.indexedXmlPartCount).toBeGreaterThan(0);
    await handle.close();
  });
});

describe("close()", () => {
  it("prevents further operations", async () => {
    const handle = await open(createMinimalDocx());
    await handle.close();

    await expect(handle.status()).rejects.toThrow("closed");
    await expect(handle.save()).rejects.toThrow("closed");
  });
});
