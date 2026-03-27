// ---------------------------------------------------------------------------
// Intent-preservation validator
//
// Validates that compiled primitive steps do not violate the intent-
// preservation rules. This is a post-compilation safety net: the compiler
// SHOULD produce correct steps, but the validator catches regressions.
//
// Intent-preservation means:
// - Style references stay as references, never baked into inline properties.
// - Operations only touch the XML they claim to (no collateral damage).
// - Formatting changes are scoped to exactly the property being toggled.
//
// Invariant 1: Style references must stay style references.
// Invariant 2: Numbering references must stay numbering references.
// Invariant 7: Semantic operations must compile, not bypass.
// ---------------------------------------------------------------------------

import type { SemanticOperation } from "./types.js";
import type { MutationStep, SerializedXmlNode } from "../mutations/types.js";

// ---- Public types -----------------------------------------------------------

/** A single intent-preservation violation detected by the validator. */
export type IntentViolation = {
  /** Short machine-readable rule identifier. */
  readonly rule: string;
  /** Human-readable explanation of the violation. */
  readonly message: string;
  /** Index of the offending step within the compiled step array. */
  readonly stepIndex: number;
};

// ---- Public API -------------------------------------------------------------

/**
 * Validate that compiled steps do not violate intent-preservation rules.
 *
 * @param op - The semantic operation that produced the steps.
 * @param steps - The compiled primitive mutation steps.
 * @returns An array of violations. Empty means the steps are clean.
 */
export function validateIntentPreservation(
  op: SemanticOperation,
  steps: MutationStep[],
): IntentViolation[] {
  const violations: IntentViolation[] = [];

  // Dispatch to per-operation validators.
  switch (op.kind) {
    case "setParagraphStyle":
      validateSetParagraphStyle(steps, violations);
      break;
    case "toggleBold":
      validateToggleBold(steps, violations);
      break;
    case "insertParagraph":
      validateInsertParagraph(steps, violations);
      break;
    case "splitParagraph":
      validateSplitParagraph(steps, violations);
      break;
  }

  // Universal rule: no semantic operation may directly mutate style or
  // numbering definition parts. Those are package-level resources.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    // Only XML steps have a `part` ref; package-level steps use `uri` directly.
    const uri = "part" in step ? step.part.uri : undefined;
    if (uri === "/word/styles.xml" || uri === "/word/numbering.xml") {
      violations.push({
        rule: "no-definition-part-mutation",
        message: `Step ${i} targets ${uri} — semantic operations must not mutate style/numbering definitions directly`,
        stepIndex: i,
      });
    }
  }

  return violations;
}

// ---- setParagraphStyle rules ------------------------------------------------

/**
 * setParagraphStyle steps must NOT contain formatting properties beyond pStyle.
 *
 * Allowed in pPr: pStyle only.
 * Forbidden in pPr: spacing, ind, jc, pBdr, tabs, shd, keepNext, keepLines,
 *   pageBreakBefore, outlineLvl, contextualSpacing, suppressAutoHyphens,
 *   bidi, rPr, sectPr, framePr, widowControl, etc.
 *
 * Also forbidden: xml.setAttribute targeting formatting properties.
 */
function validateSetParagraphStyle(steps: MutationStep[], out: IntentViolation[]): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.kind === "xml.setAttribute" && isFormattingAttribute(step.name)) {
      out.push({
        rule: "setParagraphStyle.no-formatting-attrs",
        message: `Step ${i}: setAttribute for "${step.name}" modifies formatting — only pStyle is allowed`,
        stepIndex: i,
      });
    }

    if (step.kind === "xml.insertNode" || step.kind === "xml.replaceNode") {
      collectPPrViolations(step.content, i, out);
    }
  }
}

// ---- toggleBold rules -------------------------------------------------------

/**
 * toggleBold steps must NOT modify rStyle.
 *
 * Forbidden:
 * - Any xml.setAttribute or xml.removeAttribute targeting rStyle.
 * - Any xml.insertNode creating an rPr that adds or removes rStyle children.
 *   (Carrying forward an existing rStyle is acceptable.)
 */
function validateToggleBold(steps: MutationStep[], out: IntentViolation[]): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.kind === "xml.setAttribute" && step.name === "rStyle") {
      out.push({
        rule: "toggleBold.no-rStyle-set",
        message: `Step ${i}: setAttribute targets rStyle — toggleBold must not modify style references`,
        stepIndex: i,
      });
    }

    if (step.kind === "xml.removeAttribute" && step.name === "rStyle") {
      out.push({
        rule: "toggleBold.no-rStyle-removal",
        message: `Step ${i}: removeAttribute targets rStyle — toggleBold must not modify style references`,
        stepIndex: i,
      });
    }

    // Check that insertNode/replaceNode for rPr doesn't add formatting
    // elements beyond bold (w:b) and the carried-forward rStyle.
    if (step.kind === "xml.insertNode" || step.kind === "xml.replaceNode") {
      collectBoldViolations(step.content, i, out);
    }
  }
}

// ---- insertParagraph rules --------------------------------------------------

/**
 * insertParagraph steps must NOT create pPr children other than pStyle.
 */
function validateInsertParagraph(steps: MutationStep[], out: IntentViolation[]): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kind === "xml.insertNode" && step.content.kind === "element") {
      collectPPrViolations(step.content, i, out);
    }
  }
}

// ---- splitParagraph rules ---------------------------------------------------

/**
 * splitParagraph must create the new paragraph with a pStyle ref only —
 * no baked formatting properties in the new paragraph's pPr.
 *
 * Only checks steps that create the new paragraph (identified by assignId).
 */
function validateSplitParagraph(steps: MutationStep[], out: IntentViolation[]): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // The new paragraph is the insertNode with an assignId.
    if (step.kind === "xml.insertNode" && step.assignId && step.content.kind === "element") {
      if (step.content.name === "p") {
        collectPPrViolations(step.content, i, out);
      }
    }
  }
}

// ---- Validation helpers -----------------------------------------------------

/** OOXML pPr children that represent formatting (not style references). */
const PPR_FORMATTING_CHILDREN = new Set([
  "jc", "spacing", "ind", "keepNext", "keepLines",
  "pageBreakBefore", "outlineLvl", "numPr", "pBdr",
  "tabs", "shd", "suppressAutoHyphens", "contextualSpacing",
  "bidi", "rPr", "sectPr", "framePr", "widowControl",
  "wordWrap", "suppressOverlap", "textAlignment",
  "textDirection", "adjustRightInd", "autoSpaceDE",
  "autoSpaceDN", "snapToGrid",
]);

/** Known formatting attribute names that should not appear in style-only ops. */
const FORMATTING_ATTRIBUTES = new Set([
  "bold", "italic", "underline", "strike", "fontSize",
  "fontFamily", "color", "highlight", "spacing",
  "jc", "ind", "keepNext", "keepLines",
  "pageBreakBefore", "outlineLvl", "bidi",
]);

/** OOXML rPr children that are NOT allowed in a toggleBold operation. */
const RPR_FORBIDDEN_IN_BOLD = new Set([
  "i", "iCs", "u", "strike", "dstrike",
  "sz", "szCs", "rFonts", "color", "highlight",
  "vertAlign", "caps", "smallCaps", "vanish",
  "lang", "spacing", "kern", "position", "shd",
]);

/** Check whether a name is a formatting attribute. */
function isFormattingAttribute(name: string): boolean {
  return FORMATTING_ATTRIBUTES.has(name);
}

/**
 * Walk a serialized XML tree and report any pPr children that are
 * formatting properties (i.e., not pStyle).
 */
function collectPPrViolations(
  node: SerializedXmlNode,
  stepIndex: number,
  out: IntentViolation[],
): void {
  if (node.kind !== "element") return;

  if (node.name === "pPr") {
    for (const child of node.children ?? []) {
      if (child.kind === "element" && PPR_FORMATTING_CHILDREN.has(child.name)) {
        out.push({
          rule: "pPr.no-baked-formatting",
          message: `Step ${stepIndex}: pPr contains <${child.name}> — only pStyle is allowed in this operation`,
          stepIndex,
        });
      }
    }
    return; // Don't recurse deeper into pPr.
  }

  // Recurse to find nested pPr elements (e.g., inside a w:p).
  for (const child of node.children ?? []) {
    collectPPrViolations(child, stepIndex, out);
  }
}

/**
 * Walk a serialized XML tree and report rPr children that are forbidden
 * in a toggleBold operation (anything beyond rStyle and b/bCs).
 */
function collectBoldViolations(
  node: SerializedXmlNode,
  stepIndex: number,
  out: IntentViolation[],
): void {
  if (node.kind !== "element") return;

  if (node.name === "rPr") {
    for (const child of node.children ?? []) {
      if (child.kind === "element" && RPR_FORBIDDEN_IN_BOLD.has(child.name)) {
        out.push({
          rule: "toggleBold.no-extra-formatting",
          message: `Step ${stepIndex}: rPr contains <${child.name}> — toggleBold must only touch bold, not other formatting`,
          stepIndex,
        });
      }
    }
    return; // Don't recurse deeper into rPr.
  }

  // Recurse to find nested rPr elements (e.g., inside a w:r).
  for (const child of node.children ?? []) {
    collectBoldViolations(child, stepIndex, out);
  }
}
