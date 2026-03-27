// ---------------------------------------------------------------------------
// style-resolver.ts
//
// High-level wrapper around the style-engine's resolution functions.
// Accepts raw XML trees, translates them once on construction, then
// delegates to the style-engine for cascade resolution.
//
// Usage:
//   const resolver = new StyleResolver(stylesRoot, numberingRoot);
//   const ppr = resolver.resolveParagraphProperties(inlineProps, tableInfo);
//   const rpr = resolver.resolveRunProperties(inlineRpr, resolvedPpr, tableInfo);
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import { translateStyles } from "./translate-styles.js";
import { translateNumbering } from "./translate-numbering.js";

import type {
  ParagraphProperties,
  RunProperties,
  StylesDocumentProperties,
  NumberingProperties,
  OoxmlResolverParams,
  TableInfo,
  TableProperties,
  TableCellProperties,
} from "@superdoc/style-engine/ooxml";

import {
  combineProperties,
  resolveParagraphProperties as engineResolvePPr,
  resolveRunProperties as engineResolveRPr,
  resolveTableProperties as engineResolveTableProps,
  resolveTableCellProperties as engineResolveTableCellProps,
} from "@superdoc/style-engine/ooxml";

export type { OoxmlResolverParams, TableInfo };

// ---------------------------------------------------------------------------
// StyleResolver
// ---------------------------------------------------------------------------

/**
 * Wraps the style-engine's OOXML cascade resolution for use with v2/model's
 * XmlElementNode trees.
 *
 * On construction, translates raw `w:styles` and `w:numbering` XML trees
 * into the pre-translated formats the style-engine expects. All subsequent
 * resolution calls are pure lookups against those translated stores.
 *
 * @example
 * ```typescript
 * import { StyleResolver } from "./resolve/style-resolver.js";
 *
 * // Construct once per document
 * const resolver = new StyleResolver(stylesRoot, numberingRoot);
 *
 * // Resolve for each paragraph
 * const ppr = resolver.resolveParagraphProperties(inlineParagraphProps);
 * const rpr = resolver.resolveRunProperties(inlineRunProps, ppr);
 * ```
 */
export class StyleResolver {
  private readonly params: OoxmlResolverParams;

  /** The translated styles, exposed for advanced callers that need direct access. */
  readonly translatedStyles: StylesDocumentProperties | null;

  /** The translated numbering, exposed for advanced callers that need direct access. */
  readonly translatedNumbering: NumberingProperties | null;

  /**
   * Creates a new StyleResolver from optional raw XML root elements.
   *
   * @param stylesRoot - The hydrated `w:styles` root element, or undefined
   *   if the document has no styles part.
   * @param numberingRoot - The hydrated `w:numbering` root element, or
   *   undefined if the document has no numbering part.
   */
  constructor(
    stylesRoot: XmlElementNode | undefined,
    numberingRoot: XmlElementNode | undefined,
  ) {
    this.translatedStyles = stylesRoot
      ? translateStyles(stylesRoot)
      : null;

    this.translatedNumbering = numberingRoot
      ? translateNumbering(numberingRoot)
      : null;

    this.params = {
      translatedLinkedStyles: this.translatedStyles,
      translatedNumbering: this.translatedNumbering,
    };
  }

  /**
   * Resolves paragraph properties through the full OOXML cascade:
   *   docDefaults -> Normal -> table style -> numbering -> paragraph style -> inline
   *
   * @param inlineProps - Direct paragraph formatting from the `w:pPr` element,
   *   already translated via `translateParagraphProperties()`.
   * @param tableInfo - Optional table context for resolving conditional
   *   table style formatting.
   * @returns Fully resolved paragraph properties.
   */
  resolveParagraphProperties(
    inlineProps: ParagraphProperties | undefined,
    tableInfo?: TableInfo,
  ): ParagraphProperties {
    return engineResolvePPr(
      this.params,
      inlineProps ?? null,
      tableInfo ?? null,
    );
  }

  /**
   * Resolves run properties through the full OOXML cascade:
   *   docDefaults -> Normal -> table style -> paragraph style -> character style -> inline
   *
   * @param inlineRpr - Direct run formatting from the `w:rPr` element,
   *   already translated via `translateRunProperties()`.
   * @param resolvedPpr - The already-resolved paragraph properties. Used to
   *   determine the paragraph style's run properties in the cascade.
   * @param tableInfo - Optional table context for resolving conditional
   *   table style formatting.
   * @returns Fully resolved run properties.
   */
  resolveRunProperties(
    inlineRpr: RunProperties | undefined,
    resolvedPpr: ParagraphProperties | undefined,
    tableInfo?: TableInfo,
  ): RunProperties {
    return engineResolveRPr(
      this.params,
      inlineRpr ?? null,
      resolvedPpr ?? null,
      tableInfo ?? null,
    );
  }

  /**
   * Resolves table properties by combining the referenced table style chain
   * with inline table properties from the table's own `w:tblPr`.
   */
  resolveTableProperties(
    inlineProps: TableProperties | undefined,
  ): TableProperties {
    const inlineTableProps = inlineProps ?? {};
    const styleProps = engineResolveTableProps(
      inlineTableProps.tableStyleId,
      this.translatedStyles,
    );

    return combineProperties([styleProps, inlineTableProps]) as TableProperties;
  }

  /**
   * Resolves table cell properties by cascading conditional table style props
   * with the cell's inline `w:tcPr` properties.
   */
  resolveTableCellProperties(
    inlineProps: TableCellProperties | undefined,
    tableInfo: TableInfo,
  ): TableCellProperties {
    return engineResolveTableCellProps(
      inlineProps ?? null,
      tableInfo,
      this.translatedStyles,
    );
  }
}
