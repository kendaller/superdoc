// ---------------------------------------------------------------------------
// Corpus Manifest Loader
// ---------------------------------------------------------------------------
// Reads and validates a corpus manifest JSON file from disk, and resolves
// its entries into the input format expected by scanRawSurfaceCorpus.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { CorpusManifest } from './types.js';

/**
 * Load and validate a corpus manifest from a JSON file.
 *
 * Throws if the file is missing, malformed, or fails validation.
 */
export function loadCorpusManifest(manifestPath: string): CorpusManifest {
  const raw = readFileSync(manifestPath, 'utf-8');
  const data = JSON.parse(raw) as Record<string, unknown>;

  if (data.schemaVersion !== 1) {
    throw new Error(`Unsupported corpus manifest schemaVersion: ${data.schemaVersion} (expected 1)`);
  }

  if (!Array.isArray(data.documents)) {
    throw new Error('Corpus manifest must have a "documents" array');
  }

  const manifest = data as unknown as CorpusManifest;
  validateManifest(manifest);
  return manifest;
}

/**
 * Resolve manifest entries into the input format expected by the raw-surface
 * scanner: an array of { bytes, docId, sourceRelativePath }.
 *
 * Paths are resolved relative to the manifest file's directory.
 */
export function resolveManifestInputs(
  manifest: CorpusManifest,
  manifestPath: string,
): Array<{ bytes: Uint8Array; docId: string; sourceRelativePath: string }> {
  const basePath = dirname(resolve(manifestPath));

  return manifest.documents.map((entry) => {
    const filePath = resolve(basePath, entry.sourceRelativePath);
    const bytes = new Uint8Array(readFileSync(filePath));

    // Verify fingerprint if the manifest pins one
    if (entry.docFingerprint) {
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== entry.docFingerprint) {
        throw new Error(
          `Corpus drift detected for "${entry.docId}": ` +
          `manifest fingerprint ${entry.docFingerprint.slice(0, 16)}... ` +
          `does not match on-disk bytes ${actual.slice(0, 16)}...`,
        );
      }
    }

    return {
      bytes,
      docId: entry.docId,
      sourceRelativePath: entry.sourceRelativePath,
    };
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateManifest(manifest: CorpusManifest): void {
  if (manifest.documents.length === 0) {
    return; // empty corpus is valid
  }

  // Validate each entry has required fields
  for (let i = 0; i < manifest.documents.length; i++) {
    const doc = manifest.documents[i];
    if (!doc.docId || typeof doc.docId !== 'string') {
      throw new Error(`Corpus manifest entry [${i}] is missing a valid "docId"`);
    }
    if (!doc.sourceRelativePath || typeof doc.sourceRelativePath !== 'string') {
      throw new Error(`Corpus manifest entry [${i}] (${doc.docId}) is missing a valid "sourceRelativePath"`);
    }
  }

  // Validate documents are sorted by docId
  for (let i = 1; i < manifest.documents.length; i++) {
    const prev = manifest.documents[i - 1].docId;
    const curr = manifest.documents[i].docId;
    if (prev.localeCompare(curr) >= 0) {
      throw new Error(
        `Corpus manifest documents must be sorted by docId. ` +
        `Found "${curr}" after "${prev}".`,
      );
    }
  }
}
