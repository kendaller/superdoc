// ---------------------------------------------------------------------------
// Paragraph render planning
//
// Converts cheap paragraph field-region classification into an explicit
// projection decision. This keeps paragraph projection easy to reason about:
// classification decides what is safe, the render plan decides what to do,
// and the projector only executes the chosen path.
// ---------------------------------------------------------------------------

import type { FieldRegionMap, ParagraphDisplayKind } from './paragraph-classifier.js';

export type ParagraphRenderMode = 'normal' | 'display-fast-path';

export type ParagraphRenderPlan = {
  readonly mode: ParagraphRenderMode;
  readonly displayKind: ParagraphDisplayKind;
  readonly instructionRunIds: ReadonlySet<string>;
  readonly skippedInstructionRunCount: number;
};

export function createParagraphRenderPlan(fieldRegions: FieldRegionMap): ParagraphRenderPlan {
  const skippedInstructionRunCount = fieldRegions.instructionRunIds.size;

  if (fieldRegions.complexity === 'field-display' && fieldRegions.canUseDisplayFastPath) {
    return {
      mode: 'display-fast-path',
      displayKind: fieldRegions.displayKind,
      instructionRunIds: fieldRegions.instructionRunIds,
      skippedInstructionRunCount,
    };
  }

  return {
    mode: 'normal',
    displayKind: fieldRegions.displayKind,
    instructionRunIds: fieldRegions.instructionRunIds,
    skippedInstructionRunCount,
  };
}
