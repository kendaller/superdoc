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
  let byteIdx = getUtf8BomLength(bytes);

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
 * Create an incremental character-index -> byte-offset resolver.
 *
 * Unlike `buildCharToByteMap()`, this avoids allocating a full lookup table
 * for the entire XML document. It is intended for forward-only parser flows
 * like the lexical indexer, where requested character offsets are typically
 * monotonic. Backward lookups are still supported via a local rescan.
 */
export function createCharToByteResolver(text: string, bytes: Uint8Array): (charIndex: number) => number {
  const state = {
    charIndex: 0,
    byteOffset: getUtf8BomLength(bytes),
  };

  return (charIndex: number): number => {
    const normalizedIndex = clampCharIndex(charIndex, text.length);
    if (normalizedIndex < state.charIndex) {
      return resolveCharIndexFromStart(text, bytes, normalizedIndex);
    }

    advanceResolverState(text, state, normalizedIndex);
    return state.byteOffset;
  };
}

/**
 * Scan backwards from the parser's post-`>` position to find the `<`
 * that started the current open tag. In valid XML, `<` never appears
 * unescaped inside attribute values, so backwards scan is reliable.
 */
export function findOpenAngleBracket(text: string, positionAfterTag: number): number {
  let i = positionAfterTag - 1;
  while (i >= 0 && text.charAt(i) !== '<') {
    i--;
  }
  return Math.max(0, i);
}

function resolveCharIndexFromStart(text: string, bytes: Uint8Array, targetIndex: number): number {
  const state = {
    charIndex: 0,
    byteOffset: getUtf8BomLength(bytes),
  };
  advanceResolverState(text, state, targetIndex);
  return state.byteOffset;
}

function advanceResolverState(
  text: string,
  state: { charIndex: number; byteOffset: number },
  targetIndex: number,
): void {
  while (state.charIndex < targetIndex) {
    const code = text.charCodeAt(state.charIndex);

    if (code <= 0x7f) {
      state.byteOffset += 1;
      state.charIndex += 1;
      continue;
    }

    if (code <= 0x7ff) {
      state.byteOffset += 2;
      state.charIndex += 1;
      continue;
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      state.byteOffset += 4;
      state.charIndex += 2;
      continue;
    }

    state.byteOffset += 3;
    state.charIndex += 1;
  }
}

function clampCharIndex(charIndex: number, maxLength: number): number {
  if (!Number.isFinite(charIndex) || charIndex <= 0) {
    return 0;
  }

  return Math.min(maxLength, Math.trunc(charIndex));
}

function getUtf8BomLength(bytes: Uint8Array): number {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 3;
  }

  return 0;
}

/** Detect the encoding of an XML part from its BOM. */
export function detectXmlEncoding(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  }
  return 'utf-8';
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
  const label = partUri ?? 'XML part';

  // Check BOM
  const bomEncoding = detectXmlEncoding(bytes);
  if (bomEncoding !== 'utf-8') {
    throw new Error(
      `Unsupported encoding "${bomEncoding}" detected via BOM in ${label}. ` + `Only UTF-8 is supported.`,
    );
  }

  // Check the XML declaration's encoding attribute.
  // The declaration is ASCII-safe, so reading the first ~200 bytes is enough.
  const previewLen = Math.min(bytes.length, 200);
  const preview = new TextDecoder('ascii').decode(bytes.subarray(0, previewLen));
  const match = preview.match(/encoding\s*=\s*["']([^"']*)["']/i);
  if (match) {
    const declared = match[1].toLowerCase();
    if (declared !== 'utf-8') {
      throw new Error(
        `Unsupported encoding "${match[1]}" declared in XML declaration of ${label}. ` + `Only UTF-8 is supported.`,
      );
    }
  }
}
