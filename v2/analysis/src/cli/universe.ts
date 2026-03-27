#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Universe CLI
// ---------------------------------------------------------------------------
// Thin CLI wrapper for Layer 1 universe building.
//
// Usage:
//   pnpm --filter @superdoc/v2-analysis universe --input <raw-surface-dir> [--out <dir>]
//   pnpm --filter @superdoc/v2-analysis universe --manifest <manifest.json> [--out <dir>]
//
// --input:    Reads pre-computed raw-surface artifacts and builds the universe.
// --manifest: Runs raw-surface scan from a corpus manifest, then builds the universe.
//
// Default output: v2/analysis/output/universe/
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDocument } from '../raw-surface/scan-document.js';
import { loadCorpusManifest, resolveManifestInputs } from '../corpus-manifest/index.js';
import { buildUniverseFromCorpus } from '../universe/api.js';
import { writeUniverseArtifacts } from '../universe/write-artifacts.js';
import type { RawSurfaceDocumentResult } from '../raw-surface/types.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT = resolve(PACKAGE_ROOT, 'output/universe');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { input?: string; manifest?: string; out: string } {
  let input: string | undefined;
  let manifest: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) {
      input = argv[++i];
    } else if (argv[i] === '--manifest' && argv[i + 1]) {
      manifest = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      out = argv[++i];
    }
  }

  if (!input && !manifest) {
    console.error('Usage: universe --input <raw-surface-dir> [--out <dir>]');
    console.error('       universe --manifest <manifest.json> [--out <dir>]');
    process.exit(1);
  }

  if (input && manifest) {
    console.error('Error: --input and --manifest are mutually exclusive.');
    process.exit(1);
  }

  return {
    input: input ? resolve(input) : undefined,
    manifest: manifest ? resolve(manifest) : undefined,
    out: resolve(out ?? DEFAULT_OUT),
  };
}

// ---------------------------------------------------------------------------
// Load raw-surface results from pre-computed artifacts
// ---------------------------------------------------------------------------

async function loadFromRawSurfaceDir(rawSurfaceDir: string): Promise<RawSurfaceDocumentResult[]> {
  const docsDir = join(rawSurfaceDir, 'docs');
  const slugs = readdirSync(docsDir)
    .filter((name) => !name.startsWith('.') && statSync(join(docsDir, name)).isDirectory())
    .sort();
  const results: RawSurfaceDocumentResult[] = [];

  for (const slug of slugs) {
    const docDir = join(docsDir, slug);
    const metadata = JSON.parse(readFileSync(join(docDir, 'metadata.json'), 'utf-8'));
    const packageIndex = JSON.parse(readFileSync(join(docDir, 'package-index.json'), 'utf-8'));
    const summary = JSON.parse(readFileSync(join(docDir, 'raw-summary.json'), 'utf-8'));

    // Read NDJSON facts
    const ndjsonContent = readFileSync(join(docDir, 'raw-surface.ndjson'), 'utf-8');
    const facts = ndjsonContent
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));

    results.push({ metadata, packageIndex, facts, summary });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Load from manifest (scan + build)
// ---------------------------------------------------------------------------

async function loadFromManifest(manifestPath: string): Promise<RawSurfaceDocumentResult[]> {
  const manifest = loadCorpusManifest(manifestPath);
  const inputs = resolveManifestInputs(manifest, manifestPath);
  const results: RawSurfaceDocumentResult[] = [];

  console.log(`Scanning ${inputs.length} document(s) from manifest...`);

  for (const { bytes, docId, sourceRelativePath } of inputs) {
    const result = await scanDocument(bytes, docId, { sourceRelativePath });
    results.push(result);
    console.log(`  ${docId}: ${result.summary.totalFacts} facts`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { input, manifest, out } = parseArgs(process.argv.slice(2));

  const results = manifest
    ? await loadFromManifest(manifest)
    : await loadFromRawSurfaceDir(input!);

  if (results.length === 0) {
    console.error('No documents found.');
    process.exit(1);
  }

  console.log(`Building universe from ${results.length} document(s)...`);

  const universe = buildUniverseFromCorpus(results);

  // Clean and write output
  rmSync(out, { recursive: true, force: true });
  writeUniverseArtifacts(universe, out);

  // Summary
  const included = universe.universeManifest.includedDocuments;
  const excluded = universe.universeManifest.excludedDocuments;
  const features = universe.corpusUniverse.features.length;
  const unmapped = universe.unmappedRawSurface.totalUnmapped;

  console.log(`\nUniverse built: ${features} features, ${included} included docs, ${excluded} excluded`);
  console.log(`Unmapped facts: ${unmapped}`);
  console.log(`Artifacts written to: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
