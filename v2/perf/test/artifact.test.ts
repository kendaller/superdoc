import { describe, it, expect } from 'vitest';
import {
  createArtifact,
  toSummaryRow,
  compareArtifacts,
  type BenchmarkArtifact,
  type MachineInfo,
  type GitInfo,
} from '../src/artifact.js';
import { serializeArtifact, deserializeArtifact, artifactFilename } from '../src/reporters/json-reporter.js';
import type { TimelineSnapshot } from '../src/timeline.js';
import type { CorpusEntry } from '../src/corpus.js';

// ---- Test fixtures ---------------------------------------------------------

const testEntry: CorpusEntry = {
  id: 'test-doc',
  class: 'A',
  label: 'Test Document',
  description: 'A test document for artifact tests',
  profiles: ['text-only'],
  bytes: 1024,
  estimatedPages: 5,
  path: '/test/doc.docx',
};

const testMachine: MachineInfo = {
  platform: 'darwin',
  arch: 'arm64',
  cpuCores: 10,
  memoryGb: 16,
};

const testGit: GitInfo = {
  sha: 'abc123def456',
  branch: 'test-branch',
  dirty: false,
};

function createTestSnapshot(overrides?: Partial<TimelineSnapshot>): TimelineSnapshot {
  return {
    originMs: 1000,
    marks: [
      { name: 'open.start', offsetMs: 0 },
      { name: 'open.fastOpenComplete', offsetMs: 5 },
    ],
    spans: [
      { name: 'open', startOffsetMs: 0, endOffsetMs: 10, durationMs: 10 },
      { name: 'projection', startOffsetMs: 10, endOffsetMs: 25, durationMs: 15 },
      { name: 'layout.measurement', startOffsetMs: 25, endOffsetMs: 45, durationMs: 20 },
      { name: 'layout.pagination', startOffsetMs: 45, endOffsetMs: 50, durationMs: 5 },
      { name: 'paint', startOffsetMs: 50, endOffsetMs: 55, durationMs: 5 },
      { name: 'render', startOffsetMs: 0, endOffsetMs: 55, durationMs: 55 },
    ],
    counts: {
      'projection.blocksProjectedBeforeFirstPaint': 100,
      'layout.blocksMeasuredBeforeFirstPaint': 100,
      'layout.pagesMountedAtFirstPaint': 5,
      'runtime.peakMemoryMb': 42.5,
      'runtime.memoryAtFirstPaintMb': 30,
    },
    timings: {
      open: 10,
      projection: 15,
      'layout.measurement': 20,
      'layout.pagination': 5,
      paint: 5,
      render: 55,
    },
    ...overrides,
  };
}

// ---- createArtifact --------------------------------------------------------

describe('createArtifact()', () => {
  it('creates a valid artifact from snapshot and metadata', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);

    expect(artifact.version).toBe(1);
    expect(artifact.document.id).toBe('test-doc');
    expect(artifact.document.class).toBe('A');
    expect(artifact.mode).toBe('v2');
    expect(artifact.machine.platform).toBe('darwin');
    expect(artifact.git.sha).toBe('abc123def456');
    expect(artifact.warmCache).toBe(false);
    expect(artifact.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('passes through timings from snapshot', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);

    expect(artifact.timings['open']).toBe(10);
    expect(artifact.timings['projection']).toBe(15);
    expect(artifact.timings['render']).toBe(55);
  });

  it('passes through counts from snapshot', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);

    expect(artifact.counts['projection.blocksProjectedBeforeFirstPaint']).toBe(100);
  });

  it('extracts memory metrics from counts', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);

    expect(artifact.memory.peakMb).toBe(42.5);
    expect(artifact.memory.atFirstPaintMb).toBe(30);
  });

  it('handles missing memory metrics gracefully', () => {
    const snapshot = createTestSnapshot({ counts: {} });
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);

    expect(artifact.memory.peakMb).toBeNull();
    expect(artifact.memory.atFirstPaintMb).toBeNull();
  });

  it('accepts warmCache and pageCount options', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit, {
      warmCache: true,
      pageCount: 25,
    });

    expect(artifact.warmCache).toBe(true);
    expect(artifact.document.pageCount).toBe(25);
  });
});

// ---- toSummaryRow ----------------------------------------------------------

describe('toSummaryRow()', () => {
  it('extracts summary row from artifact', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);
    const row = toSummaryRow(artifact);

    expect(row.documentId).toBe('test-doc');
    expect(row.documentClass).toBe('A');
    expect(row.mode).toBe('v2');
    expect(row.ttfpMs).toBe(55); // render span
    expect(row.openMs).toBe(10);
    expect(row.projectionMs).toBe(15);
    expect(row.measurementMs).toBe(20);
    expect(row.paginationMs).toBe(5);
    expect(row.paintMs).toBe(5);
    expect(row.blocksProjected).toBe(100);
    expect(row.pagesMounted).toBe(5);
    expect(row.peakMemoryMb).toBe(42.5);
  });

  it('falls back to sum of phases when render span is missing', () => {
    const snapshot = createTestSnapshot();
    // Remove the render span
    const timingsWithoutRender = { ...snapshot.timings };
    delete timingsWithoutRender['render'];

    const artifact = createArtifact(
      { ...snapshot, timings: timingsWithoutRender },
      testEntry,
      'v2',
      testMachine,
      testGit,
    );
    const row = toSummaryRow(artifact);

    // open(10) + projection(15) + measurement(20) + pagination(5) + paint(5) = 55
    expect(row.ttfpMs).toBe(55);
  });
});

// ---- compareArtifacts ------------------------------------------------------

describe('compareArtifacts()', () => {
  it('computes deltas between two artifacts', () => {
    const snapshotA = createTestSnapshot();
    const snapshotB = createTestSnapshot({
      timings: { ...createTestSnapshot().timings, render: 30 }, // faster
    });

    const artifactA = createArtifact(snapshotA, testEntry, 'pm', testMachine, testGit);
    const artifactB = createArtifact(snapshotB, testEntry, 'v2', testMachine, testGit);

    const delta = compareArtifacts(artifactA, artifactB);

    expect(delta.documentId).toBe('test-doc');
    expect(delta.baseMode).toBe('pm');
    expect(delta.compareMode).toBe('v2');
    expect(delta.ttfpDeltaMs).toBe(-25); // 30 - 55
    expect(delta.ttfpDeltaPercent).toBeCloseTo(-45.45, 1);
  });

  it('computes timing deltas for all keys', () => {
    const snapshotA = createTestSnapshot();
    const snapshotB = createTestSnapshot();

    const artifactA = createArtifact(snapshotA, testEntry, 'pm', testMachine, testGit);
    const artifactB = createArtifact(snapshotB, testEntry, 'v2', testMachine, testGit);

    const delta = compareArtifacts(artifactA, artifactB);

    // Same timings → all deltas should be 0
    for (const key of Object.keys(delta.timingDeltas)) {
      expect(delta.timingDeltas[key]).toBe(0);
    }
  });
});

// ---- JSON serialization ----------------------------------------------------

describe('JSON reporter', () => {
  it('round-trips through serialize/deserialize', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);

    const json = serializeArtifact(artifact);
    const parsed = deserializeArtifact(json);

    expect(parsed.version).toBe(1);
    expect(parsed.document.id).toBe('test-doc');
    expect(parsed.timings['open']).toBe(10);
    expect(parsed.counts['projection.blocksProjectedBeforeFirstPaint']).toBe(100);
  });

  it('produces deterministic JSON (sorted keys)', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);

    const json1 = serializeArtifact(artifact);
    const json2 = serializeArtifact(artifact);

    expect(json1).toBe(json2);
  });

  it('generates meaningful filenames', () => {
    const snapshot = createTestSnapshot();
    const artifact = createArtifact(snapshot, testEntry, 'v2', testMachine, testGit);

    const filename = artifactFilename(artifact);
    expect(filename).toContain('test-doc');
    expect(filename).toContain('v2');
    expect(filename).toContain('cold');
    expect(filename).toContain('abc123de');
    expect(filename).toMatch(/\.json$/);
  });

  it('rejects unknown artifact versions', () => {
    const badJson = JSON.stringify({ version: 99 });
    expect(() => deserializeArtifact(badJson)).toThrow('Unsupported artifact version: 99');
  });
});
