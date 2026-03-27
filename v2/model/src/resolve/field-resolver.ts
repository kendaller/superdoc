// ---------------------------------------------------------------------------
// Field resolver
//
// Parses field instruction text and resolves field ranges to semantic
// field types. Field ranges are paired from fldChar begin/separate/end
// segments discovered during tier-1 graph construction.
//
// Phase 4A: thin resolution — parses instruction text to identify field
// type. Actual value computation (page numbers, cross-references) is
// deferred to Phase 4A+ when the layout projection can supply page data.
// ---------------------------------------------------------------------------

import type { EntityRef } from "../identity/types.js";
import type { FieldRangeRawProperties } from "../entities/types.js";
import { parseFieldType } from "../extract/field-range.js";

export type ResolvedField = {
  readonly entityRef: EntityRef;
  readonly instructionText: string;
  readonly fieldType: string | undefined;
  readonly displayText: string | undefined;
  readonly isComputable: boolean;
};

/**
 * Resolve a field range entity to a semantic field description.
 */
export function resolveField(
  entityRef: EntityRef,
  raw: FieldRangeRawProperties,
  displayText?: string,
): ResolvedField {
  const fieldType = raw.fieldType ?? parseFieldType(raw.instructionText);

  return {
    entityRef,
    instructionText: raw.instructionText,
    fieldType,
    displayText,
    isComputable: isComputableField(fieldType),
  };
}

/** Whether this field type can be computed at projection time. */
function isComputableField(fieldType: string | undefined): boolean {
  switch (fieldType) {
    // Static fields — value known without layout
    case "date":
    case "time":
    case "author":
    case "title":
    case "subject":
    case "fileName":
    case "docProperty":
      return true;
    // Layout-dependent fields — need page info
    case "page":
    case "numPages":
    case "pageRef":
    case "toc":
    case "styleRef":
      return false;
    default:
      return false;
  }
}

/**
 * Parse a field instruction string into its components.
 * Returns the field type and any arguments/switches.
 */
export function parseFieldInstruction(instruction: string): {
  type: string | undefined;
  argument: string | undefined;
  switches: string[];
} {
  const trimmed = instruction.trim();
  const parts = trimmed.split(/\s+/);
  const type = parts[0]?.toUpperCase();
  const switches: string[] = [];
  let argument: string | undefined;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("\\")) {
      switches.push(part);
    } else if (!argument) {
      argument = part;
    }
  }

  return { type: type || undefined, argument, switches };
}
