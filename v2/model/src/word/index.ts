export { createDocumentView } from "./document-view.js";
export type { DocumentView, BodyChildDescriptor, SectionDescriptor } from "./document-view.js";

export { createStylesView } from "./styles-view.js";
export type { StylesView, StyleDescriptor } from "./styles-view.js";

export { createNumberingView } from "./numbering-view.js";
export type {
  NumberingView,
  AbstractNumDescriptor,
  NumInstanceDescriptor,
  NumberingLevelDescriptor,
} from "./numbering-view.js";

export { createSettingsView } from "./settings-view.js";
export type { SettingsView } from "./settings-view.js";

export { createHeadersFootersView } from "./headers-footers-view.js";
export type { HeadersFootersView, HeaderFooterDescriptor } from "./headers-footers-view.js";

export {
  createCommentsView,
  createFootnotesView,
  createEndnotesView,
} from "./annotations-view.js";
export type { AnnotationCollectionView, AnnotationDescriptor } from "./annotations-view.js";

export { createThemeView } from "./theme-view.js";
export type { ThemeView } from "./theme-view.js";

export { createFontTableView } from "./font-table-view.js";
export type { FontTableView, FontDescriptor } from "./font-table-view.js";

export { createContentTypesView, createRelationshipsView } from "./content-types-view.js";
export type { ContentTypesView, RelationshipsView } from "./content-types-view.js";

export {
  ensureIndexed,
  ensureHydrated,
  getXmlPart,
  getPartRoot,
  getBoundaryRecords,
  hydratePartRegion,
  markPartDirty,
  markRegionDirty,
} from "./view-base.js";

export {
  getRootElement,
  findChildElements,
  findChildElement,
  getAttr,
  getTextContent,
} from "./tree-helpers.js";
