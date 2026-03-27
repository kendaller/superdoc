// ---------------------------------------------------------------------------
// Tests for OPC serialization (relationships, content types)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  parseRelationships,
  serializeRelationships,
} from "../src/opc/relationships.js";
import {
  parseContentTypes,
  serializeContentTypes,
} from "../src/opc/content-types.js";

describe("serializeRelationships", () => {
  const SAMPLE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`;

  it("round-trips parsed relationships back to equivalent XML", () => {
    const parsed = parseRelationships(SAMPLE_RELS);
    const serialized = serializeRelationships(parsed);
    const reparsed = parseRelationships(serialized);

    expect(reparsed.size).toBe(parsed.size);
    for (const [id, rel] of parsed) {
      const reparsedRel = reparsed.get(id);
      expect(reparsedRel).toBeDefined();
      expect(reparsedRel!.type).toBe(rel.type);
      expect(reparsedRel!.target).toBe(rel.target);
      expect(reparsedRel!.targetMode).toBe(rel.targetMode);
    }
  });

  it("preserves TargetMode for external relationships", () => {
    const parsed = parseRelationships(SAMPLE_RELS);
    const serialized = serializeRelationships(parsed);

    expect(serialized).toContain('TargetMode="External"');
  });

  it("serializes an empty relationship map", () => {
    const empty = new Map();
    const serialized = serializeRelationships(empty);
    const reparsed = parseRelationships(serialized);
    expect(reparsed.size).toBe(0);
  });
});

describe("serializeContentTypes", () => {
  const SAMPLE_CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  it("round-trips parsed content types back to equivalent XML", () => {
    const parsed = parseContentTypes(SAMPLE_CT);
    const serialized = serializeContentTypes(parsed);
    const reparsed = parseContentTypes(serialized);

    expect(reparsed.defaults.size).toBe(parsed.defaults.size);
    for (const [ext, ct] of parsed.defaults) {
      expect(reparsed.defaults.get(ext)).toBe(ct);
    }

    expect(reparsed.overrides.size).toBe(parsed.overrides.size);
    for (const [uri, ct] of parsed.overrides) {
      expect(reparsed.overrides.get(uri)).toBe(ct);
    }
  });

  it("serializes an empty model", () => {
    const empty = { defaults: new Map(), overrides: new Map() };
    const serialized = serializeContentTypes(empty);
    const reparsed = parseContentTypes(serialized);
    expect(reparsed.defaults.size).toBe(0);
    expect(reparsed.overrides.size).toBe(0);
  });
});
