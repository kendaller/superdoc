// ---------------------------------------------------------------------------
// Benchmark artifact schema — deterministic JSON format for benchmark results.
//
// Each benchmark run produces one artifact per (document, mode) pair.
// Artifacts are comparable across runs for regression detection.
// ---------------------------------------------------------------------------

import type { TimelineSnapshot } from './timeline.js';
import type { CorpusEntry, DocumentClass } from './corpus.js';

/** The rendering pipeline mode under test. */
export type BenchmarkMode = 'pm' | 'v2' | 'v2-render-shell' | 'v2-streaming';

/** Machine metadata for reproducibility. */
export type MachineInfo = {
  readonly platform: string;
  readonly arch: string;
  readonly cpuCores: number;
  readonly memoryGb: number;
  readonly userAgent?: string;
};

/** Git context for traceability. */
export type GitInfo = {
  readonly sha: string;
  readonly branch: string;
  readonly dirty: boolean;
};

/** Top-level benchmark artifact for a single (document, mode) run. */
export type BenchmarkArtifact = {
  readonly version: 1;
  readonly document: {
    readonly id: string;
    readonly class: DocumentClass;
    readonly label: string;
    readonly pageCount: number;
    readonly bytes: number;
  };
  readonly mode: BenchmarkMode;
  readonly timings: Readonly<Record<string, number>>;
  readonly counts: Readonly<Record<string, number>>;
  readonly memory: {
    readonly peakMb: number | null;
    readonly atFirstPaintMb: number | null;
  };
  readonly machine: MachineInfo;
  readonly git: GitInfo;
  readonly timestamp: string;
  readonly warmCache: boolean;
};

/** Summary row for tabular comparison across documents/modes. */
export type BenchmarkSummaryRow = {
  readonly documentId: string;
  readonly documentClass: DocumentClass;
  readonly label: string;
  readonly mode: BenchmarkMode;
  readonly ttfpMs: number | null;
  readonly openMs: number | null;
  readonly projectionMs: number | null;
  readonly measurementMs: number | null;
  readonly paginationMs: number | null;
  readonly paintMs: number | null;
  readonly blocksProjected: number | null;
  readonly blocksMeasured: number | null;
  readonly pagesMounted: number | null;
  readonly peakMemoryMb: number | null;
};

// ---- Factory ---------------------------------------------------------------

/** Build a BenchmarkArtifact from a timeline snapshot and metadata. */
export function createArtifact(
  snapshot: TimelineSnapshot,
  entry: CorpusEntry,
  mode: BenchmarkMode,
  machine: MachineInfo,
  git: GitInfo,
  options?: { warmCache?: boolean; pageCount?: number },
): BenchmarkArtifact {
  return {
    version: 1,
    document: {
      id: entry.id,
      class: entry.class,
      label: entry.label,
      pageCount: options?.pageCount ?? 0,
      bytes: entry.bytes,
    },
    mode,
    timings: { ...snapshot.timings },
    counts: { ...snapshot.counts },
    memory: {
      peakMb: snapshot.counts['runtime.peakMemoryMb'] ?? null,
      atFirstPaintMb: snapshot.counts['runtime.memoryAtFirstPaintMb'] ?? null,
    },
    machine,
    git,
    timestamp: new Date().toISOString(),
    warmCache: options?.warmCache ?? false,
  };
}

// ---- Summary projection ----------------------------------------------------

/** Extract a summary row from a benchmark artifact for tabular display. */
export function toSummaryRow(artifact: BenchmarkArtifact): BenchmarkSummaryRow {
  const t = artifact.timings;
  const c = artifact.counts;

  // TTFP is the render span end, or the sum of open + projection + measurement + pagination + paint
  const ttfp =
    t['render'] ?? sumDefined(t['open'], t['projection'], t['layout.measurement'], t['layout.pagination'], t['paint']);

  return {
    documentId: artifact.document.id,
    documentClass: artifact.document.class,
    label: artifact.document.label,
    mode: artifact.mode,
    ttfpMs: ttfp ?? null,
    openMs: t['open'] ?? null,
    projectionMs: t['projection'] ?? null,
    measurementMs: t['layout.measurement'] ?? null,
    paginationMs: t['layout.pagination'] ?? null,
    paintMs: t['paint'] ?? null,
    blocksProjected: c['projection.blocksProjectedBeforeFirstPaint'] ?? null,
    blocksMeasured: c['layout.blocksMeasuredBeforeFirstPaint'] ?? null,
    pagesMounted: c['layout.pagesMountedAtFirstPaint'] ?? null,
    peakMemoryMb: artifact.memory.peakMb,
  };
}

// ---- Comparison ------------------------------------------------------------

/** Delta between two artifacts for the same document. */
export type ArtifactDelta = {
  readonly documentId: string;
  readonly baseMode: BenchmarkMode;
  readonly compareMode: BenchmarkMode;
  readonly ttfpDeltaMs: number | null;
  readonly ttfpDeltaPercent: number | null;
  readonly timingDeltas: Readonly<Record<string, number>>;
  readonly countDeltas: Readonly<Record<string, number>>;
};

/** Compare two artifacts for the same document, returning signed deltas. */
export function compareArtifacts(base: BenchmarkArtifact, compare: BenchmarkArtifact): ArtifactDelta {
  const baseRow = toSummaryRow(base);
  const compareRow = toSummaryRow(compare);

  const ttfpDeltaMs = baseRow.ttfpMs != null && compareRow.ttfpMs != null ? compareRow.ttfpMs - baseRow.ttfpMs : null;

  const ttfpDeltaPercent =
    ttfpDeltaMs != null && baseRow.ttfpMs != null && baseRow.ttfpMs > 0 ? (ttfpDeltaMs / baseRow.ttfpMs) * 100 : null;

  const timingDeltas = diffRecords(base.timings, compare.timings);
  const countDeltas = diffRecords(base.counts, compare.counts);

  return {
    documentId: base.document.id,
    baseMode: base.mode,
    compareMode: compare.mode,
    ttfpDeltaMs,
    ttfpDeltaPercent,
    timingDeltas,
    countDeltas,
  };
}

// ---- Helpers ---------------------------------------------------------------

function sumDefined(...values: (number | undefined)[]): number | undefined {
  let total = 0;
  let anyDefined = false;
  for (const v of values) {
    if (v !== undefined) {
      total += v;
      anyDefined = true;
    }
  }
  return anyDefined ? total : undefined;
}

function diffRecords(
  base: Readonly<Record<string, number>>,
  compare: Readonly<Record<string, number>>,
): Record<string, number> {
  const result: Record<string, number> = {};
  const allKeys = new Set([...Object.keys(base), ...Object.keys(compare)]);
  for (const key of allKeys) {
    const bv = base[key] ?? 0;
    const cv = compare[key] ?? 0;
    result[key] = cv - bv;
  }
  return result;
}
