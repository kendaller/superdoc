// ---------------------------------------------------------------------------
// Run property extractor + inline segment parser
//
// Reads a `w:r` element and extracts:
//   1. Run formatting from `w:rPr`
//   2. Inline segment sequence from remaining children
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { RunFormatting, RunRawProperties } from "../entities/types.js";
import type { InlineSegment } from "../entities/inline-segments.js";
import { findChildElement, getAttr, getTextContent } from "../word/tree-helpers.js";
import { readToggle, readVal, readNumericVal, readShading } from "./xml-helpers.js";

export function extractRunProperties(element: XmlElementNode): RunRawProperties {
  const rPr = findChildElement(element, "rPr", "w");
  return {
    formatting: rPr ? extractRunFormatting(rPr) : {},
    segments: extractInlineSegments(element),
  };
}

/** Extract run formatting from a `w:rPr` element. Reused by paragraph mark rPr. */
export function extractRunFormatting(rPr: XmlElementNode): RunFormatting {
  return {
    rStyle: readVal(rPr, "rStyle"),
    bold: readToggle(rPr, "b"),
    boldCs: readToggle(rPr, "bCs"),
    italic: readToggle(rPr, "i"),
    italicCs: readToggle(rPr, "iCs"),
    underline: readVal(rPr, "u"),
    strike: readToggle(rPr, "strike"),
    dstrike: readToggle(rPr, "dStrike"),
    fontSize: readHalfPointSize(rPr, "sz"),
    fontSizeCs: readHalfPointSize(rPr, "szCs"),
    fontFamily: readFontFamily(rPr),
    fontFamilyCs: readFontFamilyCs(rPr),
    color: readColorVal(rPr),
    highlight: readVal(rPr, "highlight"),
    vertAlign: readVal(rPr, "vertAlign"),
    caps: readToggle(rPr, "caps"),
    smallCaps: readToggle(rPr, "smallCaps"),
    vanish: readToggle(rPr, "vanish"),
    lang: readLang(rPr),
    spacing: readNumericVal(rPr, "spacing"),
    kern: readNumericVal(rPr, "kern"),
    position: readNumericVal(rPr, "position"),
    shading: readShading(rPr),
  };
}

// ---- Inline segment parsing -------------------------------------------------

function extractInlineSegments(run: XmlElementNode): InlineSegment[] {
  const segments: InlineSegment[] = [];

  for (const child of run.children) {
    if (child.kind !== "element") continue;
    const segment = parseInlineChild(child);
    if (segment) segments.push(segment);
  }

  return segments;
}

function parseInlineChild(el: XmlElementNode): InlineSegment | undefined {
  // Skip w:rPr — already handled by formatting extraction
  if (el.localName === "rPr" && el.prefix === "w") return undefined;

  // Skip annotation markers (w:bookmarkStart/End, etc.) — these are range markers
  if (isAnnotationMarker(el)) return undefined;

  const localId = el.id;

  switch (el.localName) {
    case "t":
      return {
        segmentKind: "text",
        localId,
        text: getTextContent(el),
        preserveSpace: getAttr(el, "space", "xml") === "preserve",
      };

    case "delText":
      return { segmentKind: "deletedText", localId, text: getTextContent(el) };

    case "instrText":
      return { segmentKind: "instrText", localId, text: getTextContent(el) };

    case "tab":
      return { segmentKind: "tab", localId };

    case "br":
      return {
        segmentKind: "break",
        localId,
        breakType: mapBreakType(getAttr(el, "type", "w")),
      };

    case "sym":
      return {
        segmentKind: "symbol",
        localId,
        char: getAttr(el, "char", "w") ?? "",
        font: getAttr(el, "font", "w"),
      };

    case "footnoteReference":
      return {
        segmentKind: "footnoteRef",
        localId,
        footnoteId: getAttr(el, "id", "w") ?? "",
      };

    case "endnoteReference":
      return {
        segmentKind: "endnoteRef",
        localId,
        endnoteId: getAttr(el, "id", "w") ?? "",
      };

    case "drawing":
      return {
        segmentKind: "drawing",
        localId,
        isInline: findChildElement(el, "inline", "wp") !== undefined,
      };

    case "fldChar":
      return {
        segmentKind: "fieldChar",
        localId,
        fieldCharType: mapFieldCharType(getAttr(el, "fldCharType", "w")),
      };

    case "softHyphen":
      return { segmentKind: "softHyphen", localId };

    case "noBreakHyphen":
      return { segmentKind: "noBreakHyphen", localId };

    default:
      // Preserve unknown inline children
      if (el.prefix === "w" || !el.prefix) {
        return {
          segmentKind: "preserved",
          localId,
          qualifiedName: el.prefix ? `${el.prefix}:${el.localName}` : el.localName,
        };
      }
      return {
        segmentKind: "preserved",
        localId,
        qualifiedName: el.prefix ? `${el.prefix}:${el.localName}` : el.localName,
      };
  }
}

// ---- Formatting helpers -----------------------------------------------------

function readHalfPointSize(rPr: XmlElementNode, localName: string): number | undefined {
  const val = readVal(rPr, localName);
  if (val === undefined) return undefined;
  const n = Number(val);
  return Number.isNaN(n) ? undefined : n;
}

function readFontFamily(rPr: XmlElementNode): string | undefined {
  const fonts = findChildElement(rPr, "rFonts", "w");
  if (!fonts) return undefined;
  // Precedence: ascii → hAnsi → cs → eastAsia
  return getAttr(fonts, "ascii", "w")
    ?? getAttr(fonts, "hAnsi", "w")
    ?? getAttr(fonts, "cs", "w")
    ?? getAttr(fonts, "eastAsia", "w");
}

function readFontFamilyCs(rPr: XmlElementNode): string | undefined {
  const fonts = findChildElement(rPr, "rFonts", "w");
  if (!fonts) return undefined;
  return getAttr(fonts, "cs", "w");
}

function readColorVal(rPr: XmlElementNode): string | undefined {
  const color = findChildElement(rPr, "color", "w");
  if (!color) return undefined;
  return getAttr(color, "val", "w");
}

function readLang(rPr: XmlElementNode): string | undefined {
  const lang = findChildElement(rPr, "lang", "w");
  if (!lang) return undefined;
  return getAttr(lang, "val", "w") ?? getAttr(lang, "bidi", "w");
}

// ---- Mappers ----------------------------------------------------------------

function mapBreakType(val: string | undefined): "line" | "page" | "column" | "textWrapping" {
  switch (val) {
    case "page": return "page";
    case "column": return "column";
    case "textWrapping": return "textWrapping";
    default: return "line";
  }
}

function mapFieldCharType(val: string | undefined): "begin" | "separate" | "end" {
  switch (val) {
    case "begin": return "begin";
    case "separate": return "separate";
    case "end": return "end";
    default: return "begin";
  }
}

function isAnnotationMarker(el: XmlElementNode): boolean {
  if (el.prefix !== "w") return false;
  const name = el.localName;
  return name === "bookmarkStart" || name === "bookmarkEnd"
    || name === "commentRangeStart" || name === "commentRangeEnd"
    || name === "permStart" || name === "permEnd"
    || name === "proofErr" || name === "lastRenderedPageBreak";
}
