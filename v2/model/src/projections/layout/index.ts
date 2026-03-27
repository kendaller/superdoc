// ---------------------------------------------------------------------------
// Layout projection — public API
//
// Converts the semantic model's entity graph into FlowBlock[] compatible
// with the layout-engine pipeline.
// ---------------------------------------------------------------------------

// Main entry point
export { projectToFlowBlocks } from "./project.js";
export type { ProjectOptions, ProjectionResult } from "./project.js";

// Individual projectors (for targeted use or testing)
export { projectParagraph } from "./paragraph-projector.js";
export { projectTable } from "./table-projector.js";
export { projectSection } from "./section-projector.js";
export { projectRuns } from "./run-projector.js";
export type { ResolvedRunProperties } from "./run-projector.js";

// Block ID utilities
export { createBlockIdGenerator } from "./block-id.js";
export type { BlockIdGenerator } from "./block-id.js";

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
} from "./types.js";
