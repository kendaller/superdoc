// @ts-check
import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {{ type: string, author: string, date: string, internalId: string }} TrackedChangeEntry
 * @typedef {{ lastTrackedChange: TrackedChangeEntry | null }} WalkContext
 */

const TRACKED_CHANGE_NAMES = new Set(['w:ins', 'w:del']);

/**
 * Non-content marker elements that can appear between the two halves of a Word
 * replacement without breaking the pairing. These are range/annotation markers
 * that carry no document content.
 *
 * Any element NOT in this set (e.g. w:r, w:hyperlink, w:sdt) is treated as
 * content and resets the pairing state so unrelated revisions in the same
 * paragraph are never falsely linked.
 */
const PAIRING_TRANSPARENT_NAMES = new Set([
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:proofErr',
  'w:permStart',
  'w:permEnd',
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
]);

/**
 * Two adjacent tracked changes form a Word replacement pair when they are
 * opposite types (delete vs insert) from the same author at the same timestamp.
 *
 * @param {TrackedChangeEntry} previous
 * @param {{ type: string, author: string, date: string }} current
 * @returns {boolean}
 */
function isReplacementPair(previous, current) {
  return previous.type !== current.type && previous.author === current.author && previous.date === current.date;
}

/**
 * Assigns an internal UUID to a tracked change element. Adjacent replacement
 * halves (w:del + w:ins with matching author/date) share the same UUID.
 *
 * @param {object} element  XML element (w:ins or w:del)
 * @param {Map<string, string>} idMap  Accumulates Word ID → internal UUID
 * @param {WalkContext} context  Mutable walk state for replacement pairing
 * @param {boolean} insideTrackedChange  Whether this element is nested in another tracked change
 */
function assignInternalId(element, idMap, context, insideTrackedChange) {
  const wordId = String(element.attributes?.['w:id'] ?? '');
  if (!wordId) return;

  // Nested tracked changes get their own UUID but are never paired.
  if (insideTrackedChange) {
    if (!idMap.has(wordId)) {
      idMap.set(wordId, uuidv4());
    }
    return;
  }

  const current = {
    type: element.name,
    author: element.attributes?.['w:author'] ?? '',
    date: element.attributes?.['w:date'] ?? '',
  };

  if (context.lastTrackedChange && isReplacementPair(context.lastTrackedChange, current)) {
    // Second half of a replacement — share the first half's UUID, but only
    // if this w:id hasn't already been mapped. A reused id that was already
    // part of an earlier pair must keep its original mapping.
    if (!idMap.has(wordId)) {
      idMap.set(wordId, context.lastTrackedChange.internalId);
    }
    context.lastTrackedChange = null;
  } else {
    // Reuse an existing mapping when the same w:id appears more than once
    // (Word reuses tracked-change ids across the document). Minting a fresh
    // UUID here would overwrite the earlier entry and break any replacement
    // pair that was already recorded for this id.
    const internalId = idMap.get(wordId) ?? uuidv4();
    idMap.set(wordId, internalId);
    context.lastTrackedChange = { ...current, internalId };
  }
}

/**
 * Recursively walks XML elements, assigning internal UUIDs to every tracked
 * change and pairing adjacent replacements.
 *
 * @param {Array} elements
 * @param {Map<string, string>} idMap
 * @param {WalkContext} context
 * @param {boolean} [insideTrackedChange]
 */
function walkElements(elements, idMap, context, insideTrackedChange = false) {
  if (!Array.isArray(elements)) return;

  for (const element of elements) {
    if (TRACKED_CHANGE_NAMES.has(element.name)) {
      assignInternalId(element, idMap, context, insideTrackedChange);

      if (element.elements) {
        // Descend with an isolated context so content inside a tracked change
        // cannot clear the outer replacement candidate.
        walkElements(element.elements, idMap, { lastTrackedChange: null }, /* insideTrackedChange */ true);
      }
    } else {
      // Content-bearing elements break replacement pairing. Only non-content
      // markers (comment/bookmark/permission ranges) are transparent.
      if (!PAIRING_TRANSPARENT_NAMES.has(element.name)) {
        context.lastTrackedChange = null;
      }

      if (element.elements) {
        walkElements(element.elements, idMap, context, insideTrackedChange);
      }
    }
  }
}

/**
 * Scan a single OOXML part and return a fresh `w:id → internal UUID` map.
 *
 * The scan assumes the top-level element is a document / hdr / ftr / footnotes
 * / endnotes root. Returns an empty map when the part is absent or malformed.
 *
 * @param {object | undefined} part Parsed OOXML part (from SuperConverter).
 * @returns {Map<string, string>}
 */
function buildTrackedChangeIdMapForPart(part) {
  const root = part?.elements?.[0];
  if (!root?.elements) return new Map();

  const idMap = new Map();
  walkElements(root.elements, idMap, { lastTrackedChange: null });
  return idMap;
}

/**
 * Builds a map from OOXML `w:id` values to stable internal UUIDs by scanning
 * `word/document.xml`.
 *
 * Word tracked replacements use separate `w:id` values for the delete and
 * insert halves. This function detects adjacent opposite-type changes with
 * matching author and date and maps both halves to the same internal UUID so
 * the editor can resolve them as a single logical change.
 *
 * Must run before comment import so all consumers — translators, comment
 * helpers, and the tracked-change resolver — see a fully populated map.
 *
 * @param {object} docx  Parsed DOCX package
 * @returns {Map<string, string>}  Word `w:id` → internal UUID
 */
export function buildTrackedChangeIdMap(docx) {
  return buildTrackedChangeIdMapForPart(docx?.['word/document.xml']);
}

/**
 * Builds per-part `w:id → internal UUID` maps for every revision-capable
 * content part in the DOCX package.
 *
 * Word revision IDs are **not** globally unique across parts — two different
 * headers can legally reuse the same `w:id`. Storing a single global map
 * would collapse those distinct revisions onto the same internal UUID,
 * losing the pairing metadata that `buildTrackedChangeIdMap` works so hard
 * to preserve. A per-part map keeps each part's id-space isolated.
 *
 * The body map (keyed by `word/document.xml`) matches the legacy behavior
 * of {@link buildTrackedChangeIdMap}, so body-only call sites can switch
 * by reading `result.get('word/document.xml')` without any change in
 * observed behavior.
 *
 * @param {Record<string, object | undefined> | null | undefined} docx  Parsed DOCX package.
 * @returns {Map<string, Map<string, string>>}  Part path → `w:id → UUID` map.
 */
export function buildTrackedChangeIdMapsByPart(docx) {
  /** @type {Map<string, Map<string, string>>} */
  const mapsByPart = new Map();
  if (!docx || typeof docx !== 'object') return mapsByPart;

  /** @type {Record<string, object | undefined>} */
  const parts = /** @type {Record<string, object | undefined>} */ (docx);

  // Body (always present for valid docx documents).
  mapsByPart.set('word/document.xml', buildTrackedChangeIdMapForPart(parts['word/document.xml']));

  // Every header / footer part discovered in the package.
  for (const partPath of Object.keys(parts)) {
    if (!/^word\/(?:header|footer)\d+\.xml$/.test(partPath)) continue;
    mapsByPart.set(partPath, buildTrackedChangeIdMapForPart(parts[partPath]));
  }

  // Footnotes and endnotes share the same paired-replacement structure.
  if (parts['word/footnotes.xml']) {
    mapsByPart.set('word/footnotes.xml', buildTrackedChangeIdMapForPart(parts['word/footnotes.xml']));
  }
  if (parts['word/endnotes.xml']) {
    mapsByPart.set('word/endnotes.xml', buildTrackedChangeIdMapForPart(parts['word/endnotes.xml']));
  }

  return mapsByPart;
}
