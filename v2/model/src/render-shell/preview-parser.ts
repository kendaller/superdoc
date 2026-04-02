import { SaxesParser } from 'saxes';
import type {
  ParagraphRawProperties,
  RunFormatting,
  TabStop,
  ParagraphSpacing,
  ParagraphIndentation,
} from '../entities/types.js';
import type { InlineSegment } from '../entities/inline-segments.js';
import type { SourceSpan } from '../types/xml.js';
import type { PreviewBodyChildRecord, PreviewParagraphClassification, PreviewParagraphRecord } from './preview-types.js';

type PreviewParserInput = {
  index: number;
  partUri: string;
  localName: string;
  sourceSpan: SourceSpan;
  bodyChildPath?: string;
  fragmentText: string;
  rootWrapperOpenTag: string;
  rootWrapperCloseTag: string;
};

type MutableRunRecord = {
  formatting: RunFormatting;
  segments: InlineSegment[];
  containsFieldMarkup: boolean;
  containsInstructionText: boolean;
};

type MutableParagraphState = {
  raw: ParagraphRawProperties;
  runs: MutableRunRecord[];
  containsFieldMarkup: boolean;
  containsTocMarkup: boolean;
  containsDrawing: boolean;
  visibleTextOutsideDrawingLength: number;
  unsupportedReason?: string;
};

type MutablePathState = {
  insideParagraph: boolean;
  insideParagraphProperties: boolean;
  insideParagraphTabs: boolean;
  insideParagraphMarkRunProperties: boolean;
  insideRunProperties: boolean;
  insideNumberingProperties: boolean;
  drawingDepth: number;
  currentTextTarget: 'text' | 'instrText' | 'deletedText' | null;
};

type SaxesTagShape = {
  local: string;
  prefix?: string;
  attributes: Record<string, SaxesAttributeShape>;
};

type SaxesAttributeShape = {
  local: string;
  prefix?: string;
  value: string;
};

export function parsePreviewBodyChild(input: PreviewParserInput): PreviewBodyChildRecord {
  if (input.localName !== 'p') {
    return createUnsupportedRecord(input, 'Only paragraphs are supported by the preview parser');
  }

  const wrappedFragment = `${input.rootWrapperOpenTag}<w:body>${input.fragmentText}</w:body>${input.rootWrapperCloseTag}`;
  const parser = new SaxesParser({ xmlns: true });
  const state = createInitialPathState();
  const paragraph = createInitialParagraphState();
  let currentRun: MutableRunRecord | null = null;
  let segmentCounter = 0;

  parser.on('opentag', (rawNode) => {
    const node = rawNode as unknown as SaxesTagShape;
    const isWordTag = node.prefix === 'w';
    const localName = node.local;

    if (isWordTag && localName === 'p' && !state.insideParagraph) {
      state.insideParagraph = true;
      paragraph.raw = {
        ...paragraph.raw,
        paraId: readAttr(node, 'w14', 'paraId'),
      };
      return;
    }

    if (!state.insideParagraph) {
      return;
    }

    if (isWordTag && localName === 'pPr') {
      state.insideParagraphProperties = true;
      return;
    }

    if (isWordTag && localName === 'r') {
      currentRun = createEmptyRunRecord();
      return;
    }

    if (isWordTag && localName === 'rPr') {
      if (state.insideParagraphProperties && !currentRun) {
        state.insideParagraphMarkRunProperties = true;
      } else if (currentRun) {
        state.insideRunProperties = true;
      }
      return;
    }

    if (state.insideParagraphProperties && !currentRun) {
      parseParagraphPropertyOpenTag(node, paragraph, state);
      return;
    }

    if (currentRun && state.insideRunProperties) {
      parseRunPropertyOpenTag(node, currentRun, paragraph, state);
      return;
    }

    if (isWordTag && localName === 'drawing') {
      paragraph.containsDrawing = true;
      state.drawingDepth += 1;
      return;
    }

    if (state.drawingDepth > 0) {
      return;
    }

    if (!currentRun) {
      return;
    }

    if (isWordTag && localName === 't') {
      state.currentTextTarget = 'text';
      return;
    }

    if (isWordTag && localName === 'instrText') {
      state.currentTextTarget = 'instrText';
      return;
    }

    if (isWordTag && localName === 'delText') {
      state.currentTextTarget = 'deletedText';
      return;
    }

    parseRunContentOpenTag(node, currentRun, paragraph, () => nextSegmentId(++segmentCounter));
  });

  parser.on('text', (text) => {
    if (!currentRun || !state.currentTextTarget) {
      return;
    }

    switch (state.currentTextTarget) {
      case 'text':
        if (state.drawingDepth === 0) {
          paragraph.visibleTextOutsideDrawingLength += countNonWhitespaceCharacters(text);
        }
        currentRun.segments.push({
          segmentKind: 'text',
          localId: nextSegmentId(++segmentCounter),
          text,
          preserveSpace: false,
        });
        break;
      case 'instrText':
        currentRun.containsFieldMarkup = true;
        currentRun.containsInstructionText = true;
        paragraph.containsFieldMarkup = true;
        if (/\bTOC\b|\bPAGEREF\b/.test(text.toUpperCase())) {
          paragraph.containsTocMarkup = true;
        }
        currentRun.segments.push({
          segmentKind: 'instrText',
          localId: nextSegmentId(++segmentCounter),
          text,
        });
        break;
      case 'deletedText':
        currentRun.segments.push({
          segmentKind: 'deletedText',
          localId: nextSegmentId(++segmentCounter),
          text,
        });
        break;
    }
  });

  parser.on('closetag', (closeTag) => {
    const localName = stripQualifiedName(typeof closeTag === 'string' ? closeTag : qualifiedName(closeTag));

    if (localName === 'p') {
      state.insideParagraph = false;
      return;
    }

    if (!state.insideParagraph) {
      return;
    }

    if (localName === 'pPr') {
      state.insideParagraphProperties = false;
      state.insideParagraphTabs = false;
      return;
    }

    if (localName === 'tabs') {
      state.insideParagraphTabs = false;
      return;
    }

    if (localName === 'numPr') {
      state.insideNumberingProperties = false;
      return;
    }

    if (localName === 'rPr') {
      state.insideRunProperties = false;
      state.insideParagraphMarkRunProperties = false;
      return;
    }

    if (localName === 'r' && currentRun) {
      finalizeRunRecord(currentRun, paragraph);
      currentRun = null;
      state.currentTextTarget = null;
      return;
    }

    if (localName === 'drawing') {
      state.drawingDepth = Math.max(0, state.drawingDepth - 1);
      return;
    }

    if (localName === 't' || localName === 'instrText' || localName === 'delText') {
      state.currentTextTarget = null;
    }
  });

  parser.write(wrappedFragment);
  parser.close();

  if (paragraph.unsupportedReason) {
    return createUnsupportedRecord(input, paragraph.unsupportedReason);
  }

  if (paragraph.raw.hasSectPr) {
    return createUnsupportedRecord(input, 'Paragraph contains section properties');
  }

  return createParagraphRecord(input, paragraph);
}

function createParagraphRecord(input: PreviewParserInput, paragraph: MutableParagraphState): PreviewParagraphRecord {
  return {
    kind: 'paragraph',
    index: input.index,
    partUri: input.partUri,
    localName: 'p',
    ...(input.bodyChildPath ? { bodyChildPath: input.bodyChildPath } : {}),
    sourceSpan: input.sourceSpan,
    raw: paragraph.raw,
    runs: paragraph.runs.map((run) => ({
      raw: {
        formatting: run.formatting,
        segments: filterVisibleSegments(run.segments),
      },
    })),
    classification: classifyParagraph(paragraph),
    containsDrawing: paragraph.containsDrawing,
    visibleTextOutsideDrawingLength: paragraph.visibleTextOutsideDrawingLength,
  };
}

function createUnsupportedRecord(input: PreviewParserInput, reason: string): PreviewBodyChildRecord {
  return {
    kind: 'unsupported',
    index: input.index,
    partUri: input.partUri,
    localName: input.localName,
    ...(input.bodyChildPath ? { bodyChildPath: input.bodyChildPath } : {}),
    sourceSpan: input.sourceSpan,
    reason,
  };
}

function createInitialParagraphState(): MutableParagraphState {
  return {
    raw: {
      paraId: undefined,
      styleId: undefined,
      spacing: undefined,
      alignment: undefined,
      numPr: undefined,
      indentation: undefined,
      keepNext: false,
      keepLines: false,
      pageBreakBefore: false,
      outlineLevel: undefined,
      borders: undefined,
      tabs: undefined,
      bidi: false,
      hasSectPr: false,
      suppressAutoHyphens: false,
      contextualSpacing: false,
      markRunProperties: undefined,
    },
    runs: [],
    containsFieldMarkup: false,
    containsTocMarkup: false,
    containsDrawing: false,
    visibleTextOutsideDrawingLength: 0,
  };
}

function createInitialPathState(): MutablePathState {
  return {
    insideParagraph: false,
    insideParagraphProperties: false,
    insideParagraphTabs: false,
    insideParagraphMarkRunProperties: false,
    insideRunProperties: false,
    insideNumberingProperties: false,
    drawingDepth: 0,
    currentTextTarget: null,
  };
}

function createEmptyRunRecord(): MutableRunRecord {
  return {
    formatting: {},
    segments: [],
    containsFieldMarkup: false,
    containsInstructionText: false,
  };
}

function parseParagraphPropertyOpenTag(
  node: SaxesTagShape,
  paragraph: MutableParagraphState,
  state: MutablePathState,
): void {
  if (node.prefix !== 'w') {
    return;
  }

  switch (node.local) {
    case 'pStyle':
      paragraph.raw = { ...paragraph.raw, styleId: readAttr(node, 'w', 'val') };
      return;
    case 'spacing':
      paragraph.raw = { ...paragraph.raw, spacing: parseParagraphSpacing(node) };
      return;
    case 'jc':
      paragraph.raw = { ...paragraph.raw, alignment: readAttr(node, 'w', 'val') };
      return;
    case 'numPr':
      state.insideNumberingProperties = true;
      paragraph.raw = { ...paragraph.raw, numPr: paragraph.raw.numPr ?? { numId: '', ilvl: '0' } };
      return;
    case 'numId':
      if (state.insideNumberingProperties) {
        const numId = readAttr(node, 'w', 'val');
        if (numId) {
          paragraph.raw = {
            ...paragraph.raw,
            numPr: {
              numId,
              ilvl: paragraph.raw.numPr?.ilvl ?? '0',
            },
          };
        }
      }
      return;
    case 'ilvl':
      if (state.insideNumberingProperties) {
        const ilvl = readAttr(node, 'w', 'val');
        paragraph.raw = {
          ...paragraph.raw,
          numPr: paragraph.raw.numPr
            ? { numId: paragraph.raw.numPr.numId, ilvl: ilvl ?? paragraph.raw.numPr.ilvl }
            : undefined,
        };
      }
      return;
    case 'ind':
      paragraph.raw = { ...paragraph.raw, indentation: parseParagraphIndentation(node) };
      return;
    case 'keepNext':
      paragraph.raw = { ...paragraph.raw, keepNext: readToggleValue(node) };
      return;
    case 'keepLines':
      paragraph.raw = { ...paragraph.raw, keepLines: readToggleValue(node) };
      return;
    case 'pageBreakBefore':
      paragraph.raw = { ...paragraph.raw, pageBreakBefore: readToggleValue(node) };
      return;
    case 'outlineLvl':
      paragraph.raw = { ...paragraph.raw, outlineLevel: readNumericAttr(node, 'w', 'val') };
      return;
    case 'tabs':
      state.insideParagraphTabs = true;
      return;
    case 'tab':
      if (state.insideParagraphTabs) {
        paragraph.raw = { ...paragraph.raw, tabs: appendTabStop(paragraph.raw.tabs, parseTabStop(node)) };
      }
      return;
    case 'bidi':
      paragraph.raw = { ...paragraph.raw, bidi: readToggleValue(node) };
      return;
    case 'suppressAutoHyphens':
      paragraph.raw = { ...paragraph.raw, suppressAutoHyphens: readToggleValue(node) };
      return;
    case 'contextualSpacing':
      paragraph.raw = { ...paragraph.raw, contextualSpacing: readToggleValue(node) };
      return;
    case 'sectPr':
      paragraph.raw = { ...paragraph.raw, hasSectPr: true };
      return;
  }
}

function parseRunPropertyOpenTag(
  node: SaxesTagShape,
  run: MutableRunRecord,
  paragraph: MutableParagraphState,
  state: MutablePathState,
): void {
  if (node.prefix !== 'w') {
    return;
  }

  const targetFormatting = state.insideParagraphMarkRunProperties ? paragraph.raw.markRunProperties ?? {} : run.formatting;
  const nextFormatting = { ...targetFormatting };

  switch (node.local) {
    case 'b':
      nextFormatting.bold = readToggleValue(node);
      break;
    case 'i':
      nextFormatting.italic = readToggleValue(node);
      break;
    case 'u':
      nextFormatting.underline = readAttr(node, 'w', 'val');
      break;
    case 'strike':
      nextFormatting.strike = readToggleValue(node);
      break;
    case 'sz':
      nextFormatting.fontSize = readNumericAttr(node, 'w', 'val');
      break;
    case 'szCs':
      nextFormatting.fontSizeCs = readNumericAttr(node, 'w', 'val');
      break;
    case 'color':
      nextFormatting.color = readAttr(node, 'w', 'val');
      break;
    case 'highlight':
      nextFormatting.highlight = readAttr(node, 'w', 'val');
      break;
    case 'vertAlign':
      nextFormatting.vertAlign = readAttr(node, 'w', 'val');
      break;
    case 'spacing':
      nextFormatting.spacing = readNumericAttr(node, 'w', 'val');
      break;
    case 'position':
      nextFormatting.position = readNumericAttr(node, 'w', 'val');
      break;
    case 'rStyle':
      nextFormatting.rStyle = readAttr(node, 'w', 'val');
      break;
    case 'rFonts':
      nextFormatting.fontFamily =
        readAttr(node, 'w', 'ascii') ??
        readAttr(node, 'w', 'hAnsi') ??
        readAttr(node, 'w', 'cs') ??
        readAttr(node, 'w', 'eastAsia');
      nextFormatting.fontFamilyCs = readAttr(node, 'w', 'cs');
      break;
  }

  if (state.insideParagraphMarkRunProperties) {
    paragraph.raw = { ...paragraph.raw, markRunProperties: nextFormatting };
    return;
  }

  run.formatting = nextFormatting;
}

function parseRunContentOpenTag(
  node: SaxesTagShape,
  run: MutableRunRecord,
  paragraph: MutableParagraphState,
  nextLocalId: () => string,
): void {
  if (node.prefix !== 'w') {
    return;
  }

  switch (node.local) {
    case 't':
      return;
    case 'instrText':
      return;
    case 'delText':
      return;
    case 'tab':
      run.segments.push({ segmentKind: 'tab', localId: nextLocalId() });
      return;
    case 'br':
      run.segments.push({
        segmentKind: 'break',
        localId: nextLocalId(),
        breakType: mapBreakType(readAttr(node, 'w', 'type')),
      });
      return;
    case 'softHyphen':
      run.segments.push({ segmentKind: 'softHyphen', localId: nextLocalId() });
      return;
    case 'noBreakHyphen':
      run.segments.push({ segmentKind: 'noBreakHyphen', localId: nextLocalId() });
      return;
    case 'fldChar':
      run.containsFieldMarkup = true;
      paragraph.containsFieldMarkup = true;
      run.segments.push({
        segmentKind: 'fieldChar',
        localId: nextLocalId(),
        fieldCharType: mapFieldCharType(readAttr(node, 'w', 'fldCharType')),
      });
      return;
    case 'drawing':
      return;
    case 'sym':
      run.segments.push({
        segmentKind: 'symbol',
        localId: nextLocalId(),
        char: readAttr(node, 'w', 'char') ?? '',
        font: readAttr(node, 'w', 'font'),
      });
      return;
    default:
      if (isTransparentWrapper(node.local)) {
        return;
      }
      return;
  }
}

function finalizeRunRecord(run: MutableRunRecord, paragraph: MutableParagraphState): void {
  const visibleSegments = filterVisibleSegments(run.segments);
  if (visibleSegments.length === 0) {
    return;
  }

  paragraph.runs.push({
    formatting: run.formatting,
    segments: visibleSegments,
    containsFieldMarkup: run.containsFieldMarkup,
    containsInstructionText: run.containsInstructionText,
  });
}

function filterVisibleSegments(segments: readonly InlineSegment[]): InlineSegment[] {
  return segments.filter((segment) => {
    switch (segment.segmentKind) {
      case 'instrText':
      case 'fieldChar':
      case 'preserved':
      case 'deletedText':
        return false;
      default:
        return true;
    }
  });
}

function classifyParagraph(paragraph: MutableParagraphState): PreviewParagraphClassification {
  if (paragraph.containsTocMarkup) {
    return 'toc-display';
  }
  if (paragraph.containsFieldMarkup) {
    return 'field-display';
  }
  return 'plain';
}

function countNonWhitespaceCharacters(text: string): number {
  let count = 0;

  for (const char of text) {
    if (!/\s/u.test(char)) {
      count += 1;
    }
  }

  return count;
}

function parseParagraphSpacing(node: SaxesTagShape): ParagraphSpacing {
  return {
    before: readNumericAttr(node, 'w', 'before') ?? undefined,
    after: readNumericAttr(node, 'w', 'after') ?? undefined,
    line: readNumericAttr(node, 'w', 'line') ?? undefined,
    lineRule: readAttr(node, 'w', 'lineRule') ?? undefined,
    beforeAutospacing: readBooleanAttr(node, 'w', 'beforeAutospacing'),
    afterAutospacing: readBooleanAttr(node, 'w', 'afterAutospacing'),
  };
}

function parseParagraphIndentation(node: SaxesTagShape): ParagraphIndentation {
  return {
    left: readNumericAttr(node, 'w', 'left') ?? readNumericAttr(node, 'w', 'start') ?? undefined,
    right: readNumericAttr(node, 'w', 'right') ?? readNumericAttr(node, 'w', 'end') ?? undefined,
    firstLine: readNumericAttr(node, 'w', 'firstLine') ?? undefined,
    hanging: readNumericAttr(node, 'w', 'hanging') ?? undefined,
  };
}

function parseTabStop(node: SaxesTagShape): TabStop {
  return {
    val: readAttr(node, 'w', 'val') ?? 'left',
    pos: readNumericAttr(node, 'w', 'pos') ?? 0,
    ...(readAttr(node, 'w', 'leader') ? { leader: readAttr(node, 'w', 'leader') } : {}),
  };
}

function appendTabStop(existing: readonly TabStop[] | undefined, nextTab: TabStop): TabStop[] {
  return existing ? [...existing, nextTab] : [nextTab];
}

function readAttr(node: SaxesTagShape, prefix: string, local: string): string | undefined {
  for (const attribute of Object.values(node.attributes)) {
    if (attribute.prefix === prefix && attribute.local === local) {
      return attribute.value;
    }
  }
  return undefined;
}

function readNumericAttr(node: SaxesTagShape, prefix: string, local: string): number | undefined {
  const value = readAttr(node, prefix, local);
  if (value == null) {
    return undefined;
  }

  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? undefined : numericValue;
}

function readBooleanAttr(node: SaxesTagShape, prefix: string, local: string): boolean | undefined {
  const value = readAttr(node, prefix, local);
  if (value == null) {
    return undefined;
  }

  return value === '1' || value === 'true';
}

function readToggleValue(node: SaxesTagShape): boolean {
  const explicitValue = readAttr(node, 'w', 'val');
  if (explicitValue == null) {
    return true;
  }

  return explicitValue === '1' || explicitValue === 'true' || explicitValue === 'on';
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

function mapFieldCharType(value: string | undefined): 'begin' | 'separate' | 'end' {
  switch (value) {
    case 'separate':
      return 'separate';
    case 'end':
      return 'end';
    default:
      return 'begin';
  }
}

function isTransparentWrapper(localName: string): boolean {
  return (
    localName === 'hyperlink' ||
    localName === 'sdt' ||
    localName === 'sdtContent' ||
    localName === 'ins' ||
    localName === 'del' ||
    localName === 'moveTo' ||
    localName === 'moveFrom'
  );
}

function nextSegmentId(counter: number): string {
  return `preview-seg-${counter}`;
}

function stripQualifiedName(qualifiedName: string): string {
  const separatorIndex = qualifiedName.indexOf(':');
  return separatorIndex >= 0 ? qualifiedName.slice(separatorIndex + 1) : qualifiedName;
}

function qualifiedName(node: SaxesTagShape): string {
  return node.prefix ? `${node.prefix}:${node.local}` : node.local;
}
