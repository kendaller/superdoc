import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusEntry, CorpusManifest, ContentProfile, DocumentClass } from '@superdoc/v2-perf';
import { isManifestPopulated } from '@superdoc/v2-perf';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

export type ResolvedBenchmarkEntry = CorpusEntry & {
  absolutePath: string;
};

/**
 * Resolve the benchmark corpus for browser-driven TTFFP runs.
 *
 * Priority:
 * 1. `SUPERDOC_PERF_MANIFEST` when provided
 * 2. a small checked-in local corpus for deterministic developer runs
 */
export async function loadBrowserBenchmarkEntries(): Promise<ResolvedBenchmarkEntry[]> {
  const manifestPath = process.env.SUPERDOC_PERF_MANIFEST;

  const resolvedEntries = manifestPath ? await loadEntriesFromManifest(manifestPath) : await loadFallbackEntries();

  return applyEntryFilters(resolvedEntries);
}

async function loadEntriesFromManifest(manifestPath: string): Promise<ResolvedBenchmarkEntry[]> {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifestPath);
  const manifestJson = await readFile(absoluteManifestPath, 'utf8');
  const manifest = JSON.parse(manifestJson) as CorpusManifest;

  if (manifest.version !== 1) {
    throw new Error(`Unsupported benchmark manifest version: ${String((manifest as { version?: unknown }).version)}`);
  }

  if (!isManifestPopulated(manifest)) {
    throw new Error(
      `Benchmark manifest "${absoluteManifestPath}" does not contain any populated entries. ` +
        'Provide real document paths and byte sizes, or unset SUPERDOC_PERF_MANIFEST to use the local fallback corpus.',
    );
  }

  return Promise.all(
    manifest.entries.map(async (entry) => {
      const absolutePath = path.isAbsolute(entry.path) ? entry.path : path.resolve(manifestDirectory, entry.path);
      const entryStats = await stat(absolutePath);

      return {
        ...entry,
        bytes: entry.bytes > 0 ? entry.bytes : entryStats.size,
        absolutePath,
      };
    }),
  );
}

async function loadFallbackEntries(): Promise<ResolvedBenchmarkEntry[]> {
  return Promise.all(
    FALLBACK_CORPUS.map(async (entry) => {
      const absolutePath = path.resolve(REPO_ROOT, entry.path);
      const entryStats = await stat(absolutePath);

      return {
        ...entry,
        bytes: entryStats.size,
        absolutePath,
      };
    }),
  );
}

function applyEntryFilters(entries: ResolvedBenchmarkEntry[]): ResolvedBenchmarkEntry[] {
  const matchFilter = process.env.SUPERDOC_PERF_MATCH?.trim().toLowerCase();
  const limit = parsePositiveInteger(process.env.SUPERDOC_PERF_LIMIT);

  const matchedEntries = matchFilter
    ? entries.filter((entry) =>
        [entry.id, entry.label, entry.class, ...entry.profiles].join(' ').toLowerCase().includes(matchFilter),
      )
    : entries;

  if (limit == null) {
    return matchedEntries;
  }

  return matchedEntries.slice(0, limit);
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function createFallbackEntry({
  id,
  docClass,
  label,
  description,
  profiles,
  estimatedPages,
  path: relativePath,
}: {
  id: string;
  docClass: DocumentClass;
  label: string;
  description: string;
  profiles: readonly ContentProfile[];
  estimatedPages: number;
  path: string;
}): CorpusEntry {
  return {
    id,
    class: docClass,
    label,
    description,
    profiles,
    bytes: 0,
    estimatedPages,
    path: relativePath,
  };
}

const FALLBACK_CORPUS: readonly CorpusEntry[] = [
  createFallbackEntry({
    id: 'local-simple-letter',
    docClass: 'A',
    label: 'Local simple letter',
    description: 'Small single-section document for fast TTFFP smoke coverage.',
    profiles: ['text-only', 'lists'],
    estimatedPages: 1,
    path: 'packages/super-editor/src/editors/v1/tests/data/sd-1919-word-simple.docx',
  }),
  createFallbackEntry({
    id: 'local-commented-doc',
    docClass: 'B',
    label: 'Local commented document',
    description: 'Medium document with comments for browser benchmark regression checks.',
    profiles: ['comments', 'mixed'],
    estimatedPages: 3,
    path: 'packages/super-editor/src/editors/v1/tests/data/comment.docx',
  }),
  createFallbackEntry({
    id: 'local-contract-acc',
    docClass: 'B',
    label: 'Local contract ACC',
    description: 'Medium mixed-format contract used as a richer paginated benchmark input.',
    profiles: ['mixed', 'tables', 'lists'],
    estimatedPages: 8,
    path: 'packages/super-editor/src/editors/v1/tests/data/contract-acc.docx',
  }),
];
