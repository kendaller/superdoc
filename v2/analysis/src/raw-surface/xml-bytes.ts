// ---------------------------------------------------------------------------
// XML Byte Handling
// ---------------------------------------------------------------------------
// Low-level XML byte sniffing and decoding for the raw-surface scanner.
// This remains independent from v2/model while still handling common XML
// encodings found in OOXML packages.
// ---------------------------------------------------------------------------

export type XmlEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

/** Detect the XML encoding from BOM or leading byte patterns. */
export function detectXmlEncoding(bytes: Uint8Array): XmlEncoding {
  if (bytes.length >= 3 && bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2]) {
    return 'utf-8';
  }

  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  }

  if (bytes.length >= 4) {
    // UTF-16 without BOM still has a distinctive leading "<" pattern.
    if (bytes[0] === 0x3c && bytes[1] === 0x00) return 'utf-16le';
    if (bytes[0] === 0x00 && bytes[1] === 0x3c) return 'utf-16be';
  }

  return 'utf-8';
}

/** Decode XML bytes using the detected BOM/byte-pattern encoding. */
export function decodeXmlBytes(bytes: Uint8Array): string {
  const encoding = detectXmlEncoding(bytes);
  return new TextDecoder(encoding, { fatal: false }).decode(bytes);
}

/** Check whether bytes look like XML after conservative decoding/sniffing. */
export function looksLikeXml(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;

  try {
    const previewLength = Math.min(bytes.length, 256);
    const preview = decodeXmlBytes(bytes.subarray(0, previewLength));
    return preview.trimStart().startsWith('<');
  } catch {
    return false;
  }
}
