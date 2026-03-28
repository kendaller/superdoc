// ---- Public entry point ---------------------------------------------------

export { open } from './session/open.js';

// ---- Types ----------------------------------------------------------------

export type {
  DocumentHandle,
  PackageViews,
  SaveOptions,
  SaveResult,
  ReadyStage,
  SessionStatus,
  SessionDiagnostic,
  PackageSession,
} from './types/index.js';

export type {
  PartUri,
  ArchiveByteSource,
  PackagePart,
  XmlPart,
  BinaryPart,
  RelationshipRecord,
  ContentTypesModel,
} from './types/index.js';

export type {
  XmlDocumentNode,
  XmlElementNode,
  XmlNode,
  XmlTextNode,
  XmlAttributeNode,
  XmlLexicalIndex,
  SourceSpan,
} from './types/index.js';

// ---- Typed view types -----------------------------------------------------

export type {
  DocumentView,
  BodyChildDescriptor,
  SectionDescriptor,
  StylesView,
  NumberingView,
  SettingsView,
  HeadersFootersView,
  AnnotationCollectionView,
  ThemeView,
  FontTableView,
  ContentTypesView,
  RelationshipsView,
} from './word/index.js';

// ---- XML utilities --------------------------------------------------------

export { hydrateDocument, hydrateRegion } from './xml/index.js';
export { serializeXmlDocument, serializeNode } from './xml/index.js';
export { buildLexicalIndex } from './xml/index.js';

// ---- Render shell ---------------------------------------------------------

export { createRenderShellDocument } from './render-shell/index.js';
export { createRenderShellSnapshot } from './render-shell/index.js';
export type {
  RenderShellDocument,
  RenderShellSnapshot,
  RenderShellSectionSnapshot,
  PageGeometry,
  SectionShell,
} from './render-shell/index.js';

// ---- Runtime interface ----------------------------------------------------

export type { DocumentRuntime, RuntimeEventHandler } from './runtime/runtime-interface.js';
export type {
  EnrichmentTarget,
  ProjectWindowParams,
  WindowContinuation,
  TaskId,
  TaskPriority,
} from './runtime/worker-protocol.js';

// ---- Semantic model -------------------------------------------------------

export { SemanticModel } from './model.js';

// Identity types
export type { SourceRef, EntityRef, StoryPosition, StoryRange, ProjectionRef } from './identity/index.js';

export {
  createEntityRef,
  createSourceRef,
  entityRefsEqual,
  sourceRefsEqual,
  createStoryPosition,
  createStoryRange,
} from './identity/index.js';

// Entity types
export type {
  EntityKind,
  StoryEntityKind,
  StructuralEntityKind,
  ResourceEntityKind,
  RangeEntityKind,
  EntityBase,
  Entity,
  ParagraphEntity,
  RunEntity,
  TableEntity,
  TableRowEntity,
  TableCellEntity,
  DrawingEntity,
  StoryEntity,
  StyleEntity,
  NumberingDefinitionEntity,
  BookmarkEntity,
  SectionEntity,
  PreservedBlockEntity,
  RawPropertiesForKind,
  ParagraphRawProperties,
  RunRawProperties,
  RunFormatting,
  TableRawProperties,
  TableRowRawProperties,
  TableCellRawProperties,
  DrawingRawProperties,
  StoryRawProperties,
  StyleRawProperties,
  NumberingDefinitionRawProperties,
  AbstractNumRawProperties,
} from './entities/index.js';

export { isStoryKind, isStructuralKind, isResourceKind } from './entities/index.js';

// Inline segments
export type {
  InlineSegment,
  TextSegment,
  DeletedTextSegment,
  InstrTextSegment,
  TabSegment,
  BreakSegment,
  SymbolSegment,
  FootnoteRefSegment,
  EndnoteRefSegment,
  DrawingSegment,
  FieldCharSegment,
  PreservedInlineSegment,
} from './entities/index.js';

export { segmentsToText } from './entities/index.js';

// Diagnostics
export type { DiagnosticCode, DiagnosticSeverity, DiagnosticScope, Diagnostic } from './diagnostics/index.js';

export { DiagnosticBag } from './diagnostics/index.js';

// Extractors (for direct use in advanced scenarios)
export { createExtractorRegistry } from './extract/index.js';
export { extractParagraphProperties } from './extract/index.js';
export { extractRunProperties, extractRunFormatting } from './extract/index.js';
export { extractTableProperties, extractTableRowProperties, extractTableCellProperties } from './extract/index.js';
export { extractDrawingProperties } from './extract/index.js';

// Resolve layer (Layer 2: style/numbering/field resolution)
export { StyleResolver } from './resolve/index.js';
export { translateStyles } from './resolve/index.js';
export { translateNumbering } from './resolve/index.js';
export { resolveTrackedChanges } from './resolve/index.js';
export { resolveField, parseFieldInstruction } from './resolve/index.js';

// Layout projection (Layer 4: semantic → FlowBlock[])
export { projectToFlowBlocks } from './projections/layout/index.js';
export { projectWindowToFlowBlocks } from './projections/layout/index.js';
export type {
  ProjectionResult,
  WindowSpec,
  WindowContinuation as ProjectionWindowContinuation,
  WindowedProjectionResult,
  SectionMetadataDelta,
  DependencyManifest,
} from './projections/layout/index.js';

// Analysis projection (Layer 4: occurrences + traceability)
export { projectToOccurrences } from './projections/analysis/index.js';
export type { SemanticOccurrence, AnalysisResult, TraceEntry } from './projections/analysis/index.js';

// Semantic JSON projection (Phase 6: getJSON replacement)
export { projectToSemanticJson } from './projections/json/index.js';
export type { SemanticDocument } from './projections/json/index.js';

// Semantic operations (Layer 3: Phase 5)
export type { SemanticOperation } from './operations/index.js';
export { compileOperation } from './operations/index.js';
export { validateIntentPreservation } from './operations/index.js';
export { SemanticHistory } from './operations/index.js';
export { applySemanticOperation } from './operations/index.js';
export type { SemanticOperationResult } from './operations/index.js';
export { DocumentApiAdapter } from './operations/index.js';

// Deterministic ID allocation
export {
  allocateRelationshipId,
  allocateAnnotationId,
  allocateParagraphId,
  allocateMediaFilename,
} from './mutations/id-allocation.js';

// Performance instrumentation (re-export shared timeline for consumer access)
export { v2PerfTimeline } from '@superdoc/v2-perf';
