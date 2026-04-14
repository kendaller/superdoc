/**
 * DOM Contract: Data Attributes
 *
 * Named constants for `data-*` attributes stamped on rendered DOM elements.
 * These attributes are read by editor-side DOM observers, click-to-position
 * mapping, and bridge compatibility code.
 *
 * Each constant stores the full attribute name (e.g. `"data-pm-start"`) as it
 * appears in `getAttribute()` / `setAttribute()` calls and CSS selectors.
 *
 * The `DATASET_KEYS` mirror provides the camelCase equivalents used with
 * `element.dataset.*` access.
 */

/**
 * Full attribute names for use with `getAttribute` / `setAttribute` / CSS selectors.
 */
export const DATA_ATTRS = {
  /** ProseMirror start position of the element's content range. */
  PM_START: 'data-pm-start',

  /** ProseMirror end position of the element's content range. */
  PM_END: 'data-pm-end',

  /** Layout epoch stamp — incremented on each layout pass. */
  LAYOUT_EPOCH: 'data-layout-epoch',

  /** JSON-encoded table boundary metadata for resize overlays. */
  TABLE_BOUNDARIES: 'data-table-boundaries',

  /** SDT unique identifier. */
  SDT_ID: 'data-sdt-id',

  /** SDT type (fieldAnnotation, structuredContent, documentSection, etc.). */
  SDT_TYPE: 'data-sdt-type',

  /** Field annotation field identifier. */
  FIELD_ID: 'data-field-id',

  /** Field annotation field type (signer, text, checkbox, etc.). */
  FIELD_TYPE: 'data-field-type',

  /** Marks an element as draggable by the editor. */
  DRAGGABLE: 'data-draggable',

  /** Display label text for drag toast / accessibility. */
  DISPLAY_LABEL: 'data-display-label',

  /** Field annotation variant (text, image, signature, checkbox, html, link). */
  VARIANT: 'data-variant',

  /** Element type discriminator (annotation variant, etc.). */
  TYPE: 'data-type',

  // ---- V2 native interaction metadata ----------------------------------------

  /** Stable block identifier from v2 projection (already exists as data-block-id in painter). */
  BLOCK_ID: 'data-block-id',

  /** V2 entity ref ID — maps the rendered element back to its semantic entity. */
  SD_ENTITY_REF: 'data-sd-entity-ref',

  /** V2 story ID — which story this element belongs to. */
  SD_STORY_ID: 'data-sd-story-id',

  /** V2 run entity ref — identifies a specific run within a paragraph. */
  SD_RUN_REF: 'data-sd-run-ref',

  /** V2 inline segment ID — identifies a specific inline segment within a run. */
  SD_SEGMENT_ID: 'data-sd-segment-id',

  /** V2 segment text start offset (character index within the segment). */
  SD_SEGMENT_START: 'data-sd-segment-start',

  /** V2 segment text end offset (character index within the segment). */
  SD_SEGMENT_END: 'data-sd-segment-end',

  /** V2 interaction kind — categorizes what kind of editable target this is. */
  SD_INTERACTION_KIND: 'data-sd-interaction-kind',
} as const;

/**
 * CamelCase keys for use with `element.dataset.*` property access.
 *
 * `element.dataset.pmStart` is equivalent to `element.getAttribute('data-pm-start')`.
 */
export const DATASET_KEYS = {
  PM_START: 'pmStart',
  PM_END: 'pmEnd',
  LAYOUT_EPOCH: 'layoutEpoch',
  TABLE_BOUNDARIES: 'tableBoundaries',
  SDT_ID: 'sdtId',
  SDT_TYPE: 'sdtType',
  FIELD_ID: 'fieldId',
  FIELD_TYPE: 'fieldType',
  DRAGGABLE: 'draggable',
  DISPLAY_LABEL: 'displayLabel',
  VARIANT: 'variant',
  TYPE: 'type',

  // ---- V2 native interaction metadata ----------------------------------------

  BLOCK_ID: 'blockId',
  SD_ENTITY_REF: 'sdEntityRef',
  SD_STORY_ID: 'sdStoryId',
  SD_RUN_REF: 'sdRunRef',
  SD_SEGMENT_ID: 'sdSegmentId',
  SD_SEGMENT_START: 'sdSegmentStart',
  SD_SEGMENT_END: 'sdSegmentEnd',
  SD_INTERACTION_KIND: 'sdInteractionKind',
} as const;
