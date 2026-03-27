import { describe, it, expect } from 'vitest';
import { detectXmlEncoding, decodeXmlBytes, looksLikeXml } from '../../src/raw-surface/xml-bytes.js';

const encoder = new TextEncoder();

describe('detectXmlEncoding', () => {
  it('detects UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x3f]);
    expect(detectXmlEncoding(bytes)).toBe('utf-8');
  });

  it('detects UTF-16LE BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x3c, 0x00]);
    expect(detectXmlEncoding(bytes)).toBe('utf-16le');
  });

  it('detects UTF-16BE BOM', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x3c]);
    expect(detectXmlEncoding(bytes)).toBe('utf-16be');
  });

  it('detects UTF-16LE without BOM from byte pattern', () => {
    const bytes = new Uint8Array([0x3c, 0x00, 0x3f, 0x00]);
    expect(detectXmlEncoding(bytes)).toBe('utf-16le');
  });

  it('detects UTF-16BE without BOM from byte pattern', () => {
    const bytes = new Uint8Array([0x00, 0x3c, 0x00, 0x3f]);
    expect(detectXmlEncoding(bytes)).toBe('utf-16be');
  });

  it('defaults to UTF-8 for standard XML', () => {
    const bytes = encoder.encode('<?xml version="1.0"?>');
    expect(detectXmlEncoding(bytes)).toBe('utf-8');
  });

  it('defaults to UTF-8 for empty input', () => {
    expect(detectXmlEncoding(new Uint8Array())).toBe('utf-8');
  });
});

describe('decodeXmlBytes', () => {
  it('decodes UTF-8 content', () => {
    const bytes = encoder.encode('<root/>');
    expect(decodeXmlBytes(bytes)).toBe('<root/>');
  });

  it('handles UTF-8 BOM', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const content = encoder.encode('<root/>');
    const withBom = new Uint8Array([...bom, ...content]);
    // BOM is included in decode output but doesn't break parsing
    expect(decodeXmlBytes(withBom)).toContain('<root/>');
  });
});

describe('looksLikeXml', () => {
  it('returns true for XML content', () => {
    expect(looksLikeXml(encoder.encode('<?xml version="1.0"?><root/>'))).toBe(true);
  });

  it('returns true for XML with leading whitespace', () => {
    expect(looksLikeXml(encoder.encode('  \n  <root/>'))).toBe(true);
  });

  it('returns false for empty bytes', () => {
    expect(looksLikeXml(new Uint8Array())).toBe(false);
  });

  it('returns false for binary content', () => {
    expect(looksLikeXml(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe(false);
  });

  it('returns true for UTF-16LE BOM XML', () => {
    const body = Buffer.from('<root/>', 'utf16le');
    const withBom = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
    expect(looksLikeXml(withBom)).toBe(true);
  });
});
