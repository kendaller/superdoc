#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Raw Surface CLI
// ---------------------------------------------------------------------------
// Thin CLI wrapper for raw surface analysis.
//
// Usage:
//   pnpm --filter @superdoc/v2-analysis scan --input <file-or-dir> [--out <dir>]
//
// Default output: v2/analysis/output/raw-surface/
//
// Accepts a single .docx file or a directory (recursed for .docx files).
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

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { input: string; out: string } {
  let input: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) {
      input = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      out = argv[++i];
    }
  }

  if (!input) {
    console.error('Usage: raw-surface --input <file-or-dir> [--out <output-dir>]');
    process.exit(1);
  }

  return { input: resolve(input), out: resolve(out ?? DEFAULT_OUT) };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

type DocxInput = { filePath: string; docId: string; sourceRelativePath?: string };

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
  const { input, out } = parseArgs(process.argv.slice(2));
  const inputs = discoverInputs(input);

  if (inputs.length === 0) {
    console.error('No .docx files found.');
    process.exit(1);
  }

  // Clean output directory so stale results from prior runs don't linger
  rmSync(out, { recursive: true, force: true });

  console.log(`Scanning ${inputs.length} document(s)...`);

  const results: RawSurfaceDocumentResult[] = [];

  for (const { filePath, docId, sourceRelativePath } of inputs) {
    const bytes = new Uint8Array(readFileSync(filePath));
    const result = await scanDocument(bytes, docId, { sourceRelativePath });
    writeDocumentArtifacts(result, out);
    results.push(result);

    const diagCount = result.summary.scanDiagnostics.length;
    const diagLabel = diagCount > 0 ? ` (${diagCount} diagnostic(s))` : '';
    console.log(`  ${docId}: ${result.summary.totalFacts} facts${diagLabel}`);
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
