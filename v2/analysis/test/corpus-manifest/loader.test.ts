import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { loadCorpusManifest, resolveManifestInputs } from '../../src/corpus-manifest/index.js';
import { createMinimalDocx } from '../helpers/create-test-docx.js';

function writeTempManifest(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-manifest-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  return path;
}

describe('loadCorpusManifest', () => {
  it('loads a valid manifest', () => {
    const path = writeTempManifest({
      schemaVersion: 1,
      documents: [
        { docId: 'a.docx', sourceRelativePath: 'docs/a.docx' },
        { docId: 'b.docx', sourceRelativePath: 'docs/b.docx' },
      ],
    });

    const manifest = loadCorpusManifest(path);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.documents).toHaveLength(2);
    expect(manifest.documents[0].docId).toBe('a.docx');
  });

  it('accepts an empty documents array', () => {
    const path = writeTempManifest({ schemaVersion: 1, documents: [] });
    const manifest = loadCorpusManifest(path);
    expect(manifest.documents).toHaveLength(0);
  });

  it('rejects unsupported schemaVersion', () => {
    const path = writeTempManifest({ schemaVersion: 99, documents: [] });
    expect(() => loadCorpusManifest(path)).toThrow('schemaVersion');
  });

  it('rejects missing documents array', () => {
    const path = writeTempManifest({ schemaVersion: 1 });
    expect(() => loadCorpusManifest(path)).toThrow('"documents" array');
  });

  it('rejects unsorted documents', () => {
    const path = writeTempManifest({
      schemaVersion: 1,
      documents: [
        { docId: 'z.docx', sourceRelativePath: 'z.docx' },
        { docId: 'a.docx', sourceRelativePath: 'a.docx' },
      ],
    });
    expect(() => loadCorpusManifest(path)).toThrow('sorted by docId');
  });

  it('rejects entry with missing docId', () => {
    const path = writeTempManifest({
      schemaVersion: 1,
      documents: [{ sourceRelativePath: 'a.docx' }],
    });
    expect(() => loadCorpusManifest(path)).toThrow('docId');
  });
});

describe('resolveManifestInputs', () => {
  it('resolves entries to bytes and metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'corpus-resolve-'));
    const docsDir = join(dir, 'docs');
    mkdirSync(docsDir, { recursive: true });

    // Write a test .docx file
    const docxBytes = createMinimalDocx();
    writeFileSync(join(docsDir, 'test.docx'), docxBytes);

    // Write manifest
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        documents: [{ docId: 'test.docx', sourceRelativePath: 'docs/test.docx' }],
      }),
    );

    const manifest = loadCorpusManifest(manifestPath);
    const inputs = resolveManifestInputs(manifest, manifestPath);

    expect(inputs).toHaveLength(1);
    expect(inputs[0].docId).toBe('test.docx');
    expect(inputs[0].sourceRelativePath).toBe('docs/test.docx');
    expect(inputs[0].bytes).toBeInstanceOf(Uint8Array);
    expect(inputs[0].bytes.length).toBeGreaterThan(0);
  });

  it('accepts matching docFingerprint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'corpus-fp-'));
    const docsDir = join(dir, 'docs');
    mkdirSync(docsDir, { recursive: true });

    const docxBytes = createMinimalDocx();
    const fingerprint = createHash('sha256').update(docxBytes).digest('hex');
    writeFileSync(join(docsDir, 'test.docx'), docxBytes);

    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        documents: [{ docId: 'test.docx', sourceRelativePath: 'docs/test.docx', docFingerprint: fingerprint }],
      }),
    );

    const manifest = loadCorpusManifest(manifestPath);
    const inputs = resolveManifestInputs(manifest, manifestPath);
    expect(inputs).toHaveLength(1);
  });

  it('rejects mismatched docFingerprint (corpus drift)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'corpus-drift-'));
    const docsDir = join(dir, 'docs');
    mkdirSync(docsDir, { recursive: true });

    writeFileSync(join(docsDir, 'test.docx'), createMinimalDocx());

    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        documents: [{ docId: 'test.docx', sourceRelativePath: 'docs/test.docx', docFingerprint: 'wrong_fingerprint' }],
      }),
    );

    const manifest = loadCorpusManifest(manifestPath);
    expect(() => resolveManifestInputs(manifest, manifestPath)).toThrow('Corpus drift');
  });
});
