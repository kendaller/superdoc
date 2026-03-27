// ---------------------------------------------------------------------------
// Table reporter — formats benchmark results as aligned console tables.
// ---------------------------------------------------------------------------

import type { BenchmarkArtifact, BenchmarkSummaryRow, ArtifactDelta } from "../artifact.js";
import { toSummaryRow } from "../artifact.js";

/** Format a set of artifacts into a sorted summary table string. */
export function formatSummaryTable(artifacts: readonly BenchmarkArtifact[]): string {
  if (artifacts.length === 0) return "(no benchmark results)";

  const rows = artifacts.map(toSummaryRow);
  rows.sort(compareSummaryRows);

  const columns: Column<BenchmarkSummaryRow>[] = [
    { header: "Document", width: 28, value: (r) => truncate(r.label, 28) },
    { header: "Class", width: 5, value: (r) => r.documentClass },
    { header: "Mode", width: 14, value: (r) => r.mode },
    { header: "TTFP", width: 10, value: (r) => fmtMs(r.ttfpMs) },
    { header: "Open", width: 10, value: (r) => fmtMs(r.openMs) },
    { header: "Project", width: 10, value: (r) => fmtMs(r.projectionMs) },
    { header: "Measure", width: 10, value: (r) => fmtMs(r.measurementMs) },
    { header: "Paginate", width: 10, value: (r) => fmtMs(r.paginationMs) },
    { header: "Paint", width: 10, value: (r) => fmtMs(r.paintMs) },
    { header: "Blocks", width: 8, value: (r) => fmtInt(r.blocksProjected) },
    { header: "Pages", width: 7, value: (r) => fmtInt(r.pagesMounted) },
    { header: "Mem MB", width: 8, value: (r) => fmtMb(r.peakMemoryMb) },
  ];

  return renderTable(columns, rows);
}

/** Format deltas between two sets of artifacts as a comparison table. */
export function formatDeltaTable(deltas: readonly ArtifactDelta[]): string {
  if (deltas.length === 0) return "(no deltas to display)";

  const columns: Column<ArtifactDelta>[] = [
    { header: "Document", width: 28, value: (d) => truncate(d.documentId, 28) },
    { header: "Base", width: 14, value: (d) => d.baseMode },
    { header: "Compare", width: 14, value: (d) => d.compareMode },
    { header: "TTFP Delta", width: 12, value: (d) => fmtDeltaMs(d.ttfpDeltaMs) },
    { header: "TTFP %", width: 10, value: (d) => fmtDeltaPct(d.ttfpDeltaPercent) },
  ];

  return renderTable(columns, deltas as ArtifactDelta[]);
}

// ---- Table rendering internals ---------------------------------------------

type Column<T> = {
  header: string;
  width: number;
  value: (row: T) => string;
};

function renderTable<T>(columns: Column<T>[], rows: readonly T[]): string {
  const lines: string[] = [];

  // Header
  const headerLine = columns.map((c) => pad(c.header, c.width)).join(" | ");
  lines.push(headerLine);
  lines.push(columns.map((c) => "-".repeat(c.width)).join("-+-"));

  // Rows
  for (const row of rows) {
    const cells = columns.map((c) => pad(c.value(row), c.width));
    lines.push(cells.join(" | "));
  }

  return lines.join("\n");
}

// ---- Sort ------------------------------------------------------------------

function compareSummaryRows(a: BenchmarkSummaryRow, b: BenchmarkSummaryRow): number {
  // Sort by class (A < B < C < D), then by TTFP ascending
  const classOrder = a.documentClass.localeCompare(b.documentClass);
  if (classOrder !== 0) return classOrder;
  return (a.ttfpMs ?? Infinity) - (b.ttfpMs ?? Infinity);
}

// ---- Formatting helpers ----------------------------------------------------

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

function truncate(value: string, maxLen: number): string {
  return value.length <= maxLen ? value : value.slice(0, maxLen - 1) + "\u2026";
}

function fmtMs(value: number | null): string {
  if (value === null) return "-";
  if (value < 1) return `${value.toFixed(2)}ms`;
  if (value < 100) return `${value.toFixed(1)}ms`;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function fmtInt(value: number | null): string {
  return value === null ? "-" : String(value);
}

function fmtMb(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)}`;
}

function fmtDeltaMs(value: number | null): string {
  if (value === null) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${fmtMs(value)}`;
}

function fmtDeltaPct(value: number | null): string {
  if (value === null) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
