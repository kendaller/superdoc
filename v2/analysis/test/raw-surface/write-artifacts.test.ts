import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDocumentArtifacts } from '../../src/raw-surface/write-artifacts.js';
import type { RawSurfaceDocumentResult } from '../../src/raw-surface/types.js';

function createDocumentResult(docId: string, docFingerprint: string): RawSurfaceDocumentResult {
  return {
    metadata: { docId, docFingerprint },
    packageIndex: {
      docId,
      docFingerprint,
      entries: [],
      relationships: [],
      scanDiagnostics: [],
    },
    facts: [
      {
        rawFactId: 'raw:1',
        docId,
        docFingerprint,
        partUri: 'word/document.xml',
        partKind: 'main-document',
        factKind: 'element',
        pathSignature: 'word/document.xml::/w:document/w:body/w:p',
        xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
        sourceRef: {
          partUri: 'word/document.xml',
          xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
        },
      },
    ],
    summary: {
      docId,
      docFingerprint,
      totalFacts: 1,
      countsByPartKind: { 'main-document': 1 },
      countsByFactKind: { element: 1 },
      countsByPathSignature: { 'word/document.xml::/w:document/w:body/w:p': 1 },
      countsByQName: {},
      countsByAttributeSignature: {},
      countsByRelationshipType: {},
      topSignatures: [{ pathSignature: 'word/document.xml::/w:document/w:body/w:p', count: 1 }],
      scanDiagnostics: [],
    },
  };
}

describe('write-artifacts', () => {
  it('writes colliding docIds to distinct directories', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'raw-surface-'));

    const first = createDocumentResult('a/b.docx', '11111111aaaaaaaa');
    const second = createDocumentResult('a_b.docx', '22222222bbbbbbbb');

    writeDocumentArtifacts(first, outputDir);
    writeDocumentArtifacts(second, outputDir);

    const docDirs = readdirSync(join(outputDir, 'docs')).sort();
    expect(docDirs).toEqual(['a_b.docx__11111111', 'a_b.docx__22222222']);

    const firstMetadata = JSON.parse(readFileSync(join(outputDir, 'docs', docDirs[0], 'metadata.json'), 'utf-8'));
    const secondMetadata = JSON.parse(readFileSync(join(outputDir, 'docs', docDirs[1], 'metadata.json'), 'utf-8'));

    expect(firstMetadata.docId).toBe('a/b.docx');
    expect(secondMetadata.docId).toBe('a_b.docx');
  });

  it('writes per-document raw-examples-by-signature.json', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'raw-surface-'));
    const result = createDocumentResult('example.docx', '33333333cccccccc');

    writeDocumentArtifacts(result, outputDir);

    const docDir = join(outputDir, 'docs', 'example.docx__33333333');
    const examples = JSON.parse(readFileSync(join(docDir, 'raw-examples-by-signature.json'), 'utf-8'));

    expect(examples).toEqual([
      {
        pathSignature: 'word/document.xml::/w:document/w:body/w:p',
        examples: [
          {
            docId: 'example.docx',
            xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
          },
        ],
      },
    ]);
  });
});
