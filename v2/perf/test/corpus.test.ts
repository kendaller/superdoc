import { describe, it, expect } from "vitest";
import {
  DEFAULT_CORPUS_MANIFEST,
  DOCUMENT_CLASSES,
  entriesByClass,
  entriesByProfile,
  getEntry,
  isManifestPopulated,
} from "../src/corpus.js";

describe("corpus manifest", () => {
  it("defines all four document classes", () => {
    expect(DOCUMENT_CLASSES).toHaveProperty("A");
    expect(DOCUMENT_CLASSES).toHaveProperty("B");
    expect(DOCUMENT_CLASSES).toHaveProperty("C");
    expect(DOCUMENT_CLASSES).toHaveProperty("D");
  });

  it("default manifest has entries for all classes", () => {
    const classA = entriesByClass(DEFAULT_CORPUS_MANIFEST, "A");
    const classB = entriesByClass(DEFAULT_CORPUS_MANIFEST, "B");
    const classC = entriesByClass(DEFAULT_CORPUS_MANIFEST, "C");
    const classD = entriesByClass(DEFAULT_CORPUS_MANIFEST, "D");

    expect(classA.length).toBeGreaterThanOrEqual(1);
    expect(classB.length).toBeGreaterThanOrEqual(1);
    expect(classC.length).toBeGreaterThanOrEqual(1);
    expect(classD.length).toBeGreaterThanOrEqual(1);
  });

  it("all entries have unique IDs", () => {
    const ids = DEFAULT_CORPUS_MANIFEST.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all entries have non-empty labels and descriptions", () => {
    for (const entry of DEFAULT_CORPUS_MANIFEST.entries) {
      expect(entry.label, `entry ${entry.id} label`).toBeTruthy();
      expect(entry.description, `entry ${entry.id} description`).toBeTruthy();
    }
  });

  it("all entries have at least one content profile", () => {
    for (const entry of DEFAULT_CORPUS_MANIFEST.entries) {
      expect(entry.profiles.length, `entry ${entry.id} profiles`).toBeGreaterThanOrEqual(1);
    }
  });

  it("getEntry() retrieves by ID", () => {
    const entry = getEntry(DEFAULT_CORPUS_MANIFEST, "a-simple-business");
    expect(entry).toBeDefined();
    expect(entry!.class).toBe("A");
  });

  it("getEntry() returns undefined for nonexistent ID", () => {
    expect(getEntry(DEFAULT_CORPUS_MANIFEST, "nonexistent")).toBeUndefined();
  });

  it("entriesByProfile() filters correctly", () => {
    const tableEntries = entriesByProfile(DEFAULT_CORPUS_MANIFEST, "tables");
    expect(tableEntries.length).toBeGreaterThanOrEqual(1);
    for (const entry of tableEntries) {
      expect(entry.profiles).toContain("tables");
    }
  });

  it("isManifestPopulated() is false for default (placeholder) manifest", () => {
    // Default manifest has empty paths and 0 bytes
    expect(isManifestPopulated(DEFAULT_CORPUS_MANIFEST)).toBe(false);
  });

  it("isManifestPopulated() is true when entries have real data", () => {
    const populated = {
      ...DEFAULT_CORPUS_MANIFEST,
      entries: [
        { ...DEFAULT_CORPUS_MANIFEST.entries[0], path: "/real/path.docx", bytes: 50000 },
      ],
    };
    expect(isManifestPopulated(populated)).toBe(true);
  });
});
