// ---------------------------------------------------------------------------
// Layout projection — public API
//
// Converts the semantic model's entity graph into FlowBlock[] compatible
// with the layout-engine pipeline.
// ---------------------------------------------------------------------------

// Main entry point (semantic-model path)
export { projectToFlowBlocks } from './project.js';
export type { ProjectOptions, ProjectionResult } from './project.js';

// Windowed entry point (render-shell path — fast first paint)
export { projectWindowToFlowBlocks } from './window-project.js';
export type { WindowProjectOptions } from './window-project.js';

// Individual projectors (for targeted use or testing)
export { projectParagraph } from './paragraph-projector.js';
export { projectParagraphFromFeeder } from './paragraph-projector.js';
export { projectTable } from './table-projector.js';
export { projectTableFromFeeder } from './table-projector.js';
export { projectSection, projectSectionFromFeeder } from './section-projector.js';
export { projectRuns, projectRunSegmentsFromFeeder } from './run-projector.js';
export type { ResolvedRunProperties } from './run-projector.js';

// Block ID utilities
export { createBlockIdGenerator } from './block-id.js';
export type { BlockIdGenerator } from './block-id.js';

// Stable ID allocator (source-backed, window-safe)
export { createStableIdAllocator } from './stable-id.js';
export type { StableIdAllocator } from './stable-id.js';

// Feeder abstraction
export type { ProjectionFeeder, FeederNode, FeederNodeKind, SourceAnchor } from './feeder.js';

// Render-shell feeder
export { createRenderShellFeeder, bodyChildToFeederNode, sectionElementToFeederNode } from './render-shell-feeder.js';

// Dependency manifest
export { createDependencyCollector } from './dependency-manifest.js';
export type { DependencyManifest, DependencyCollector } from './dependency-manifest.js';

// Layout-compatible types (wire-compatible with @superdoc/contracts)
export type {
  FlowBlock,
  ParagraphBlock,
  TableBlock,
  SectionBreakBlock,
  Run,
  TextRun,
  TabRun,
  LineBreakRun,
  BreakRun,
  RunMarks,
  ParagraphAttrs,
  ParagraphSpacing,
  ParagraphIndent,
  ParagraphBorders,
  ParagraphBorder,
  ParagraphShading,
  TableRow,
  TableCell,
  TableAttrs,
  TableRowAttrs,
  TableCellAttrs,
  TabStop,
  BlockId,
  // Windowed projection types
  WindowSpec,
  WindowContinuation,
  SectionMetadataDelta,
  WindowedProjectionResult,
} from './types.js';
