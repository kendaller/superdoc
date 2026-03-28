// ---------------------------------------------------------------------------
// Section projector — converts a SectionEntity to a SectionBreakBlock
//
// Maps page size, margins, orientation, header/footer refs, and column
// settings from the semantic model's SectionRawProperties.
// ---------------------------------------------------------------------------

import type { SectionEntity, SectionRawProperties } from '../../entities/types.js';
import type { SectionBreakBlock } from './types.js';
import type { ProjectionIdAllocator } from './block-id.js';
import type { StableIdAllocator } from './stable-id.js';
import type { FeederNode } from './feeder.js';
import { twipsToLayoutPx } from './measurement-conversions.js';

/**
 * Project a section entity to a layout-compatible SectionBreakBlock.
 *
 * @param entity - The section entity to project.
 * @param nextId - Block ID generator.
 * @returns A SectionBreakBlock ready for the layout engine.
 */
export function projectSection(entity: SectionEntity, ids: ProjectionIdAllocator): SectionBreakBlock {
  const raw = entity.raw();
  return buildSectionBreakBlock(raw, ids.nextBlockId('sectionBreak', entity.ref, entity.sourceRefs[0]));
}

/**
 * Core builder shared by both the entity-based and feeder-based paths.
 */
function buildSectionBreakBlock(raw: SectionRawProperties, blockId: string): SectionBreakBlock {
  const block: SectionBreakBlock = {
    kind: 'sectionBreak',
    id: blockId,
    margins: {
      ...(raw.marginTop !== undefined ? { top: twipsToLayoutPx(raw.marginTop) } : {}),
      ...(raw.marginRight !== undefined ? { right: twipsToLayoutPx(raw.marginRight) } : {}),
      ...(raw.marginBottom !== undefined ? { bottom: twipsToLayoutPx(raw.marginBottom) } : {}),
      ...(raw.marginLeft !== undefined ? { left: twipsToLayoutPx(raw.marginLeft) } : {}),
    },
  };

  // Page size
  if (raw.pageWidth !== undefined && raw.pageHeight !== undefined) {
    block.pageSize = {
      w: twipsToLayoutPx(raw.pageWidth),
      h: twipsToLayoutPx(raw.pageHeight),
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
      gap: twipsToLayoutPx(720),
    };
  }

  return block;
}

/**
 * Project a section FeederNode to a layout-compatible SectionBreakBlock.
 *
 * This is the feeder-based counterpart of `projectSection`. Both share the
 * same core logic via `buildSectionBreakBlock`.
 */
export function projectSectionFromFeeder(node: FeederNode<'section'>, ids: StableIdAllocator): SectionBreakBlock {
  const raw = node.raw();
  return buildSectionBreakBlock(raw, ids.blockId('sectionBreak', node.sourceAnchor));
}

// ---- Helpers ----------------------------------------------------------------

function mapOrientation(value: string): 'portrait' | 'landscape' | undefined {
  if (value === 'landscape') return 'landscape';
  if (value === 'portrait') return 'portrait';
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
function buildHeaderFooterRefs(refs: string[]): Record<string, string> | undefined {
  if (refs.length === 0) return undefined;

  const result: Record<string, string> = {};

  // Map positionally for Phase 2. The refs carry relationship IDs
  // that downstream consumers resolve to story content.
  if (refs[0]) result.default = refs[0];
  if (refs[1]) result.first = refs[1];
  if (refs[2]) result.even = refs[2];

  return Object.keys(result).length > 0 ? result : undefined;
}
