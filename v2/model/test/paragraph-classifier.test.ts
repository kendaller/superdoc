// ---------------------------------------------------------------------------
// Paragraph field-region classifier tests
//
// Unit tests for the O(n) field-region classification that identifies
// which runs in a paragraph are field-instruction machinery and can be
// skipped during projection.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { classifyParagraphFieldRegions } from '../src/projections/layout/paragraph-classifier.js';
import type { XmlElementNode, XmlAttributeNode } from '../src/types/xml.js';

// ---- Helpers — build minimal XmlElementNode trees ---------------------------

let nextId = 0;
function uid(): string {
  return `test-${nextId++}`;
}

function el(
  localName: string,
  children: XmlElementNode['children'] = [],
  attrs: Record<string, string> = {},
  prefix = 'w',
): XmlElementNode {
  return {
    id: uid(),
    kind: 'element',
    prefix,
    localName,
    attributes: Object.entries(attrs).map(([name, value]) => attr(name, value)),
    namespaceDecls: [],
    children,
  };
}

function attr(name: string, value: string): XmlAttributeNode {
  // Attribute names may be qualified (e.g., "w:fldCharType")
  const parts = name.split(':');
  return {
    id: uid(),
    kind: 'attribute' as const,
    prefix: parts.length > 1 ? parts[0] : undefined,
    localName: parts.length > 1 ? parts[1] : parts[0],
    value,
  } as XmlAttributeNode;
}

/** Build a `w:r` with `w:rPr` and a single `w:t` text child. */
function textRun(text: string): XmlElementNode {
  return el('r', [el('rPr'), el('t', [{ id: uid(), kind: 'text' as const, content: text }])]);
}

/** Build a `w:r` with a `w:tab`. */
function tabRun(): XmlElementNode {
  return el('r', [el('rPr'), el('tab')]);
}

/** Build a `w:r` with a `w:drawing`. */
function drawingRun(): XmlElementNode {
  return el('r', [el('rPr'), el('drawing')]);
}

/** Build a `w:r` with a `w:fldChar`. */
function fldCharRun(charType: 'begin' | 'separate' | 'end'): XmlElementNode {
  return el('r', [el('rPr'), el('fldChar', [], { 'w:fldCharType': charType })]);
}

/** Build a `w:r` with `w:instrText`. */
function instrTextRun(instruction: string): XmlElementNode {
  return el('r', [el('rPr'), el('instrText', [{ id: uid(), kind: 'text' as const, content: instruction }])]);
}

/** Build a `w:p` paragraph element. */
function paragraph(children: XmlElementNode[]): XmlElementNode {
  return el('p', [el('pPr'), ...children]);
}

/** Build a `w:hyperlink` wrapper. */
function hyperlink(children: XmlElementNode[]): XmlElementNode {
  return el('hyperlink', children);
}

/** Build a `w:sdt` → `w:sdtContent` wrapper. */
function sdt(children: XmlElementNode[]): XmlElementNode {
  return el('sdt', [el('sdtPr'), el('sdtContent', children)]);
}

/** Build a `w:ins` tracked change wrapper. */
function ins(children: XmlElementNode[]): XmlElementNode {
  return el('ins', children);
}

// ---- Tests ------------------------------------------------------------------

describe('classifyParagraphFieldRegions', () => {
  it('returns plain for a paragraph with no fields', () => {
    const p = paragraph([textRun('Hello'), textRun(' world')]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('plain');
    expect(result.instructionRunIds.size).toBe(0);
    expect(result.displayKind).toBe('none');
    expect(result.canUseDisplayFastPath).toBe(false);
  });

  it('returns plain for a paragraph with only tabs', () => {
    const p = paragraph([textRun('Label'), tabRun(), textRun('Value')]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('plain');
    expect(result.instructionRunIds.size).toBe(0);
    expect(result.displayKind).toBe('none');
    expect(result.canUseDisplayFastPath).toBe(false);
  });

  it('classifies a simple field as field-display', () => {
    const beginRun = fldCharRun('begin');
    const instrRun = instrTextRun(' PAGE ');
    const separateRun = fldCharRun('separate');
    const displayRun = textRun('1');
    const endRun = fldCharRun('end');

    const p = paragraph([beginRun, instrRun, separateRun, displayRun, endRun]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('field-display');
    expect(result.displayKind).toBe('field-result');
    expect(result.canUseDisplayFastPath).toBe(true);
    // begin, instrText, separate, and end runs should be in instructionRunIds
    expect(result.instructionRunIds.has(beginRun.id)).toBe(true);
    expect(result.instructionRunIds.has(instrRun.id)).toBe(true);
    expect(result.instructionRunIds.has(separateRun.id)).toBe(true);
    expect(result.instructionRunIds.has(endRun.id)).toBe(true);
    // display run should NOT be in instructionRunIds
    expect(result.instructionRunIds.has(displayRun.id)).toBe(false);
  });

  it('classifies a TOC line with PAGEREF as field-display', () => {
    // Typical TOC structure:
    // <hyperlink>
    //   <r>fldChar begin</r>
    //   <r>instrText " PAGEREF _Toc123 \h "</r>
    //   <r>fldChar separate</r>
    //   <r>text "Chapter 1 Introduction"</r>
    //   <r>tab</r>
    //   <r>text "15"</r>
    //   <r>fldChar end</r>
    // </hyperlink>
    const beginRun = fldCharRun('begin');
    const instrRun = instrTextRun(' PAGEREF _Toc123456 \\h ');
    const separateRun = fldCharRun('separate');
    const titleRun = textRun('Chapter 1 Introduction');
    const tabR = tabRun();
    const pageNumRun = textRun('15');
    const endRun = fldCharRun('end');

    const p = paragraph([hyperlink([beginRun, instrRun, separateRun, titleRun, tabR, pageNumRun, endRun])]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('field-display');
    expect(result.displayKind).toBe('toc');
    expect(result.canUseDisplayFastPath).toBe(true);
    // Field machinery is skippable
    expect(result.instructionRunIds.has(beginRun.id)).toBe(true);
    expect(result.instructionRunIds.has(instrRun.id)).toBe(true);
    expect(result.instructionRunIds.has(separateRun.id)).toBe(true);
    expect(result.instructionRunIds.has(endRun.id)).toBe(true);
    // Display content is not skippable
    expect(result.instructionRunIds.has(titleRun.id)).toBe(false);
    expect(result.instructionRunIds.has(tabR.id)).toBe(false);
    expect(result.instructionRunIds.has(pageNumRun.id)).toBe(false);
  });

  it('handles fields inside content controls (sdt)', () => {
    const beginRun = fldCharRun('begin');
    const instrRun = instrTextRun(' PAGEREF _Toc1 \\h ');
    const separateRun = fldCharRun('separate');
    const displayRun = textRun('Page 5');
    const endRun = fldCharRun('end');

    const p = paragraph([sdt([beginRun, instrRun, separateRun, displayRun, endRun])]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('field-display');
    expect(result.displayKind).toBe('field-result');
    expect(result.canUseDisplayFastPath).toBe(true);
    expect(result.instructionRunIds.has(beginRun.id)).toBe(true);
    expect(result.instructionRunIds.has(instrRun.id)).toBe(true);
    expect(result.instructionRunIds.has(separateRun.id)).toBe(true);
    expect(result.instructionRunIds.has(endRun.id)).toBe(true);
    expect(result.instructionRunIds.has(displayRun.id)).toBe(false);
  });

  it('handles fields inside tracked changes (ins)', () => {
    const beginRun = fldCharRun('begin');
    const instrRun = instrTextRun(' PAGE ');
    const separateRun = fldCharRun('separate');
    const displayRun = textRun('7');
    const endRun = fldCharRun('end');

    const p = paragraph([ins([beginRun, instrRun, separateRun, displayRun, endRun])]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('field-display');
    expect(result.canUseDisplayFastPath).toBe(true);
    expect(result.instructionRunIds.has(beginRun.id)).toBe(true);
    expect(result.instructionRunIds.has(displayRun.id)).toBe(false);
  });

  it('returns complex for malformed field (begin without end)', () => {
    const p = paragraph([
      fldCharRun('begin'),
      instrTextRun(' PAGE '),
      fldCharRun('separate'),
      textRun('1'),
      // Missing fldChar end
    ]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('complex');
    expect(result.instructionRunIds.size).toBe(0);
    expect(result.displayKind).toBe('none');
    expect(result.canUseDisplayFastPath).toBe(false);
  });

  it('returns complex for separate without begin', () => {
    const p = paragraph([textRun('Hello'), fldCharRun('separate'), textRun('World')]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('complex');
    expect(result.canUseDisplayFastPath).toBe(false);
  });

  it('returns complex for end without begin', () => {
    const p = paragraph([textRun('Hello'), fldCharRun('end')]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('complex');
    expect(result.canUseDisplayFastPath).toBe(false);
  });

  it('handles multiple adjacent fields in one paragraph', () => {
    // Two fields side by side (e.g., date + page number)
    const begin1 = fldCharRun('begin');
    const instr1 = instrTextRun(' DATE ');
    const sep1 = fldCharRun('separate');
    const display1 = textRun('2026-01-15');
    const end1 = fldCharRun('end');

    const spacer = textRun(' — ');

    const begin2 = fldCharRun('begin');
    const instr2 = instrTextRun(' PAGE ');
    const sep2 = fldCharRun('separate');
    const display2 = textRun('3');
    const end2 = fldCharRun('end');

    const p = paragraph([begin1, instr1, sep1, display1, end1, spacer, begin2, instr2, sep2, display2, end2]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('field-display');
    expect(result.displayKind).toBe('field-result');
    expect(result.canUseDisplayFastPath).toBe(true);
    // All field machinery is skippable
    expect(result.instructionRunIds.has(begin1.id)).toBe(true);
    expect(result.instructionRunIds.has(instr1.id)).toBe(true);
    expect(result.instructionRunIds.has(sep1.id)).toBe(true);
    expect(result.instructionRunIds.has(end1.id)).toBe(true);
    expect(result.instructionRunIds.has(begin2.id)).toBe(true);
    expect(result.instructionRunIds.has(instr2.id)).toBe(true);
    expect(result.instructionRunIds.has(sep2.id)).toBe(true);
    expect(result.instructionRunIds.has(end2.id)).toBe(true);
    // Display and spacer are not skippable
    expect(result.instructionRunIds.has(display1.id)).toBe(false);
    expect(result.instructionRunIds.has(spacer.id)).toBe(false);
    expect(result.instructionRunIds.has(display2.id)).toBe(false);
  });

  it('preserves runs outside of fields', () => {
    const textBefore = textRun('Before field: ');
    const beginRun = fldCharRun('begin');
    const instrRun = instrTextRun(' PAGE ');
    const separateRun = fldCharRun('separate');
    const displayRun = textRun('1');
    const endRun = fldCharRun('end');
    const textAfter = textRun(' (end)');

    const p = paragraph([textBefore, beginRun, instrRun, separateRun, displayRun, endRun, textAfter]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('field-display');
    expect(result.instructionRunIds.has(textBefore.id)).toBe(false);
    expect(result.instructionRunIds.has(displayRun.id)).toBe(false);
    expect(result.instructionRunIds.has(textAfter.id)).toBe(false);
    expect(result.canUseDisplayFastPath).toBe(true);
  });

  it('handles empty paragraph', () => {
    const p = paragraph([]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('plain');
    expect(result.instructionRunIds.size).toBe(0);
    expect(result.displayKind).toBe('none');
    expect(result.canUseDisplayFastPath).toBe(false);
  });

  it('keeps field-display paragraphs with drawings on the normal projection path', () => {
    const p = paragraph([
      fldCharRun('begin'),
      instrTextRun(' PAGEREF _Toc123456 \\h '),
      fldCharRun('separate'),
      textRun('Section One'),
      tabRun(),
      drawingRun(),
      fldCharRun('end'),
    ]);
    const result = classifyParagraphFieldRegions(p);

    expect(result.complexity).toBe('field-display');
    expect(result.displayKind).toBe('toc');
    expect(result.canUseDisplayFastPath).toBe(false);
  });

  it('returns the same singleton for plain paragraphs (referential identity)', () => {
    const p1 = paragraph([textRun('a')]);
    const p2 = paragraph([textRun('b')]);
    const r1 = classifyParagraphFieldRegions(p1);
    const r2 = classifyParagraphFieldRegions(p2);

    expect(r1).toBe(r2); // Same object reference — avoids allocation
  });
});
