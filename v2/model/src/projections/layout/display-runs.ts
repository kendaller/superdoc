// ---------------------------------------------------------------------------
// Display-run extraction
//
// Extracts only the visible result runs needed by the paragraph display fast
// path. This intentionally avoids building full RunRawProperties for
// instruction-only field machinery.
// ---------------------------------------------------------------------------

import type { RunRawProperties } from '../../entities/types.js';
import type { InlineSegment } from '../../entities/inline-segments.js';
import type { XmlElementNode } from '../../types/xml.js';
import type { DisplayRunSource } from './feeder.js';
import { extractRunFormatting } from '../../extract/run.js';
import { findChildElement, getAttr, getTextContent } from '../../word/tree-helpers.js';

export function extractDisplayRunSources(
  paragraphElement: XmlElementNode,
  instructionRunIds: ReadonlySet<string>,
): DisplayRunSource[] {
  const runs: DisplayRunSource[] = [];
  collectDisplayRuns(paragraphElement, instructionRunIds, runs);
  return runs;
}

function collectDisplayRuns(
  element: XmlElementNode,
  instructionRunIds: ReadonlySet<string>,
  runs: DisplayRunSource[],
): void {
  for (const child of element.children) {
    if (child.kind !== 'element') {
      continue;
    }

    if (child.localName === 'r' && child.prefix === 'w') {
      pushDisplayRun(child, instructionRunIds, runs);
      continue;
    }

    if (child.localName === 'hyperlink' && child.prefix === 'w') {
      for (const hyperlinkChild of child.children) {
        if (hyperlinkChild.kind === 'element' && hyperlinkChild.localName === 'r' && hyperlinkChild.prefix === 'w') {
          pushDisplayRun(hyperlinkChild, instructionRunIds, runs);
        }
      }
      continue;
    }

    if (child.localName === 'sdt' && child.prefix === 'w') {
      const sdtContent = findChildElement(child, 'sdtContent', 'w');
      if (sdtContent) {
        collectDisplayRuns(sdtContent, instructionRunIds, runs);
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
      for (const trackedChild of child.children) {
        if (trackedChild.kind === 'element' && trackedChild.localName === 'r' && trackedChild.prefix === 'w') {
          pushDisplayRun(trackedChild, instructionRunIds, runs);
        }
      }
    }
  }
}

function pushDisplayRun(
  runElement: XmlElementNode,
  instructionRunIds: ReadonlySet<string>,
  runs: DisplayRunSource[],
): void {
  if (instructionRunIds.has(runElement.id)) {
    return;
  }

  const raw = extractDisplayRunProperties(runElement);
  if (!raw || raw.segments.length === 0) {
    return;
  }

  runs.push({ raw });
}

function extractDisplayRunProperties(element: XmlElementNode): RunRawProperties | undefined {
  const rPr = findChildElement(element, 'rPr', 'w');
  const segments = extractVisibleInlineSegments(element);
  if (segments.length === 0) {
    return undefined;
  }

  return {
    formatting: rPr ? extractRunFormatting(rPr) : {},
    segments,
  };
}

function extractVisibleInlineSegments(runElement: XmlElementNode): InlineSegment[] {
  const segments: InlineSegment[] = [];

  for (const child of runElement.children) {
    if (child.kind !== 'element') {
      continue;
    }

    if (child.localName === 'rPr' && child.prefix === 'w') {
      continue;
    }

    if (isAnnotationMarker(child)) {
      continue;
    }

    const localId = child.id;

    switch (child.localName) {
      case 't':
        segments.push({
          segmentKind: 'text',
          localId,
          text: getTextContent(child),
          preserveSpace: getAttr(child, 'space', 'xml') === 'preserve',
        });
        break;

      case 'tab':
        segments.push({ segmentKind: 'tab', localId });
        break;

      case 'br':
        segments.push({
          segmentKind: 'break',
          localId,
          breakType: mapBreakType(getAttr(child, 'type', 'w')),
        });
        break;

      case 'sym':
        segments.push({
          segmentKind: 'symbol',
          localId,
          char: getAttr(child, 'char', 'w') ?? '',
          font: getAttr(child, 'font', 'w'),
        });
        break;

      case 'softHyphen':
        segments.push({ segmentKind: 'softHyphen', localId });
        break;

      case 'noBreakHyphen':
        segments.push({ segmentKind: 'noBreakHyphen', localId });
        break;

      case 'footnoteReference':
        segments.push({
          segmentKind: 'footnoteRef',
          localId,
          footnoteId: getAttr(child, 'id', 'w') ?? '',
        });
        break;

      case 'endnoteReference':
        segments.push({
          segmentKind: 'endnoteRef',
          localId,
          endnoteId: getAttr(child, 'id', 'w') ?? '',
        });
        break;
    }
  }

  return segments;
}

function mapBreakType(value: string | undefined): 'line' | 'page' | 'column' | 'textWrapping' {
  switch (value) {
    case 'page':
      return 'page';
    case 'column':
      return 'column';
    case 'textWrapping':
      return 'textWrapping';
    default:
      return 'line';
  }
}

function isAnnotationMarker(element: XmlElementNode): boolean {
  if (element.prefix !== 'w') {
    return false;
  }

  return (
    element.localName === 'bookmarkStart' ||
    element.localName === 'bookmarkEnd' ||
    element.localName === 'commentRangeStart' ||
    element.localName === 'commentRangeEnd' ||
    element.localName === 'permStart' ||
    element.localName === 'permEnd' ||
    element.localName === 'proofErr' ||
    element.localName === 'lastRenderedPageBreak'
  );
}
