import { describe, it, expect } from 'vitest';
import { formatSummaryTable, formatDeltaTable } from '../src/reporters/table-reporter.js';
import {
  createArtifact,
  compareArtifacts,
  type BenchmarkArtifact,
  type MachineInfo,
  type GitInfo,
} from '../src/artifact.js';
import type { TimelineSnapshot } from '../src/timeline.js';
import type { CorpusEntry } from '../src/corpus.js';

const machine: MachineInfo = { platform: 'darwin', arch: 'arm64', cpuCores: 10, memoryGb: 16 };
const git: GitInfo = { sha: 'abc123', branch: 'main', dirty: false };

function makeEntry(id: string, label: string, docClass: 'A' | 'B' | 'C' | 'D'): CorpusEntry {
  return {
    id,
    class: docClass,
    label,
    description: '',
    profiles: ['text-only'],
    bytes: 1024,
    estimatedPages: 5,
    path: '',
  };
}

function makeSnapshot(overrides: Partial<TimelineSnapshot> = {}): TimelineSnapshot {
  return {
    originMs: 0,
    marks: [],
    spans: [],
    counts: {},
    timings: { open: 10, projection: 15, 'layout.measurement': 20, 'layout.pagination': 5, paint: 5, render: 55 },
    ...overrides,
  };
}

describe('formatSummaryTable()', () => {
  it('formats a non-empty table', () => {
    const artifact = createArtifact(makeSnapshot(), makeEntry('a', 'Doc A', 'A'), 'v2', machine, git);
    const table = formatSummaryTable([artifact]);

    expect(table).toContain('Document');
    expect(table).toContain('TTFP');
    expect(table).toContain('Doc A');
    expect(table).toContain('v2');
  });

  it('sorts by class then TTFP', () => {
    const fast = createArtifact(
      makeSnapshot({ timings: { render: 10 } }),
      makeEntry('fast', 'Fast Doc', 'A'),
      'v2',
      machine,
      git,
    );
    const slow = createArtifact(
      makeSnapshot({ timings: { render: 100 } }),
      makeEntry('slow', 'Slow Doc', 'A'),
      'pm',
      machine,
      git,
    );
    const classC = createArtifact(
      makeSnapshot({ timings: { render: 50 } }),
      makeEntry('big', 'Big Doc', 'C'),
      'v2',
      machine,
      git,
    );

    const table = formatSummaryTable([slow, classC, fast]);
    const lines = table.split('\n');

    // Class A should appear before Class C
    const fastLine = lines.findIndex((l) => l.includes('Fast Doc'));
    const slowLine = lines.findIndex((l) => l.includes('Slow Doc'));
    const bigLine = lines.findIndex((l) => l.includes('Big Doc'));

    expect(fastLine).toBeLessThan(slowLine);
    expect(slowLine).toBeLessThan(bigLine);
  });

  it('handles empty artifact list', () => {
    expect(formatSummaryTable([])).toBe('(no benchmark results)');
  });
});

describe('formatDeltaTable()', () => {
  it('formats deltas between artifacts', () => {
    const artifactA = createArtifact(makeSnapshot(), makeEntry('a', 'Doc A', 'A'), 'pm', machine, git);
    const artifactB = createArtifact(
      makeSnapshot({ timings: { render: 30 } }),
      makeEntry('a', 'Doc A', 'A'),
      'v2',
      machine,
      git,
    );

    const delta = compareArtifacts(artifactA, artifactB);
    const table = formatDeltaTable([delta]);

    expect(table).toContain('TTFP Delta');
    expect(table).toContain('TTFP %');
    expect(table).toContain('-'); // negative delta
  });

  it('handles empty delta list', () => {
    expect(formatDeltaTable([])).toBe('(no deltas to display)');
  });
});
