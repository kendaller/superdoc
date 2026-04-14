import { describe, it, expect } from 'vitest';
import { createSession, advanceToStage } from '../src/session/session.js';
import { createHandle } from '../src/session/handle.js';
import { SemanticModel } from '../src/model.js';
import { createComplexDocx } from './helpers/create-test-docx.js';
import { createFormattedParagraphDocx, createSdtDocx } from './helpers/create-rich-docx.js';

async function buildModel(bytes: Uint8Array): Promise<SemanticModel> {
  const session = createSession({ kind: 'memory', bytes });
  await advanceToStage(session, 'structure');
  const handle = createHandle(session);
  return new SemanticModel(session, handle.views());
}

describe('source node paths', () => {
  it('uses same-name sibling indexing for top-level and nested body content', async () => {
    const model = await buildModel(createSdtDocx());

    const paragraphs = model.allParagraphs();
    const paragraphPaths = paragraphs.map((paragraph) => paragraph.sourceRefs[0]?.sourceNodePath);

    expect(paragraphPaths).toContain('w:body/w:p[1]');
    expect(paragraphPaths).toContain('w:body/w:sdt[1]/w:sdtContent[1]/w:p[1]');
  });

  it('builds nested run paths from the actual paragraph tree', async () => {
    const model = await buildModel(createFormattedParagraphDocx());
    const firstParagraph = model.allParagraphs()[0];

    const runPaths = model.runs(firstParagraph.ref).map((run) => run.sourceRefs[0]?.sourceNodePath);

    expect(runPaths).toEqual(['w:body/w:p[1]/w:r[1]', 'w:body/w:p[1]/w:r[2]']);
  });

  it('roots secondary-story and annotation paths to their own part containers', async () => {
    const model = await buildModel(createComplexDocx());
    const paragraphPaths = model.allParagraphs().map((paragraph) => paragraph.sourceRefs[0]?.sourceNodePath);

    expect(paragraphPaths).toContain('w:hdr/w:p[1]');
    expect(paragraphPaths).toContain('w:ftr/w:p[1]');
    expect(paragraphPaths).toContain('w:comments/w:comment[1]/w:p[1]');

    const commentThreadPath = model.allEntities('commentThread')[0]?.sourceRefs[0]?.sourceNodePath;
    const sectionPath = model.sections()[0]?.sourceRefs[0]?.sourceNodePath;

    expect(commentThreadPath).toBe('w:comments/w:comment[1]');
    expect(sectionPath).toBe('w:body/w:sectPr[1]');
  });

  it('resolves entities by exact source path and by node-id fallback', async () => {
    const model = await buildModel(createFormattedParagraphDocx());
    const paragraph = model.allParagraphs()[0];
    const paragraphSourceRef = paragraph.sourceRefs[0];

    expect(paragraphSourceRef?.sourceNodePath).toBeDefined();

    const exactMatch = model.entityBySourceRef(paragraphSourceRef!);
    const pathOnlyMatch = model.entityBySourceRef({
      partUri: paragraphSourceRef!.partUri,
      nodeId: 'different-session-node-id',
      sourceNodePath: paragraphSourceRef!.sourceNodePath,
    });
    const looseMatch = model.entityBySourceRef({
      partUri: paragraphSourceRef!.partUri,
      nodeId: paragraphSourceRef!.nodeId,
    });

    expect(exactMatch?.ref.id).toBe(paragraph.ref.id);
    expect(pathOnlyMatch?.ref.id).toBe(paragraph.ref.id);
    expect(looseMatch?.ref.id).toBe(paragraph.ref.id);
  });
});
