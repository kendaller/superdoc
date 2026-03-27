// ---------------------------------------------------------------------------
// ZIP reader/writer tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseZipSnapshot, inflateEntry } from "../src/opc/zip-reader.js";
import { buildZipArchive } from "../src/opc/zip-writer.js";
import type { ZipNewEntry } from "../src/opc/zip-writer.js";

function entry(name: string, content: string): ZipNewEntry {
  return {
    kind: "new",
    name,
    uncompressedBytes: new TextEncoder().encode(content),
  };
}

describe("ZIP round-trip", () => {
  it("writes and reads back entries", () => {
    const archive = buildZipArchive([
      entry("hello.txt", "Hello!"),
      entry("dir/nested.xml", "<root/>"),
    ]);

    const snapshot = parseZipSnapshot(archive);
    expect(snapshot.entries.length).toBe(2);
    expect(snapshot.entries[0].name).toBe("hello.txt");
    expect(snapshot.entries[1].name).toBe("dir/nested.xml");

    const content1 = new TextDecoder().decode(inflateEntry(archive, snapshot.entries[0]));
    expect(content1).toBe("Hello!");

    const content2 = new TextDecoder().decode(inflateEntry(archive, snapshot.entries[1]));
    expect(content2).toBe("<root/>");
  });

  it("preserves entry order", () => {
    const archive = buildZipArchive([
      entry("c.txt", "c"),
      entry("a.txt", "a"),
      entry("b.txt", "b"),
    ]);

    const snapshot = parseZipSnapshot(archive);
    expect(snapshot.entryOrder.length).toBe(3);
    expect(snapshot.entries[0].name).toBe("c.txt");
    expect(snapshot.entries[1].name).toBe("a.txt");
    expect(snapshot.entries[2].name).toBe("b.txt");
  });

  it("handles empty files", () => {
    const archive = buildZipArchive([
      entry("empty.txt", ""),
    ]);

    const snapshot = parseZipSnapshot(archive);
    expect(snapshot.entries[0].uncompressedSize).toBe(0);

    const content = inflateEntry(archive, snapshot.entries[0]);
    expect(content.length).toBe(0);
  });

  it("handles binary data", () => {
    const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253]);
    const archive = buildZipArchive([
      { kind: "new", name: "binary.bin", uncompressedBytes: binaryData },
    ]);

    const snapshot = parseZipSnapshot(archive);
    const restored = inflateEntry(archive, snapshot.entries[0]);
    expect(restored).toEqual(binaryData);
  });

  it("copy-through preserves exact local record bytes", () => {
    const original = buildZipArchive([
      entry("a.txt", "original content for a"),
      entry("b.txt", "original content for b"),
    ]);

    const snapshot = parseZipSnapshot(original);

    // Copy through entry 0, replace entry 1
    const rebuilt = buildZipArchive([
      {
        kind: "copy-through",
        entry: snapshot.entries[0],
        archiveBytes: original,
      },
      entry("b.txt", "new content for b"),
    ]);

    const newSnapshot = parseZipSnapshot(rebuilt);
    expect(newSnapshot.entries.length).toBe(2);

    const a = new TextDecoder().decode(inflateEntry(rebuilt, newSnapshot.entries[0]));
    expect(a).toBe("original content for a");

    const b = new TextDecoder().decode(inflateEntry(rebuilt, newSnapshot.entries[1]));
    expect(b).toBe("new content for b");
  });
});

describe("ZIP error handling", () => {
  it("throws on invalid ZIP data", () => {
    expect(() => parseZipSnapshot(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("throws on truncated archive", () => {
    const archive = buildZipArchive([entry("test.txt", "data")]);
    const truncated = archive.slice(0, 10);
    expect(() => parseZipSnapshot(truncated)).toThrow();
  });
});
