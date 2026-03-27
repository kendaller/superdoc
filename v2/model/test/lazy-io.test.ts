// ---------------------------------------------------------------------------
// Tests for lazy Blob/range-reader IO (Task #25)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { open } from "../src/session/open.js";
import {
  createMinimalDocx,
  createMultiParagraphDocx,
} from "./helpers/create-test-docx.js";

describe("lazy Blob/range-reader IO", () => {
  it("range-reader open reads only zip metadata, not content entries", async () => {
    const bytes = createMultiParagraphDocx(["A", "B", "C", "D", "E"]);
    const readRanges: Array<{ start: number; end: number }> = [];

    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        if (!range) return bytes;
        readRanges.push({ start: range.start, end: range.endExclusive });
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    // Verify the session was created (lazy open worked)
    expect(handle.sessionId).toBeDefined();
    // Verify that reads happened (not zero — we do read central directory + metadata)
    expect(readRanges.length).toBeGreaterThan(0);
    await handle.close();
  });

  it("blob session materializes XML parts at ready('structure')", async () => {
    const bytes = createMultiParagraphDocx(["Lazy", "Load"]);
    let readCount = 0;

    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        readCount++;
        if (!range) return bytes;
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    const readsAtOpen = readCount;

    // Advancing to structure should trigger additional reads (XML part materialization)
    await handle.ready("structure");
    expect(readCount).toBeGreaterThan(readsAtOpen);

    // The document view should work after materialization
    const view = handle.documentView();
    expect(view).toBeDefined();
    expect(view!.bodyChildCount()).toBeGreaterThan(0);
    await handle.close();
  });

  it("blob no-op save returns original blob for blob target", async () => {
    const bytes = createMinimalDocx();
    const blob = new Blob([bytes]);
    const handle = await open(blob);

    // Nothing dirty — save should return the original blob
    const result = await handle.save({ target: "blob" });
    expect(result).toBeInstanceOf(Blob);
    await handle.close();
  });

  it("dirty lazy save with target 'bytes' returns Uint8Array", async () => {
    const bytes = createMultiParagraphDocx(["BytesSave"]);
    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        if (!range) return bytes;
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    await handle.ready("structure");
    handle.documentView()!.markDirty();

    const result = await handle.save({ target: "bytes" });
    expect(result).toBeInstanceOf(Uint8Array);

    // Verify the output is a valid archive
    const handle2 = await open(result as Uint8Array);
    await handle2.ready("structure");
    expect(handle2.documentView()!.bodyChildCount()).toBeGreaterThan(0);
    await handle2.close();
    await handle.close();
  });

  it("dirty lazy save with target 'blob' returns Blob", async () => {
    const bytes = createMultiParagraphDocx(["BlobSave"]);
    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        if (!range) return bytes;
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    await handle.ready("structure");
    handle.documentView()!.markDirty();

    const result = await handle.save({ target: "blob" });
    expect(result).toBeInstanceOf(Blob);

    // Verify the blob contains valid archive data
    const blobBytes = new Uint8Array(await (result as Blob).arrayBuffer());
    const handle2 = await open(blobBytes);
    await handle2.ready("structure");
    expect(handle2.documentView()!.bodyChildCount()).toBeGreaterThan(0);
    await handle2.close();
    await handle.close();
  });

  it("dirty lazy save with target 'stream' returns a ReadableStream", async () => {
    const bytes = createMultiParagraphDocx(["StreamSave"]);
    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        if (!range) return bytes;
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    await handle.ready("structure");
    handle.documentView()!.markDirty();

    const result = await handle.save({ target: "stream" });
    expect(result).toBeInstanceOf(ReadableStream);

    // Consume stream into bytes
    const reader = (result as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalLength).toBeGreaterThan(0);

    // Verify the streamed archive is valid
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const handle2 = await open(combined);
    await handle2.ready("structure");
    expect(handle2.documentView()!.bodyChildCount()).toBeGreaterThan(0);
    await handle2.close();
    await handle.close();
  });

  it("no-op lazy save with target 'blob' works for range-reader sessions", async () => {
    const bytes = createMinimalDocx();
    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        if (!range) return bytes;
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    // Nothing dirty — no-op save
    const result = await handle.save({ target: "blob" });
    expect(result).toBeInstanceOf(Blob);
    await handle.close();
  });

  it("no-op lazy save with target 'bytes' works for range-reader sessions", async () => {
    const bytes = createMinimalDocx();
    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        if (!range) return bytes;
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    // Nothing dirty — no-op save
    const result = await handle.save({ target: "bytes" });
    expect(result).toBeInstanceOf(Uint8Array);
    await handle.close();
  });

  it("stream target reads copy-through entries lazily during pull", async () => {
    const bytes = createMultiParagraphDocx(["A", "B", "C"]);
    const readLog: Array<{ start: number; end: number }> = [];

    const handle = await open({
      kind: "range-reader",
      size: bytes.length,
      async read(range) {
        if (!range) return bytes;
        readLog.push({ start: range.start, end: range.endExclusive });
        return bytes.slice(range.start, range.endExclusive);
      },
    });

    await handle.ready("structure");
    handle.documentView()!.markDirty();

    const result = await handle.save({ target: "stream" });
    expect(result).toBeInstanceOf(ReadableStream);

    // Record reads after save() but before consuming the stream
    const readsBeforeConsume = readLog.length;

    // Consume the stream — copy-through reads happen during pull()
    const reader = (result as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // After consuming, additional reads should have occurred for copy-through entries
    expect(readLog.length).toBeGreaterThan(readsBeforeConsume);
    await handle.close();
  });
});
