// ---------------------------------------------------------------------------
// Layout measurement conversions
//
// The semantic model preserves raw OOXML units. The layout engine expects the
// same normalized 96 DPI CSS-pixel values that the legacy PM adapter emits.
// Keep every conversion that crosses that boundary in one place.
// ---------------------------------------------------------------------------

const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;
const HALF_POINTS_PER_POINT = 2;
const PX_PER_POINT = PX_PER_INCH / 72;

const DEFAULT_AUTO_LINE_MULTIPLIER = 1.15;
const OOXML_AUTO_LINE_BASE = 240;

export type LayoutLineSpacing = {
  value: number;
  unit: "px" | "multiplier";
};

export function twipsToLayoutPx(value: number): number {
  return (value / TWIPS_PER_INCH) * PX_PER_INCH;
}

export function halfPointsToLayoutPx(value: number): number {
  return (value / HALF_POINTS_PER_POINT) * PX_PER_POINT;
}

export function measurementToLayoutPx(
  value: number | undefined,
  type: string | undefined,
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  if (!type || type === "dxa") {
    return twipsToLayoutPx(value);
  }

  if (type === "px" || type === "pixel") {
    return value;
  }

  return value;
}

export function paragraphLineToLayoutSpacing(
  value: number | undefined,
  lineRule: string | undefined,
): LayoutLineSpacing | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  if (lineRule === "exact" || lineRule === "atLeast") {
    return {
      value: twipsToLayoutPx(value),
      unit: "px",
    };
  }

  if (lineRule === "auto") {
    return {
      value: (value * DEFAULT_AUTO_LINE_MULTIPLIER) / OOXML_AUTO_LINE_BASE,
      unit: "multiplier",
    };
  }

  return {
    value: value / OOXML_AUTO_LINE_BASE,
    unit: "multiplier",
  };
}
