// ---------------------------------------------------------------------------
// Paragraph field-region classifier
//
// Performs a cheap O(n) scan of a paragraph element's XML structure to
// identify which runs are field-instruction machinery (fldChar begin,
// instrText, fldChar separate) vs. display content. Runs in instruction
// regions can be skipped entirely during projection — they are fully
// extracted, style-resolved, and segment-dispatched in the normal path only
// to produce no visible output.
//
// The classifier also decides whether a paragraph is safe for the
// display-first fast path. That fast path is intentionally conservative:
// it only activates when the paragraph's visible result can be rendered from
// plain text/tab/break-style runs without needing richer field semantics.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from '../../types/xml.js';
import { getAttr } from '../../word/tree-helpers.js';

// ---- Public types -----------------------------------------------------------

export type ParagraphComplexity = 'plain' | 'field-display' | 'complex';
export type ParagraphDisplayKind = 'none' | 'field-result' | 'toc';

/**
 * Lightweight field-region map for a paragraph element.
 *
 * `instructionRunIds` contains the element ids of `w:r` elements whose
 * content is entirely field-instruction machinery. These runs can be
 * skipped during projection without affecting visible output.
 */
export type FieldRegionMap = {
  readonly complexity: ParagraphComplexity;
  readonly instructionRunIds: ReadonlySet<string>;
  readonly displayKind: ParagraphDisplayKind;
  readonly canUseDisplayFastPath: boolean;
};

const EMPTY_SET: ReadonlySet<string> = new Set();

const PLAIN_RESULT: FieldRegionMap = {
  complexity: 'plain',
  instructionRunIds: EMPTY_SET,
  displayKind: 'none',
  canUseDisplayFastPath: false,
};

const COMPLEX_RESULT: FieldRegionMap = {
  complexity: 'complex',
  instructionRunIds: EMPTY_SET,
  displayKind: 'none',
  canUseDisplayFastPath: false,
};

// ---- Classification ---------------------------------------------------------

/**
 * Classify a paragraph element's field structure.
 *
 * Walks children (including hyperlink, sdt, ins/del wrappers) looking
 * for fldChar elements. Does NOT extract run properties or formatting —
 * only checks element names and fldCharType attributes.
 *
 * Returns a `FieldRegionMap` indicating:
 * - `'plain'` — no fields, no skippable runs
 * - `'field-display'` — well-formed fields found, instruction runs identified
 * - `'complex'` — malformed or deeply nested fields, fall back to normal path
 */
export function classifyParagraphFieldRegions(element: XmlElementNode): FieldRegionMap {
  const instructionRunIds = new Set<string>();
  const fieldStateStack: ParagraphFieldState[] = [];
  let sawField = false;
  let sawFieldSeparator = false;
  let malformed = false;
  let hasUnsupportedVisibleContent = false;
  let sawDisplayText = false;
  let sawDisplayTab = false;
  let sawTocInstruction = false;
  let sawPageReferenceInstruction = false;

  walkParagraphChildren(element, (runElement) => {
    if (malformed) {
      return;
    }

    const runClassification = classifyRunFieldContent(runElement);
    hasUnsupportedVisibleContent ||= runClassification.hasUnsupportedVisibleContent;
    sawDisplayText ||= runClassification.hasDisplayText;
    sawDisplayTab ||= runClassification.hasDisplayTab;

    if (runClassification.instructionText) {
      const normalizedInstruction = normalizeInstructionText(runClassification.instructionText);
      sawTocInstruction ||= normalizedInstruction.includes('TOC');
      sawPageReferenceInstruction ||= normalizedInstruction.includes('PAGEREF');
    }

    switch (runClassification.kind) {
      case 'none':
        if (currentFieldState(fieldStateStack) === 'instruction' && runClassification.isInstructionOnly) {
          instructionRunIds.add(runElement.id);
        }
        break;

      case 'begin':
        sawField = true;
        fieldStateStack.push('instruction');
        instructionRunIds.add(runElement.id);
        break;

      case 'separate':
        if (currentFieldState(fieldStateStack) === 'instruction') {
          sawFieldSeparator = true;
          fieldStateStack[fieldStateStack.length - 1] = 'display';
          instructionRunIds.add(runElement.id);
        } else {
          malformed = true;
        }
        break;

      case 'end':
        if (fieldStateStack.length > 0) {
          fieldStateStack.pop();
          instructionRunIds.add(runElement.id);
        } else {
          malformed = true;
        }
        break;

      case 'instrText':
        if (fieldStateStack.length > 0) {
          instructionRunIds.add(runElement.id);
        }
        break;
    }
  });

  if (malformed || hasOpenInstructionRegion(fieldStateStack)) {
    return COMPLEX_RESULT;
  }

  if (!sawField) {
    return PLAIN_RESULT;
  }

  const canSpanDisplayAcrossParagraphBoundary =
    sawTocInstruction || sawPageReferenceInstruction || (sawDisplayText && sawDisplayTab);

  if (fieldStateStack.length > 0 && !canSpanDisplayAcrossParagraphBoundary) {
    return COMPLEX_RESULT;
  }

  return {
    complexity: 'field-display',
    instructionRunIds,
    displayKind: inferDisplayKind({
      sawTocInstruction,
      sawPageReferenceInstruction,
      sawDisplayText,
      sawDisplayTab,
    }),
    canUseDisplayFastPath: sawFieldSeparator && !hasUnsupportedVisibleContent,
  };
}

// ---- Internal helpers -------------------------------------------------------

type RunFieldContent =
  | {
      kind: 'none';
      isInstructionOnly: boolean;
      hasDisplayText: boolean;
      hasDisplayTab: boolean;
      hasUnsupportedVisibleContent: boolean;
      instructionText?: undefined;
    }
  | {
      kind: 'begin' | 'separate' | 'end';
      hasDisplayText: boolean;
      hasDisplayTab: boolean;
      hasUnsupportedVisibleContent: boolean;
      instructionText?: undefined;
    }
  | {
      kind: 'instrText';
      instructionText: string;
      hasDisplayText: boolean;
      hasDisplayTab: boolean;
      hasUnsupportedVisibleContent: boolean;
    };

type ParagraphFieldState = 'instruction' | 'display';

/**
 * Classify a single `w:r` element's field-relevant content by inspecting
 * its children. Only looks at localName and fldCharType — no property
 * extraction.
 */
function classifyRunFieldContent(runElement: XmlElementNode): RunFieldContent {
  let fldCharType: string | undefined;
  let hasInstrText = false;
  let instructionText = '';
  let hasVisibleContent = false;
  let hasDisplayText = false;
  let hasDisplayTab = false;
  let hasUnsupportedVisibleContent = false;

  for (const child of runElement.children) {
    if (child.kind !== 'element') continue;
    if (child.prefix !== 'w') continue;

    switch (child.localName) {
      case 'fldChar':
        fldCharType = getAttr(child, 'fldCharType', 'w') ?? undefined;
        break;

      case 'instrText':
        hasInstrText = true;
        instructionText += getInstructionText(child);
        break;

      case 'rPr':
        break;

      case 't':
      case 'sym':
      case 'softHyphen':
      case 'noBreakHyphen':
        hasVisibleContent = true;
        hasDisplayText = true;
        break;

      case 'tab':
        hasVisibleContent = true;
        hasDisplayTab = true;
        break;

      case 'br':
        hasVisibleContent = true;
        break;

      case 'drawing':
      case 'footnoteReference':
      case 'endnoteReference':
      case 'delText':
        hasVisibleContent = true;
        hasUnsupportedVisibleContent = true;
        break;

      default:
        hasUnsupportedVisibleContent = true;
        break;
    }
  }

  if (fldCharType !== undefined) {
    switch (fldCharType) {
      case 'begin':
      case 'separate':
      case 'end':
        return {
          kind: fldCharType,
          hasDisplayText,
          hasDisplayTab,
          hasUnsupportedVisibleContent,
        };
    }
  }

  if (hasInstrText && !hasVisibleContent) {
    return {
      kind: 'instrText',
      instructionText,
      hasDisplayText,
      hasDisplayTab,
      hasUnsupportedVisibleContent,
    };
  }

  return {
    kind: 'none',
    isInstructionOnly: !hasVisibleContent,
    hasDisplayText,
    hasDisplayTab,
    hasUnsupportedVisibleContent,
  };
}

/**
 * Walk a paragraph element's run-bearing children, descending into
 * transparent wrappers (hyperlinks, content controls, tracked changes).
 *
 * Same traversal order as `collectRunsFromElement` in render-shell-feeder.
 */
function walkParagraphChildren(element: XmlElementNode, onRun: (runElement: XmlElementNode) => void): void {
  for (const child of element.children) {
    if (child.kind !== 'element') continue;

    if (child.localName === 'r' && child.prefix === 'w') {
      onRun(child);
      continue;
    }

    if (child.localName === 'hyperlink' && child.prefix === 'w') {
      walkHyperlinkChildren(child, onRun);
      continue;
    }

    if (child.localName === 'sdt' && child.prefix === 'w') {
      const sdtContent = findFirstChildElement(child, 'sdtContent', 'w');
      if (sdtContent) {
        walkParagraphChildren(sdtContent, onRun);
      }
      continue;
    }

    if (
      child.prefix === 'w' &&
      (child.localName === 'ins' ||
        child.localName === 'del' ||
        child.localName === 'moveTo' ||
        child.localName === 'moveFrom')
    ) {
      walkTrackedChangeChildren(child, onRun);
    }
  }
}

function walkHyperlinkChildren(hyperlink: XmlElementNode, onRun: (runElement: XmlElementNode) => void): void {
  for (const child of hyperlink.children) {
    if (child.kind === 'element' && child.localName === 'r' && child.prefix === 'w') {
      onRun(child);
    }
  }
}

function walkTrackedChangeChildren(wrapper: XmlElementNode, onRun: (runElement: XmlElementNode) => void): void {
  for (const child of wrapper.children) {
    if (child.kind === 'element' && child.localName === 'r' && child.prefix === 'w') {
      onRun(child);
    }
  }
}

function getInstructionText(element: XmlElementNode): string {
  let text = '';

  for (const child of element.children) {
    if (child.kind === 'text') {
      text += child.value;
    }
  }

  return text;
}

function normalizeInstructionText(text: string): string {
  return text.trim().toUpperCase();
}

function inferDisplayKind(signals: {
  sawTocInstruction: boolean;
  sawPageReferenceInstruction: boolean;
  sawDisplayText: boolean;
  sawDisplayTab: boolean;
}): ParagraphDisplayKind {
  if (
    signals.sawTocInstruction ||
    signals.sawPageReferenceInstruction ||
    (signals.sawDisplayText && signals.sawDisplayTab)
  ) {
    return 'toc';
  }

  return 'field-result';
}

function currentFieldState(fieldStateStack: readonly ParagraphFieldState[]): ParagraphFieldState | undefined {
  return fieldStateStack[fieldStateStack.length - 1];
}

function hasOpenInstructionRegion(fieldStateStack: readonly ParagraphFieldState[]): boolean {
  return fieldStateStack.some((state) => state === 'instruction');
}

/**
 * Fast child element lookup — avoids importing findChildElement's full
 * tree-helper module to keep this classifier dependency-light.
 */
function findFirstChildElement(parent: XmlElementNode, localName: string, prefix: string): XmlElementNode | undefined {
  for (const child of parent.children) {
    if (child.kind === 'element' && child.localName === localName && child.prefix === prefix) {
      return child;
    }
  }

  return undefined;
}
