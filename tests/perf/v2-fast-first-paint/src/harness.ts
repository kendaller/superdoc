// ---------------------------------------------------------------------------
// Benchmark harness — orchestrates benchmark runs across the corpus.
//
// Entry point for running v2 performance benchmarks. Loads documents from
// the corpus, runs them through the instrumented pipeline, collects timeline
// snapshots, and produces benchmark artifacts.
// ---------------------------------------------------------------------------

import { open } from "@superdoc/v2-model";
import { projectToFlowBlocks, StyleResolver } from "@superdoc/v2-model";
import {
  v2PerfTimeline,
  createArtifact,
  formatSummaryTable,
  serializeArtifact,
  type BenchmarkArtifact,
  type BenchmarkMode,
  type MachineInfo,
  type GitInfo,
  type CorpusEntry,
} from "@superdoc/v2-perf";

/** Options for a single benchmark run. */
export type BenchmarkRunOptions = {
  entry: CorpusEntry;
  source: Uint8Array;
  mode: BenchmarkMode;
  warmCache?: boolean;
  machine: MachineInfo;
  git: GitInfo;
};

/** Result of a single benchmark run. */
export type BenchmarkRunResult = {
  artifact: BenchmarkArtifact;
  json: string;
};

/**
 * Run a single v2-static benchmark: open → ready("structure") → project.
 *
 * This exercises the model-layer pipeline without DOM measurement/paint,
 * which requires a browser environment. DOM-level benchmarks use
 * the browser harness (Playwright-driven).
 */
export async function runModelBenchmark(options: BenchmarkRunOptions): Promise<BenchmarkRunResult> {
  const { entry, source, mode, machine, git, warmCache } = options;

  // Reset and enable the timeline
  v2PerfTimeline.reset();
  v2PerfTimeline.enable();

  try {
    // Open and advance to structure
    const handle = await open(source);
    await handle.ready("structure");

    const semanticModel = handle.semanticModel();
    if (!semanticModel) {
      throw new Error(`Benchmark failed: no semantic model for ${entry.id}`);
    }

    // Project to FlowBlocks (if applicable to this mode)
    if (mode === "v2-static" || mode === "v2-render-shell" || mode === "v2-streaming") {
      const views = handle.views();
      const resolver = new StyleResolver(
        views.styles?.rootElement(),
        views.numbering?.rootElement(),
      );
      const projection = projectToFlowBlocks(semanticModel, { resolver });
      // Record page count from projection (blocks, not pages — pages need layout)
      v2PerfTimeline.gauge("projection.totalBlocks", projection.blocks.length);
    }

    // Collect the snapshot
    const snapshot = v2PerfTimeline.collect();

    const artifact = createArtifact(snapshot, entry, mode, machine, git, {
      warmCache,
      pageCount: 0, // Page count requires layout engine (browser-only)
    });

    return {
      artifact,
      json: serializeArtifact(artifact),
    };
  } finally {
    v2PerfTimeline.disable();
  }
}

/**
 * Run multiple benchmarks and produce a summary table.
 *
 * Used for batch benchmarking across the corpus.
 */
export async function runBatchBenchmarks(
  runs: readonly BenchmarkRunOptions[],
): Promise<{ artifacts: BenchmarkArtifact[]; summary: string }> {
  const artifacts: BenchmarkArtifact[] = [];

  for (const run of runs) {
    const result = await runModelBenchmark(run);
    artifacts.push(result.artifact);
  }

  return {
    artifacts,
    summary: formatSummaryTable(artifacts),
  };
}

// ---- Environment detection helpers -----------------------------------------

/** Detect machine info for the current environment. */
export async function detectMachineInfo(): Promise<MachineInfo> {
  const isNode = typeof process !== "undefined" && process.versions?.node;

  if (isNode) {
    const os = await import("node:os");
    return {
      platform: os.platform(),
      arch: os.arch(),
      cpuCores: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,
    };
  }

  return {
    platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
    arch: "unknown",
    cpuCores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 0 : 0,
    memoryGb: 0,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  };
}
