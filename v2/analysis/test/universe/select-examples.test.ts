import { describe, it, expect } from 'vitest';
import { selectFeatureExamples } from '../../src/universe/select-examples.js';
import { buildDocumentUniverse } from '../../src/universe/build-document-universe.js';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx } from '../helpers/create-test-docx.js';

describe('selectFeatureExamples', () => {
  it('selects examples for each feature', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc.docx');
    const du = buildDocumentUniverse(r1);
    const examples = selectFeatureExamples([du]);

    expect(examples.schemaVersion).toBe(1);
    expect(examples.examples.length).toBeGreaterThan(0);

    // Each example entry should have at least one selection
    for (const entry of examples.examples) {
      expect(entry.selections.length).toBeGreaterThan(0);
      expect(entry.featureKey).toBeTruthy();
    }
  });

  it('caps examples at maxExamples', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc.docx');
    const du = buildDocumentUniverse(r1);
    const examples = selectFeatureExamples([du], 2);

    for (const entry of examples.examples) {
      expect(entry.selections.length).toBeLessThanOrEqual(2);
    }
  });

  it('prefers doc diversity when multiple docs have the same feature', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc-a.docx');
    const r2 = await scanRawSurface(createMinimalDocx(), 'doc-b.docx');
    const du1 = buildDocumentUniverse(r1);
    const du2 = buildDocumentUniverse(r2);

    const examples = selectFeatureExamples([du1, du2], 5);

    // paragraph feature should have examples from both docs
    const paraEntry = examples.examples.find((e) => e.featureKey === 'paragraph');
    expect(paraEntry).toBeDefined();
    const docIds = new Set(paraEntry!.selections.map((s) => s.docId));
    expect(docIds.size).toBe(2);
  });

  it('examples are sorted by featureKey', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc.docx');
    const du = buildDocumentUniverse(r1);
    const examples = selectFeatureExamples([du]);

    for (let i = 1; i < examples.examples.length; i++) {
      expect(examples.examples[i - 1].featureKey.localeCompare(examples.examples[i].featureKey)).toBeLessThan(0);
    }
  });

  it('selections within a feature are sorted by docId then occurrenceId', async () => {
    const r1 = await scanRawSurface(createMinimalDocx(), 'doc-a.docx');
    const r2 = await scanRawSurface(createMinimalDocx(), 'doc-b.docx');
    const du1 = buildDocumentUniverse(r1);
    const du2 = buildDocumentUniverse(r2);
    const examples = selectFeatureExamples([du1, du2]);

    for (const entry of examples.examples) {
      for (let i = 1; i < entry.selections.length; i++) {
        const prev = entry.selections[i - 1];
        const curr = entry.selections[i];
        const cmp = prev.docId.localeCompare(curr.docId) || prev.occurrenceId.localeCompare(curr.occurrenceId);
        expect(cmp).toBeLessThanOrEqual(0);
      }
    }
  });
});
