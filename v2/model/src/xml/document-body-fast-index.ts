import type { SourceSpan, XmlDocumentBodyBoundaryRecord, XmlDocumentBodyFastIndex, XmlPageGeometry } from '../types/xml.js';
import { assertUtf8Encoding } from './byte-mapping.js';
import { makeNodeId } from './node-id.js';

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const ASCII_DECODER = new TextDecoder('ascii');
const COMMENT_OPEN = encodeAscii('<!--');
const COMMENT_CLOSE = encodeAscii('-->');
const PROCESSING_INSTRUCTION_OPEN = encodeAscii('<?');
const PROCESSING_INSTRUCTION_CLOSE = encodeAscii('?>');
const CDATA_OPEN = encodeAscii('<![CDATA[');
const CDATA_CLOSE = encodeAscii(']]>');
const DECLARATION_OPEN = encodeAscii('<!');
const DEFAULT_PAGE_GEOMETRY: XmlPageGeometry = {
  width: 12240,
  height: 15840,
  margins: {
    top: 1440,
    right: 1440,
    bottom: 1440,
    left: 1440,
  },
};

type ElementFrame = {
  qname: string;
  prefix?: string;
  localName: string;
  startByte: number;
  isBodyChild: boolean;
  sectionGeometry?: XmlPageGeometry;
};

type ParsedOpenTag = {
  qname: string;
  prefix?: string;
  localName: string;
  endByteExclusive: number;
  selfClosing: boolean;
  attributesOffset: number;
};

type ParsedCloseTag = {
  qname: string;
  endByteExclusive: number;
};

/**
 * Build a lightweight body-boundary index for `/word/document.xml`.
 *
 * The scanner is byte-oriented and only tracks:
 * - the root open tag
 * - direct `w:body` child spans
 * - the last `w:sectPr` page geometry
 *
 * It intentionally does not build the generic lexical index used by the
 * later exact render-shell / structure stages.
 */
export function buildDocumentBodyFastIndex(bytes: Uint8Array, partUri: string): XmlDocumentBodyFastIndex {
  assertUtf8Encoding(bytes, partUri);

  const bodyChildRecords: XmlDocumentBodyBoundaryRecord[] = [];
  const stack: ElementFrame[] = [];
  const rootOpenTagSpan = { startByte: -1, endByte: -1 } satisfies SourceSpan;
  let rootQName = '';
  let primaryPageGeometry: XmlPageGeometry | undefined;
  let offset = getUtf8BomLength(bytes);

  while (offset < bytes.length) {
    const tagStartByte = findNextTagStart(bytes, offset);
    if (tagStartByte === -1) {
      break;
    }

    if (matchesBytes(bytes, tagStartByte, COMMENT_OPEN)) {
      offset = findMarkupEnd(bytes, tagStartByte + COMMENT_OPEN.length, COMMENT_CLOSE);
      continue;
    }

    if (matchesBytes(bytes, tagStartByte, PROCESSING_INSTRUCTION_OPEN)) {
      offset = findMarkupEnd(bytes, tagStartByte + PROCESSING_INSTRUCTION_OPEN.length, PROCESSING_INSTRUCTION_CLOSE);
      continue;
    }

    if (matchesBytes(bytes, tagStartByte, CDATA_OPEN)) {
      offset = findMarkupEnd(bytes, tagStartByte + CDATA_OPEN.length, CDATA_CLOSE);
      continue;
    }

    if (matchesBytes(bytes, tagStartByte, DECLARATION_OPEN)) {
      offset = findTagEnd(bytes, tagStartByte + 2);
      continue;
    }

    if (bytes[tagStartByte + 1] === 0x2f) {
      const closeTag = parseCloseTag(bytes, tagStartByte);
      closeElement(stack, closeTag, bodyChildRecords, partUri, (geometry) => {
        primaryPageGeometry = geometry;
      });
      offset = closeTag.endByteExclusive;
      continue;
    }

    const openTag = parseOpenTag(bytes, tagStartByte);
    if (!rootQName) {
      rootQName = openTag.qname;
      rootOpenTagSpan.startByte = tagStartByte;
      rootOpenTagSpan.endByte = openTag.endByteExclusive;
    }

    const parent = stack.at(-1);
    const isBodyChild = parent?.qname === 'w:body';
    const frame: ElementFrame = {
      qname: openTag.qname,
      prefix: openTag.prefix,
      localName: openTag.localName,
      startByte: tagStartByte,
      isBodyChild,
      ...(openTag.qname === 'w:sectPr' ? { sectionGeometry: clonePageGeometry(DEFAULT_PAGE_GEOMETRY) } : {}),
    };

    applySectionGeometryIfNeeded(bytes, openTag, stack, frame);

    if (openTag.selfClosing) {
      finalizeElement(frame, openTag.endByteExclusive, bodyChildRecords, partUri, (geometry) => {
        primaryPageGeometry = geometry;
      });
    } else {
      stack.push(frame);
    }

    offset = openTag.endByteExclusive;
  }

  if (!rootQName || rootOpenTagSpan.startByte < 0 || rootOpenTagSpan.endByte < 0) {
    throw new Error(`Failed to locate the root element while building fast index for ${partUri}`);
  }

  return {
    rootQName,
    rootOpenTagSpan,
    bodyChildRecords,
    ...(primaryPageGeometry ? { primaryPageGeometry } : {}),
  };
}

function closeElement(
  stack: ElementFrame[],
  closeTag: ParsedCloseTag,
  bodyChildRecords: XmlDocumentBodyBoundaryRecord[],
  partUri: string,
  setPrimaryPageGeometry: (geometry: XmlPageGeometry) => void,
): void {
  while (stack.length > 0) {
    const frame = stack.pop()!;
    finalizeElement(frame, closeTag.endByteExclusive, bodyChildRecords, partUri, setPrimaryPageGeometry);
    if (frame.qname === closeTag.qname) {
      return;
    }
  }
}

function finalizeElement(
  frame: ElementFrame,
  endByteExclusive: number,
  bodyChildRecords: XmlDocumentBodyBoundaryRecord[],
  partUri: string,
  setPrimaryPageGeometry: (geometry: XmlPageGeometry) => void,
): void {
  const fullSpan = {
    startByte: frame.startByte,
    endByte: endByteExclusive,
  } satisfies SourceSpan;

  if (frame.isBodyChild) {
    bodyChildRecords.push({
      id: makeNodeId(partUri, 'element', fullSpan),
      prefix: frame.prefix,
      localName: frame.localName,
      fullSpan,
    });
  }

  if (frame.qname === 'w:sectPr' && frame.sectionGeometry) {
    setPrimaryPageGeometry(frame.sectionGeometry);
  }
}

function applySectionGeometryIfNeeded(
  bytes: Uint8Array,
  openTag: ParsedOpenTag,
  stack: readonly ElementFrame[],
  frame: ElementFrame,
): void {
  const activeSection = openTag.qname === 'w:sectPr' ? frame : findActiveSectionFrame(stack);
  if (!activeSection?.sectionGeometry) {
    return;
  }

  if (openTag.qname === 'w:pgSz') {
    const width = readNumericAttribute(bytes, openTag, 'w:w');
    const height = readNumericAttribute(bytes, openTag, 'w:h');
    if (width !== undefined) activeSection.sectionGeometry.width = width;
    if (height !== undefined) activeSection.sectionGeometry.height = height;
    return;
  }

  if (openTag.qname === 'w:pgMar') {
    const top = readNumericAttribute(bytes, openTag, 'w:top');
    const right = readNumericAttribute(bytes, openTag, 'w:right');
    const bottom = readNumericAttribute(bytes, openTag, 'w:bottom');
    const left = readNumericAttribute(bytes, openTag, 'w:left');

    if (top !== undefined) activeSection.sectionGeometry.margins.top = top;
    if (right !== undefined) activeSection.sectionGeometry.margins.right = right;
    if (bottom !== undefined) activeSection.sectionGeometry.margins.bottom = bottom;
    if (left !== undefined) activeSection.sectionGeometry.margins.left = left;
  }
}

function parseOpenTag(bytes: Uint8Array, tagStartByte: number): ParsedOpenTag {
  let cursor = tagStartByte + 1;
  while (cursor < bytes.length && isWhitespaceByte(bytes[cursor])) {
    cursor += 1;
  }

  const nameStartByte = cursor;
  while (cursor < bytes.length && isNameByte(bytes[cursor])) {
    cursor += 1;
  }

  const qname = decodeAscii(bytes.subarray(nameStartByte, cursor));
  const { prefix, localName } = splitQualifiedName(qname);
  const endByteExclusive = findTagEnd(bytes, cursor);
  const selfClosing = isSelfClosingTag(bytes, tagStartByte, endByteExclusive);

  return {
    qname,
    prefix,
    localName,
    endByteExclusive,
    selfClosing,
    attributesOffset: cursor,
  };
}

function parseCloseTag(bytes: Uint8Array, tagStartByte: number): ParsedCloseTag {
  let cursor = tagStartByte + 2;
  while (cursor < bytes.length && isWhitespaceByte(bytes[cursor])) {
    cursor += 1;
  }

  const nameStartByte = cursor;
  while (cursor < bytes.length && isNameByte(bytes[cursor])) {
    cursor += 1;
  }

  return {
    qname: decodeAscii(bytes.subarray(nameStartByte, cursor)),
    endByteExclusive: findTagEnd(bytes, cursor),
  };
}

function readNumericAttribute(bytes: Uint8Array, openTag: ParsedOpenTag, attributeQName: string): number | undefined {
  const attributeValue = readAttribute(bytes, openTag, attributeQName);
  if (attributeValue === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(attributeValue, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function readAttribute(bytes: Uint8Array, openTag: ParsedOpenTag, attributeQName: string): string | undefined {
  let cursor = openTag.attributesOffset;
  const tagEndByte = openTag.endByteExclusive - 1;

  while (cursor < tagEndByte) {
    cursor = skipWhitespace(bytes, cursor, tagEndByte);
    if (cursor >= tagEndByte || bytes[cursor] === 0x2f) {
      return undefined;
    }

    const nameStartByte = cursor;
    while (cursor < tagEndByte && isAttributeNameByte(bytes[cursor])) {
      cursor += 1;
    }

    const candidateName = decodeAscii(bytes.subarray(nameStartByte, cursor));
    cursor = skipWhitespace(bytes, cursor, tagEndByte);

    if (cursor >= tagEndByte || bytes[cursor] !== 0x3d) {
      cursor = skipAttributeValue(bytes, cursor, tagEndByte);
      continue;
    }

    cursor += 1;
    cursor = skipWhitespace(bytes, cursor, tagEndByte);
    if (cursor >= tagEndByte || (bytes[cursor] !== 0x22 && bytes[cursor] !== 0x27)) {
      cursor = skipAttributeValue(bytes, cursor, tagEndByte);
      continue;
    }

    const quoteByte = bytes[cursor];
    const valueStartByte = cursor + 1;
    cursor = valueStartByte;
    while (cursor < tagEndByte && bytes[cursor] !== quoteByte) {
      cursor += 1;
    }

    const value = decodeAscii(bytes.subarray(valueStartByte, cursor));
    if (cursor < tagEndByte) {
      cursor += 1;
    }

    if (candidateName === attributeQName) {
      return value;
    }
  }

  return undefined;
}

function findTagEnd(bytes: Uint8Array, cursor: number): number {
  let inQuote: number | undefined;
  let position = cursor;

  while (position < bytes.length) {
    const byte = bytes[position];
    if (inQuote !== undefined) {
      if (byte === inQuote) {
        inQuote = undefined;
      }
      position += 1;
      continue;
    }

    if (byte === 0x22 || byte === 0x27) {
      inQuote = byte;
      position += 1;
      continue;
    }

    if (byte === 0x3e) {
      return position + 1;
    }

    position += 1;
  }

  return bytes.length;
}

function findMarkupEnd(bytes: Uint8Array, searchStartByte: number, markerBytes: Uint8Array): number {
  let cursor = searchStartByte;

  while (cursor < bytes.length) {
    if (matchesBytes(bytes, cursor, markerBytes)) {
      return cursor + markerBytes.length;
    }
    cursor += 1;
  }

  return bytes.length;
}

function findNextTagStart(bytes: Uint8Array, offset: number): number {
  for (let cursor = offset; cursor < bytes.length; cursor += 1) {
    if (bytes[cursor] === 0x3c) {
      return cursor;
    }
  }

  return -1;
}

function skipWhitespace(bytes: Uint8Array, cursor: number, limit: number): number {
  let position = cursor;
  while (position < limit && isWhitespaceByte(bytes[position])) {
    position += 1;
  }
  return position;
}

function skipAttributeValue(bytes: Uint8Array, cursor: number, limit: number): number {
  let position = cursor;
  while (position < limit && !isWhitespaceByte(bytes[position]) && bytes[position] !== 0x3e) {
    position += 1;
  }
  return position;
}

function isSelfClosingTag(bytes: Uint8Array, tagStartByte: number, endByteExclusive: number): boolean {
  let cursor = endByteExclusive - 2;
  while (cursor > tagStartByte && isWhitespaceByte(bytes[cursor])) {
    cursor -= 1;
  }

  return cursor > tagStartByte && bytes[cursor] === 0x2f;
}

function splitQualifiedName(qname: string): { prefix?: string; localName: string } {
  const separatorIndex = qname.indexOf(':');
  if (separatorIndex === -1) {
    return { localName: qname };
  }

  return {
    prefix: qname.slice(0, separatorIndex),
    localName: qname.slice(separatorIndex + 1),
  };
}

function clonePageGeometry(geometry: XmlPageGeometry): XmlPageGeometry {
  return {
    width: geometry.width,
    height: geometry.height,
    margins: {
      top: geometry.margins.top,
      right: geometry.margins.right,
      bottom: geometry.margins.bottom,
      left: geometry.margins.left,
    },
  };
}

function findActiveSectionFrame(stack: readonly ElementFrame[]): ElementFrame | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].qname === 'w:sectPr') {
      return stack[index];
    }
  }

  return undefined;
}

function isWhitespaceByte(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function isNameByte(byte: number): boolean {
  return isAttributeNameByte(byte);
}

function isAttributeNameByte(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    byte === 0x3a ||
    byte === 0x2d ||
    byte === 0x5f ||
    byte === 0x2e
  );
}

function matchesBytes(bytes: Uint8Array, offset: number, candidate: Uint8Array): boolean {
  if (offset + candidate.length > bytes.length) {
    return false;
  }

  for (let index = 0; index < candidate.length; index += 1) {
    if (bytes[offset + index] !== candidate[index]) {
      return false;
    }
  }

  return true;
}

function decodeAscii(bytes: Uint8Array): string {
  return ASCII_DECODER.decode(bytes);
}

function encodeAscii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function getUtf8BomLength(bytes: Uint8Array): number {
  if (bytes.length >= UTF8_BOM.length && UTF8_BOM.every((byte, index) => bytes[index] === byte)) {
    return UTF8_BOM.length;
  }

  return 0;
}
