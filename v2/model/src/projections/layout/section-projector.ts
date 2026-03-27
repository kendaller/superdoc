// ---------------------------------------------------------------------------
// Section projector — converts a SectionEntity to a SectionBreakBlock
//
// Maps page size, margins, orientation, header/footer refs, and column
// settings from the semantic model's SectionRawProperties.
// ---------------------------------------------------------------------------

import type { SectionEntity } from "../../entities/types.js";
import type { SectionBreakBlock } from "./types.js";
import type { ProjectionIdAllocator } from "./block-id.js";

/**
 * Project a section entity to a layout-compatible SectionBreakBlock.
 *
 * @param entity - The section entity to project.
 * @param nextId - Block ID generator.
 * @returns A SectionBreakBlock ready for the layout engine.
 */
export function projectSection(
  entity: SectionEntity,
  ids: ProjectionIdAllocator,
): SectionBreakBlock {
  const raw = entity.raw();

  const block: SectionBreakBlock = {
    kind: "sectionBreak",
    id: ids.nextBlockId("sectionBreak", entity.ref),
    margins: {
      ...(raw.marginTop !== undefined ? { top: raw.marginTop } : {}),
      ...(raw.marginRight !== undefined ? { right: raw.marginRight } : {}),
      ...(raw.marginBottom !== undefined ? { bottom: raw.marginBottom } : {}),
      ...(raw.marginLeft !== undefined ? { left: raw.marginLeft } : {}),
    },
  };

  // Page size
  if (raw.pageWidth !== undefined && raw.pageHeight !== undefined) {
    block.pageSize = {
      w: raw.pageWidth,
      h: raw.pageHeight,
    };
  }

  // Orientation
  if (raw.orientation) {
    const mapped = mapOrientation(raw.orientation);
    if (mapped) {
      block.orientation = mapped;
    }
  }

  // Header references
  const headerRefs = buildHeaderFooterRefs(raw.headerRefs);
  if (headerRefs) {
    block.headerRefs = headerRefs;
  }

  // Footer references
  const footerRefs = buildHeaderFooterRefs(raw.footerRefs);
  if (footerRefs) {
    block.footerRefs = footerRefs;
  }

  // Columns
  if (raw.cols !== undefined && raw.cols > 1) {
    block.columns = {
      count: raw.cols,
      gap: 720, // Default column gap in twips (0.5 inch)
    };
  }

  return block;
}

// ---- Helpers ----------------------------------------------------------------

function mapOrientation(value: string): "portrait" | "landscape" | undefined {
  if (value === "landscape") return "landscape";
  if (value === "portrait") return "portrait";
  return undefined;
}

/**
 * Build header/footer refs from the raw ref array.
 *
 * The semantic model stores refs as a flat string array. In Phase 2,
 * we map them positionally: first is "default", second is "first",
 * third is "even". This matches the typical OOXML ordering, but a
 * more precise mapping would need the ref type from the source XML
 * (e.g., w:type="default").
 */
function buildHeaderFooterRefs(
  refs: string[],
): Record<string, string> | undefined {
  if (refs.length === 0) return undefined;

  const result: Record<string, string> = {};

  // Map positionally for Phase 2. The refs carry relationship IDs
  // that downstream consumers resolve to story content.
  if (refs[0]) result.default = refs[0];
  if (refs[1]) result.first = refs[1];
  if (refs[2]) result.even = refs[2];

  return Object.keys(result).length > 0 ? result : undefined;
}
