import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artifactFilename,
  compareArtifacts,
  formatDeltaTable,
  formatSummaryTable,
  serializeArtifact,
  serializeBatch,
  type BenchmarkArtifact,
  type CorpusEntry,
} from '@superdoc/v2-perf';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const DEFAULT_RESULTS_ROOT = path.resolve(REPO_ROOT, 'tests/perf/results/v2-fast-first-paint');

export type PersistBenchmarkArtifactsOptions = {
  artifacts: readonly BenchmarkArtifact[];
  corpusEntries: readonly CorpusEntry[];
  runLabel?: string;
};

export type PersistedBenchmarkArtifacts = {
  outputDirectory: string;
  summaryTable: string;
  deltaTable: string | null;
};

export async function persistBenchmarkArtifacts(
  options: PersistBenchmarkArtifactsOptions,
): Promise<PersistedBenchmarkArtifacts> {
  const outputDirectory = await resolveOutputDirectory(options.runLabel);
  const summaryTable = formatSummaryTable(options.artifacts);
  const deltaTable = buildPmDeltaTable(options.artifacts);

  await Promise.all([
    ...options.artifacts.map((artifact) =>
      writeFile(path.join(outputDirectory, artifactFilename(artifact)), serializeArtifact(artifact)),
    ),
    writeFile(path.join(outputDirectory, 'artifacts.json'), serializeBatch(options.artifacts)),
    writeFile(path.join(outputDirectory, 'summary.txt'), summaryTable),
    writeFile(path.join(outputDirectory, 'corpus.json'), JSON.stringify(options.corpusEntries, null, 2)),
    ...(deltaTable ? [writeFile(path.join(outputDirectory, 'deltas-vs-pm.txt'), deltaTable)] : []),
  ]);

  return {
    outputDirectory,
    summaryTable,
    deltaTable,
  };
}

async function resolveOutputDirectory(runLabel?: string): Promise<string> {
  const explicitOutputDirectory = process.env.SUPERDOC_PERF_OUTPUT_DIR?.trim();
  const outputDirectory = explicitOutputDirectory
    ? path.resolve(explicitOutputDirectory)
    : path.join(DEFAULT_RESULTS_ROOT, buildRunDirectoryName(runLabel));

  await mkdir(outputDirectory, { recursive: true });
  return outputDirectory;
}

function buildRunDirectoryName(runLabel?: string): string {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const safeLabel = sanitizePathSegment(runLabel);
  return safeLabel ? `${timestamp}_${safeLabel}` : timestamp;
}

function sanitizePathSegment(value?: string): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildPmDeltaTable(artifacts: readonly BenchmarkArtifact[]): string | null {
  const pmArtifactsByDocumentId = new Map(
    artifacts.filter((artifact) => artifact.mode === 'pm').map((artifact) => [artifact.document.id, artifact]),
  );

  const deltas = artifacts
    .filter((artifact) => artifact.mode !== 'pm')
    .flatMap((artifact) => {
      const pmArtifact = pmArtifactsByDocumentId.get(artifact.document.id);
      return pmArtifact ? [compareArtifacts(pmArtifact, artifact)] : [];
    });

  return deltas.length > 0 ? formatDeltaTable(deltas) : null;
}
