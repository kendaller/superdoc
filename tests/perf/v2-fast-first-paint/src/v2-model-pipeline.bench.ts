// ---------------------------------------------------------------------------
// V2 Model Pipeline Benchmark
//
// Benchmarks the model-layer pipeline: open → ready("structure") → project.
// Uses synthetic documents since the real corpus requires external setup.
// Run: pnpm --filter @superdoc-testing/v2-perf-harness bench
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createMinimalDocx,
  createMultiParagraphDocx,
  createComplexDocx,
} from '../../../../v2/model/test/helpers/create-test-docx.js';
import { runModelBenchmark, detectMachineInfo } from './harness.js';
import { detectGitInfo } from './git-info.js';
import { formatSummaryTable, type BenchmarkArtifact, type CorpusEntry } from '@superdoc/v2-perf';

// ---- Synthetic corpus entries for testing ----------------------------------

function syntheticEntry(id: string, label: string, docClass: 'A' | 'B' | 'C' | 'D', bytes: number): CorpusEntry {
  return {
    id,
    class: docClass,
    label,
    description: `Synthetic ${label}`,
    profiles: ['text-only'],
    bytes,
    estimatedPages: 1,
    path: '',
  };
}

// ---- Benchmark suite -------------------------------------------------------

describe('v2 model pipeline benchmarks', () => {
  let machine: Awaited<ReturnType<typeof detectMachineInfo>>;
  let git: ReturnType<typeof detectGitInfo>;
  const artifacts: BenchmarkArtifact[] = [];

  it('detects environment', async () => {
    machine = await detectMachineInfo();
    git = detectGitInfo();

    expect(machine.platform).toBeTruthy();
    expect(git.sha).toBeTruthy();
  });

  it('benchmarks minimal docx (class A)', async () => {
    const source = createMinimalDocx('Benchmark test paragraph');
    const entry = syntheticEntry('synth-minimal', 'Minimal docx', 'A', source.byteLength);

    const result = await runModelBenchmark({
      entry,
      source,
      mode: 'v2',
      machine,
      git,
    });

    artifacts.push(result.artifact);

    expect(result.artifact.version).toBe(1);
    expect(result.artifact.mode).toBe('v2');
    expect(result.artifact.timings['open']).toBeGreaterThan(0);
    expect(result.artifact.timings['projection']).toBeGreaterThan(0);
    expect(result.artifact.counts['projection.blocksProjectedBeforeFirstPaint']).toBeGreaterThan(0);
  });

  it('benchmarks multi-paragraph docx (class A)', async () => {
    const paragraphs = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1} with some sample text content.`);
    const source = createMultiParagraphDocx(paragraphs);
    const entry = syntheticEntry('synth-multi-para', '50-paragraph docx', 'A', source.byteLength);

    const result = await runModelBenchmark({
      entry,
      source,
      mode: 'v2',
      machine,
      git,
    });

    artifacts.push(result.artifact);

    expect(result.artifact.counts['projection.blocksProjectedBeforeFirstPaint']).toBeGreaterThanOrEqual(50);
  });

  it('benchmarks complex docx with table (class A)', async () => {
    const source = createComplexDocx();
    const entry = syntheticEntry('synth-complex', 'Complex docx (table)', 'A', source.byteLength);

    const result = await runModelBenchmark({
      entry,
      source,
      mode: 'v2',
      machine,
      git,
    });

    artifacts.push(result.artifact);

    expect(result.artifact.counts['projection.blocksProjectedBeforeFirstPaint']).toBeGreaterThan(0);
  });

  it('produces summary table', () => {
    const summary = formatSummaryTable(artifacts);
    expect(summary).toContain('Document');
    expect(summary).toContain('TTFP');
    expect(summary).toContain('Minimal docx');

    // Log the summary for visibility during benchmark runs
    console.log('\n' + summary + '\n');
  });

  it('artifact JSON is deterministic', async () => {
    const source = createMinimalDocx('Determinism check');
    const entry = syntheticEntry('synth-determinism', 'Determinism check', 'A', source.byteLength);

    const result1 = await runModelBenchmark({ entry, source, mode: 'v2', machine, git });
    const result2 = await runModelBenchmark({ entry, source, mode: 'v2', machine, git });

    // Same structure (timings will differ)
    expect(result1.artifact.version).toBe(result2.artifact.version);
    expect(result1.artifact.document.id).toBe(result2.artifact.document.id);
    expect(result1.artifact.mode).toBe(result2.artifact.mode);
    expect(result1.artifact.machine).toEqual(result2.artifact.machine);
    expect(result1.artifact.git).toEqual(result2.artifact.git);

    // JSON is valid
    const parsed = JSON.parse(result1.json);
    expect(parsed.version).toBe(1);
  });

  it('timeline metrics include expected spans', async () => {
    const source = createMinimalDocx('Span check');
    const entry = syntheticEntry('synth-spans', 'Span check', 'A', source.byteLength);

    const result = await runModelBenchmark({ entry, source, mode: 'v2', machine, git });

    const timings = result.artifact.timings;

    // These spans should be recorded by the instrumented pipeline
    expect(timings['open']).toBeDefined();
    expect(timings['open.fastOpen']).toBeDefined();
    expect(timings['projection']).toBeDefined();

    // All timings should be non-negative
    for (const [name, value] of Object.entries(timings)) {
      expect(value, `timing "${name}" should be non-negative`).toBeGreaterThanOrEqual(0);
    }
  });
});
