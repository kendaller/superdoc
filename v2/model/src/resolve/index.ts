// ---------------------------------------------------------------------------
// resolve/ barrel
//
// Public API for the OOXML style resolution layer. This module bridges
// v2/model's XmlElementNode trees to the style-engine's cascade logic.
//
// Translators convert raw XML into the pre-translated format the
// style-engine expects. The StyleResolver wraps the engine for
// convenient per-element resolution.
// ---------------------------------------------------------------------------

// --- Property translators ---
export {
  translateParagraphProperties,
  translateRunProperties,
} from "./translate-properties.js";

// --- Document-level translators ---
export { translateStyles } from "./translate-styles.js";
export { translateNumbering } from "./translate-numbering.js";

// --- High-level resolver ---
export { StyleResolver } from "./style-resolver.js";

// --- Re-exported types ---
export type {
  ParagraphProperties,
  RunProperties,
  BorderProperties,
  ShadingProperties,
} from "./translate-properties.js";

export type {
  StylesDocumentProperties,
  StyleDefinition,
} from "./translate-styles.js";

export type {
  NumberingProperties,
} from "./translate-numbering.js";

export type {
  OoxmlResolverParams,
  TableInfo,
} from "./style-resolver.js";

// --- Tracked changes ---
export { resolveTrackedChanges } from "./tracked-changes-resolver.js";
export type { TrackedChangesMode, TrackedChangeAnnotation, AnnotatedRun } from "./tracked-changes-resolver.js";

// --- Field resolution ---
export { resolveField, parseFieldInstruction } from "./field-resolver.js";
export type { ResolvedField } from "./field-resolver.js";
