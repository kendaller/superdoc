#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Raw Surface CLI
// ---------------------------------------------------------------------------
// Thin CLI wrapper for raw surface analysis.
//
// Usage:
//   pnpm --filter @superdoc/v2-analysis scan --input <file-or-dir> [--out <dir>]
//   pnpm --filter @superdoc/v2-analysis scan --manifest <path> [--out <dir>]
//
// Default output: v2/analysis/output/raw-surface/
//
// Accepts a single .docx file, a directory (recursed for .docx files),
// or a corpus manifest JSON file.
// Emits per-document artifacts and, when scanning multiple docs, corpus
// artifacts.
// ---------------------------------------------------------------------------

import { readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT = resolve(PACKAGE_ROOT, 'output/raw-surface');
import { scanDocument } from '../raw-surface/scan-document.js';
import { summarizeCorpus } from '../raw-surface/summarize-corpus.js';
import { writeDocumentArtifacts, writeCorpusArtifacts } from '../raw-surface/write-artifacts.js';
import type { RawSurfaceDocumentResult } from '../raw-surface/types.js';
import { loadCorpusManifest, resolveManifestInputs } from '../corpus-manifest/index.js';

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
    console.error('Usage: raw-surface --input <file-or-dir> [--out <output-dir>]');
    console.error('       raw-surface --manifest <manifest.json> [--out <output-dir>]');
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
// File discovery
// ---------------------------------------------------------------------------

type DocxInput = { filePath: string; docId: string; sourceRelativePath?: string; bytes?: Uint8Array };

function discoverInputs(inputPath: string): DocxInput[] {
  const stat = statSync(inputPath);

  if (stat.isFile()) {
    return [{ filePath: inputPath, docId: basename(inputPath) }];
  }

  if (stat.isDirectory()) {
    const files = fg.sync('**/*.docx', { cwd: inputPath, absolute: true }).sort();
    return files.map((filePath) => {
      const relativePath = relative(inputPath, filePath).replace(/\\/g, '/');
      return { filePath, docId: relativePath, sourceRelativePath: relativePath };
    });
  }

  console.error(`Input is neither a file nor directory: ${inputPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { input, manifest, out } = parseArgs(process.argv.slice(2));

  let inputs: DocxInput[];

  if (manifest) {
    const corpusManifest = loadCorpusManifest(manifest);
    const resolved = resolveManifestInputs(corpusManifest, manifest);
    inputs = resolved.map((r) => ({
      filePath: '', // not used when bytes are already loaded
      docId: r.docId,
      sourceRelativePath: r.sourceRelativePath,
      bytes: r.bytes,
    }));
    console.log(`Loaded manifest: ${corpusManifest.documents.length} document(s)`);
  } else {
    inputs = discoverInputs(input!);
  }

  if (inputs.length === 0) {
    console.error('No .docx files found.');
    process.exit(1);
  }

  // Clean output directory so stale results from prior runs don't linger
  rmSync(out, { recursive: true, force: true });

  console.log(`Scanning ${inputs.length} document(s)...`);

  const results: RawSurfaceDocumentResult[] = [];

  for (const entry of inputs) {
    const bytes = entry.bytes ?? new Uint8Array(readFileSync(entry.filePath));
    const result = await scanDocument(bytes, entry.docId, { sourceRelativePath: entry.sourceRelativePath });
    writeDocumentArtifacts(result, out);
    results.push(result);

    const diagCount = result.summary.scanDiagnostics.length;
    const diagLabel = diagCount > 0 ? ` (${diagCount} diagnostic(s))` : '';
    console.log(`  ${entry.docId}: ${result.summary.totalFacts} facts${diagLabel}`);
  }

  if (results.length > 1) {
    const { corpusSummary, signatureMatrix, examplesBySignature } = summarizeCorpus(results);
    writeCorpusArtifacts(corpusSummary, signatureMatrix, examplesBySignature, out);
    console.log(
      `\nCorpus summary: ${corpusSummary.totalFacts} total facts across ${corpusSummary.totalDocuments} documents`,
    );
    console.log(`Unique signatures: ${signatureMatrix.length}`);
  }

  console.log(`\nArtifacts written to: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
