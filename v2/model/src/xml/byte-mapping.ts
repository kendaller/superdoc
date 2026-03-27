// ---------------------------------------------------------------------------
// Shared UTF-8 character-to-byte mapping
//
// Maps JavaScript string character indices to byte offsets in the
// original UTF-8 encoded bytes. Used by both the indexer and hydrator
// for accurate SourceSpan computation.
// ---------------------------------------------------------------------------

/**
 * Build a mapping from JS string character index → UTF-8 byte offset.
 *
 * The resulting Uint32Array has length text.length + 1, where map[i] gives
 * the byte offset of the i-th character and map[text.length] gives the
 * total byte length (excluding BOM).
 */
export function buildCharToByteMap(text: string, bytes: Uint8Array): Uint32Array {
  const map = new Uint32Array(text.length + 1);
  let byteIdx = 0;

  // Skip UTF-8 BOM
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    byteIdx = 3;
  }

  for (let i = 0; i < text.length; i++) {
    map[i] = byteIdx;
    const code = text.charCodeAt(i);

    if (code <= 0x7f) {
      byteIdx += 1;
    } else if (code <= 0x7ff) {
      byteIdx += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair — 4 UTF-8 bytes for 2 JS chars
      byteIdx += 4;
      i++;
      if (i < text.length) map[i] = byteIdx;
    } else {
      byteIdx += 3;
    }
  }

  map[text.length] = byteIdx;
  return map;
}

/**
 * Scan backwards from the parser's post-`>` position to find the `<`
 * that started the current open tag. In valid XML, `<` never appears
 * unescaped inside attribute values, so backwards scan is reliable.
 */
export function findOpenAngleBracket(text: string, positionAfterTag: number): number {
  let i = positionAfterTag - 1;
  while (i >= 0 && text.charAt(i) !== "<") {
    i--;
  }
  return Math.max(0, i);
}

/** Detect the encoding of an XML part from its BOM. */
export function detectXmlEncoding(
  bytes: Uint8Array,
): "utf-8" | "utf-16le" | "utf-16be" {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  }
  return "utf-8";
}

/**
 * Validate that the XML bytes are UTF-8 encoded.
 *
 * Checks both the byte-order mark and the XML declaration's `encoding`
 * attribute. Throws a descriptive error if a non-UTF-8 encoding is
 * detected, rather than silently producing garbage text.
 *
 * UTF-8 with or without BOM is accepted.
 */
export function assertUtf8Encoding(bytes: Uint8Array, partUri?: string): void {
  const label = partUri ?? "XML part";

  // Check BOM
  const bomEncoding = detectXmlEncoding(bytes);
  if (bomEncoding !== "utf-8") {
    throw new Error(
      `Unsupported encoding "${bomEncoding}" detected via BOM in ${label}. ` +
      `Only UTF-8 is supported.`,
    );
  }

  // Check the XML declaration's encoding attribute.
  // The declaration is ASCII-safe, so reading the first ~200 bytes is enough.
  const previewLen = Math.min(bytes.length, 200);
  const preview = new TextDecoder("ascii").decode(bytes.subarray(0, previewLen));
  const match = preview.match(/encoding\s*=\s*["']([^"']*)["']/i);
  if (match) {
    const declared = match[1].toLowerCase();
    if (declared !== "utf-8") {
      throw new Error(
        `Unsupported encoding "${match[1]}" declared in XML declaration of ${label}. ` +
        `Only UTF-8 is supported.`,
      );
    }
  }
}
