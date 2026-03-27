// ---------------------------------------------------------------------------
// Inline segment types — the content model inside a Run entity.
//
// Word inline content is not just text. A Run contains an ordered sequence
// of typed segments: text, tabs, breaks, symbols, note references, drawings,
// field chars, and preserved unknowns.
//
// Segments are NOT graph entities. They are run children addressed by
// (runEntityRef, segmentIndex). Each carries a stable local ID derived
// from its source XML node ID for caret mapping, field reconstruction,
// and diffing.
// ---------------------------------------------------------------------------

/** Discriminated union of all inline segment types within a run. */
export type InlineSegment =
  | TextSegment
  | DeletedTextSegment
  | InstrTextSegment
  | TabSegment
  | BreakSegment
  | SymbolSegment
  | FootnoteRefSegment
  | EndnoteRefSegment
  | DrawingSegment
  | FieldCharSegment
  | SoftHyphenSegment
  | NoBreakHyphenSegment
  | PreservedInlineSegment;

// ---- Concrete segment types -------------------------------------------------

export type TextSegment = {
  readonly segmentKind: "text";
  readonly localId: string;
  readonly text: string;
  readonly preserveSpace: boolean;
};

export type DeletedTextSegment = {
  readonly segmentKind: "deletedText";
  readonly localId: string;
  readonly text: string;
};

export type InstrTextSegment = {
  readonly segmentKind: "instrText";
  readonly localId: string;
  readonly text: string;
};

export type TabSegment = {
  readonly segmentKind: "tab";
  readonly localId: string;
};

export type BreakSegment = {
  readonly segmentKind: "break";
  readonly localId: string;
  readonly breakType: "line" | "page" | "column" | "textWrapping";
};

export type SymbolSegment = {
  readonly segmentKind: "symbol";
  readonly localId: string;
  readonly char: string;
  readonly font: string | undefined;
};

export type FootnoteRefSegment = {
  readonly segmentKind: "footnoteRef";
  readonly localId: string;
  readonly footnoteId: string;
};

export type EndnoteRefSegment = {
  readonly segmentKind: "endnoteRef";
  readonly localId: string;
  readonly endnoteId: string;
};

export type DrawingSegment = {
  readonly segmentKind: "drawing";
  readonly localId: string;
  readonly isInline: boolean;
};

export type FieldCharSegment = {
  readonly segmentKind: "fieldChar";
  readonly localId: string;
  readonly fieldCharType: "begin" | "separate" | "end";
};

export type SoftHyphenSegment = {
  readonly segmentKind: "softHyphen";
  readonly localId: string;
};

export type NoBreakHyphenSegment = {
  readonly segmentKind: "noBreakHyphen";
  readonly localId: string;
};

/** Fallback for unknown inline children — preserved without interpretation. */
export type PreservedInlineSegment = {
  readonly segmentKind: "preserved";
  readonly localId: string;
  readonly qualifiedName: string;
};

// ---- Helpers ----------------------------------------------------------------

/** Extract plain text from a segment sequence, joining text segments. */
export function segmentsToText(segments: readonly InlineSegment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    switch (seg.segmentKind) {
      case "text":
        parts.push(seg.text);
        break;
      case "tab":
        parts.push("\t");
        break;
      case "break":
        if (seg.breakType === "line" || seg.breakType === "textWrapping") {
          parts.push("\n");
        }
        break;
      case "softHyphen":
        parts.push("\u00AD");
        break;
      case "noBreakHyphen":
        parts.push("\u2011");
        break;
    }
  }
  return parts.join("");
}
