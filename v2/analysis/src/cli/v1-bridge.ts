#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// V1 Runtime Bridge CLI
// ---------------------------------------------------------------------------
// Runs the v1 bridge pipeline on a corpus of documents, joining pre-built
// provenance artifacts against the universe to produce runtime observations.
//
// Usage:
//   pnpm --filter @superdoc/v2-analysis v1-bridge \
//     --provenance <provenance-dir> \
//     --universe <universe-dir> \
//     [--out <dir>]
//
// The provenance directory must contain per-doc subdirectories with
// provenance.json files (produced by the headless import wrapper).
//
// The universe directory must contain per-doc document-universe.json files
// (produced by the universe CLI).
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocumentUniverse } from '../universe/types.js';
import type { RuntimeObservation, RuntimeDocumentStatus } from '../runtime/types.js';
import type { V1ResolvedProvenance } from '../runtime/v1/types.js';
import { runV1Pipeline } from '../runtime/v1/pipeline.js';
import { buildV1Capabilities, V1_ADAPTER_VERSION } from '../runtime/v1/capabilities.js';
import {
  buildRuntimeSummary,
  buildRuntimeManifest,
  buildDocumentManifestEntry,
} from '../runtime/v1/summarize.js';
import {
  writeDocObservations,
  writeCorpusRuntimeArtifacts,
} from '../runtime/v1/write-artifacts.js';
import type { RuntimeGaps } from '../runtime/types.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT = resolve(PACKAGE_ROOT, 'output/universe');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  provenance: string;
  universe: string;
  out: string;
} {
  let provenance: string | undefined;
  let universe: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provenance' && argv[i + 1]) {
      provenance = argv[++i];
    } else if (argv[i] === '--universe' && argv[i + 1]) {
      universe = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      out = argv[++i];
    }
  }

  if (!provenance || !universe) {
    console.error('Usage: v1-bridge --provenance <dir> --universe <dir> [--out <dir>]');
    process.exit(1);
  }

  return {
    provenance: resolve(provenance),
    universe: resolve(universe),
    out: resolve(out ?? DEFAULT_OUT),
  };
}

// ---------------------------------------------------------------------------
// Load provenance and universe artifacts
// ---------------------------------------------------------------------------

function loadDocSlugs(dir: string): string[] {
  const docsDir = join(dir, 'docs');
  try {
    return readdirSync(docsDir)
      .filter((name) => !name.startsWith('.') && statSync(join(docsDir, name)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

function loadProvenance(dir: string, slug: string): V1ResolvedProvenance | null {
  try {
    const filePath = join(dir, 'docs', slug, 'provenance.json');
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadDocumentUniverse(dir: string, slug: string): DocumentUniverse | null {
  try {
    const filePath = join(dir, 'docs', slug, 'document-universe.json');
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { provenance: provDir, universe: univDir, out } = parseArgs(process.argv.slice(2));

  // Find all doc slugs from the universe directory
  const slugs = loadDocSlugs(univDir);
  if (slugs.length === 0) {
    console.error('No documents found in universe directory.');
    process.exit(1);
  }

  console.log(`Processing ${slugs.length} document(s)...`);

  const allObservations: RuntimeObservation[][] = [];
  const manifestEntries: RuntimeDocumentStatus[] = [];
  const allGapEntries: RuntimeGaps['gaps'] = [];

  for (const slug of slugs) {
    const provenance = loadProvenance(provDir, slug);
    const universe = loadDocumentUniverse(univDir, slug);

    if (!universe) {
      console.log(`  ${slug}: skipped (no universe)`);
      manifestEntries.push({
        docId: slug,
        status: 'skipped',
        stagesRun: [],
        observationCount: 0,
        diagnostics: ['No document-universe.json found'],
      });
      continue;
    }

    if (!provenance) {
      console.log(`  ${slug}: skipped (no provenance)`);
      manifestEntries.push({
        docId: universe.docId,
        status: 'skipped',
        stagesRun: [],
        observationCount: 0,
        diagnostics: ['No provenance.json found'],
      });
      continue;
    }

    // Run the v1 bridge pipeline
    const result = runV1Pipeline({
      provenance,
      universe,
      docId: universe.docId,
    });

    // Write per-doc artifacts
    writeDocObservations(out, slug, result.observations, universe.docId);

    // Accumulate for corpus-level aggregation
    allObservations.push(result.observations);
    manifestEntries.push(
      buildDocumentManifestEntry(universe.docId, result.observations, 'ok', result.diagnostics),
    );
    allGapEntries.push(...result.gaps.gaps);

    console.log(`  ${slug}: ${result.observations.length} observations, ${result.gaps.totalGaps} gaps`);
  }

  // Build and write corpus-level artifacts
  const capabilities = buildV1Capabilities();
  const manifest = buildRuntimeManifest(manifestEntries);
  const summary = buildRuntimeSummary(allObservations);
  const corpusGaps: RuntimeGaps = {
    schemaVersion: 1,
    runtime: 'v1',
    adapterVersion: V1_ADAPTER_VERSION,
    totalGaps: allGapEntries.length,
    gaps: allGapEntries.sort((a, b) => {
      const kindCmp = a.gapKind.localeCompare(b.gapKind);
      if (kindCmp !== 0) return kindCmp;
      return a.docId.localeCompare(b.docId);
    }),
  };

  writeCorpusRuntimeArtifacts(out, manifest, capabilities, summary, corpusGaps);

  // Summary output
  const totalObs = allObservations.reduce((sum, obs) => sum + obs.length, 0);
  console.log(`\nV1 bridge complete:`);
  console.log(`  ${manifestEntries.filter((d) => d.status === 'ok').length} documents processed`);
  console.log(`  ${totalObs} total observations`);
  console.log(`  ${allGapEntries.length} total gaps`);
  console.log(`  Artifacts written to: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
