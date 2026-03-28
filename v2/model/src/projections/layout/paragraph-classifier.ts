// ---------------------------------------------------------------------------
// Paragraph field-region classifier
//
// Performs a cheap O(n) scan of a paragraph element's XML structure to
// identify which runs are field-instruction machinery (fldChar begin,
// instrText, fldChar separate) vs. display content. Runs in instruction
// regions can be skipped entirely during projection — they are fully
// extracted, style-resolved, and segment-dispatched in the normal path
// only to produce no visible output.
//
// This classifier does NOT extract any run properties or formatting.
// It inspects only element localNames and fldCharType attributes.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from '../../types/xml.js';
import { getAttr } from '../../word/tree-helpers.js';

// ---- Public types -----------------------------------------------------------

export type ParagraphComplexity = 'plain' | 'field-display' | 'complex';

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
};

const EMPTY_SET: ReadonlySet<string> = new Set();

const PLAIN_RESULT: FieldRegionMap = {
  complexity: 'plain',
  instructionRunIds: EMPTY_SET,
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
  let fieldDepth = 0;
  let sawField = false;
  let malformed = false;

  walkParagraphChildren(element, (runElement) => {
    if (malformed) return;

    const runClassification = classifyRunFieldContent(runElement);

    switch (runClassification.kind) {
      case 'none':
        // Regular run — if we're in an instruction region, it's skippable
        if (fieldDepth > 0 && runClassification.isInstructionOnly) {
          instructionRunIds.add(runElement.id);
        }
        break;

      case 'begin':
        sawField = true;
        fieldDepth++;
        // The run containing fldChar begin is instruction machinery
        instructionRunIds.add(runElement.id);
        break;

      case 'separate':
        // The run containing fldChar separate is instruction machinery
        if (fieldDepth > 0) {
          instructionRunIds.add(runElement.id);
        } else {
          malformed = true;
        }
        break;

      case 'end':
        if (fieldDepth > 0) {
          fieldDepth--;
          // The run containing fldChar end is instruction machinery
          instructionRunIds.add(runElement.id);
        } else {
          malformed = true;
        }
        break;

      case 'instrText':
        // instrText runs are always skippable
        if (fieldDepth > 0) {
          instructionRunIds.add(runElement.id);
        }
        break;
    }
  });

  if (malformed || fieldDepth !== 0) {
    return { complexity: 'complex', instructionRunIds: EMPTY_SET };
  }

  if (!sawField) {
    return PLAIN_RESULT;
  }

  return {
    complexity: 'field-display',
    instructionRunIds,
  };
}

// ---- Internal helpers -------------------------------------------------------

type RunFieldContent =
  | { kind: 'none'; isInstructionOnly: boolean }
  | { kind: 'begin' }
  | { kind: 'separate' }
  | { kind: 'end' }
  | { kind: 'instrText' };

/**
 * Classify a single `w:r` element's field-relevant content by inspecting
 * its children. Only looks at localName and fldCharType — no property extraction.
 */
function classifyRunFieldContent(runElement: XmlElementNode): RunFieldContent {
  let fldCharType: string | undefined;
  let hasInstrText = false;
  let hasVisibleContent = false;

  for (const child of runElement.children) {
    if (child.kind !== 'element') continue;
    if (child.prefix !== 'w') continue;

    switch (child.localName) {
      case 'fldChar':
        fldCharType = getAttr(child, 'fldCharType', 'w') ?? undefined;
        break;
      case 'instrText':
        hasInstrText = true;
        break;
      case 'rPr':
        // Formatting — not content
        break;
      case 't':
      case 'tab':
      case 'br':
      case 'sym':
      case 'drawing':
      case 'footnoteReference':
      case 'endnoteReference':
      case 'softHyphen':
      case 'noBreakHyphen':
        hasVisibleContent = true;
        break;
    }
  }

  if (fldCharType !== undefined) {
    switch (fldCharType) {
      case 'begin':
        return { kind: 'begin' };
      case 'separate':
        return { kind: 'separate' };
      case 'end':
        return { kind: 'end' };
    }
  }

  if (hasInstrText && !hasVisibleContent) {
    return { kind: 'instrText' };
  }

  return { kind: 'none', isInstructionOnly: !hasVisibleContent };
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

    // Hyperlinks contain runs directly
    if (child.localName === 'hyperlink' && child.prefix === 'w') {
      walkHyperlinkChildren(child, onRun);
      continue;
    }

    // Content controls are transparent — recurse into sdtContent
    if (child.localName === 'sdt' && child.prefix === 'w') {
      const sdtContent = findFirstChildElement(child, 'sdtContent', 'w');
      if (sdtContent) {
        walkParagraphChildren(sdtContent, onRun);
      }
      continue;
    }

    // Tracked change wrappers (ins, del, moveTo, moveFrom) contain runs
    if (
      child.prefix === 'w' &&
      (child.localName === 'ins' ||
        child.localName === 'del' ||
        child.localName === 'moveTo' ||
        child.localName === 'moveFrom')
    ) {
      walkTrackedChangeChildren(child, onRun);
      continue;
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
