// ---------------------------------------------------------------------------
// Tests for XML encoding detection and UTF-8 enforcement
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { assertUtf8Encoding, detectXmlEncoding } from "../src/xml/byte-mapping.js";

describe("detectXmlEncoding", () => {
  it("returns utf-8 for plain bytes", () => {
    const bytes = new TextEncoder().encode("<?xml version='1.0'?><root/>");
    expect(detectXmlEncoding(bytes)).toBe("utf-8");
  });

  it("returns utf-8 for UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x3f]);
    expect(detectXmlEncoding(bytes)).toBe("utf-8");
  });

  it("returns utf-16le for UTF-16LE BOM", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x3c, 0x00]);
    expect(detectXmlEncoding(bytes)).toBe("utf-16le");
  });

  it("returns utf-16be for UTF-16BE BOM", () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x3c]);
    expect(detectXmlEncoding(bytes)).toBe("utf-16be");
  });
});

describe("assertUtf8Encoding", () => {
  it("accepts plain UTF-8 without BOM", () => {
    const bytes = new TextEncoder().encode('<?xml version="1.0"?><root/>');
    expect(() => assertUtf8Encoding(bytes, "/test.xml")).not.toThrow();
  });

  it("accepts UTF-8 with BOM", () => {
    const xml = new TextEncoder().encode('<?xml version="1.0"?><root/>');
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...xml]);
    expect(() => assertUtf8Encoding(bytes, "/test.xml")).not.toThrow();
  });

  it('accepts encoding="UTF-8" in declaration', () => {
    const bytes = new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8"?><root/>',
    );
    expect(() => assertUtf8Encoding(bytes)).not.toThrow();
  });

  it('accepts encoding="utf-8" (lowercase) in declaration', () => {
    const bytes = new TextEncoder().encode(
      '<?xml version="1.0" encoding="utf-8"?><root/>',
    );
    expect(() => assertUtf8Encoding(bytes)).not.toThrow();
  });

  it("throws for UTF-16LE BOM", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x3c, 0x00]);
    expect(() => assertUtf8Encoding(bytes, "/bad.xml")).toThrow(
      /utf-16le.*BOM.*\/bad\.xml/i,
    );
  });

  it("throws for UTF-16BE BOM", () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x3c]);
    expect(() => assertUtf8Encoding(bytes, "/bad.xml")).toThrow(
      /utf-16be.*BOM.*\/bad\.xml/i,
    );
  });

  it('throws for encoding="windows-1252" in declaration', () => {
    const bytes = new TextEncoder().encode(
      '<?xml version="1.0" encoding="windows-1252"?><root/>',
    );
    expect(() => assertUtf8Encoding(bytes, "/latin.xml")).toThrow(
      /windows-1252.*declaration.*\/latin\.xml/i,
    );
  });

  it('throws for encoding="UTF-16" in declaration', () => {
    const bytes = new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-16"?><root/>',
    );
    expect(() => assertUtf8Encoding(bytes)).toThrow(/UTF-16.*declaration/i);
  });

  it("accepts bytes with no XML declaration", () => {
    const bytes = new TextEncoder().encode("<root><child/></root>");
    expect(() => assertUtf8Encoding(bytes)).not.toThrow();
  });
});
