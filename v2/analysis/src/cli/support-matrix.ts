#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Support Matrix CLI
// ---------------------------------------------------------------------------
// Joins the universe against a hand-curated support input file.
//
// Usage:
//   pnpm --filter @superdoc/v2-analysis support-matrix \
//     --universe <universe-dir> --support <support-input.json> [--out <dir>]
//
// Default: reads from output/universe/, support-input.json, writes to output/universe/
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSupportMatrix, writeSupportMatrixArtifacts } from '../support-matrix/index.js';
import type { CorpusUniverse } from '../universe/types.js';
import type { SupportInput } from '../support-matrix/types.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_UNIVERSE_DIR = resolve(PACKAGE_ROOT, 'output/universe');
const DEFAULT_SUPPORT_INPUT = resolve(PACKAGE_ROOT, 'support-input.json');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { universeDir: string; supportPath: string; out: string } {
  let universeDir: string | undefined;
  let supportPath: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--universe' && argv[i + 1]) {
      universeDir = argv[++i];
    } else if (argv[i] === '--support' && argv[i + 1]) {
      supportPath = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      out = argv[++i];
    }
  }

  const resolvedUniverse = resolve(universeDir ?? DEFAULT_UNIVERSE_DIR);
  const resolvedSupport = resolve(supportPath ?? DEFAULT_SUPPORT_INPUT);
  const resolvedOut = resolve(out ?? resolvedUniverse);

  return { universeDir: resolvedUniverse, supportPath: resolvedSupport, out: resolvedOut };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { universeDir, supportPath, out } = parseArgs(process.argv.slice(2));

  // Load corpus universe
  const corpusUniversePath = join(universeDir, 'corpus', 'corpus-universe.json');
  const corpusUniverse: CorpusUniverse = JSON.parse(readFileSync(corpusUniversePath, 'utf-8'));

  // Load support input
  const supportInput: SupportInput = JSON.parse(readFileSync(supportPath, 'utf-8'));

  console.log(`Joining ${corpusUniverse.features.length} universe features against support input...`);

  const matrix = buildSupportMatrix(corpusUniverse, supportInput);

  writeSupportMatrixArtifacts(matrix, out);

  // Summary
  const missing = matrix.missingFromInput.length;
  const extra = matrix.extraInInput.length;
  console.log(`\nSupport matrix: ${matrix.rows.length} rows`);
  if (missing > 0) console.log(`  Missing from input: ${missing} feature(s): ${matrix.missingFromInput.join(', ')}`);
  if (extra > 0) console.log(`  Extra in input: ${extra} feature(s): ${matrix.extraInInput.join(', ')}`);
  console.log(`Artifact written to: ${out}/corpus/support-matrix.json`);
}

main();
