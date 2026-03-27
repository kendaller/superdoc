import { describe, it, expect } from 'vitest';
import { buildSupportMatrix } from '../../src/support-matrix/join.js';
import { buildUniverseFromCorpus } from '../../src/universe/api.js';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createMinimalDocx } from '../helpers/create-test-docx.js';
import type { SupportInput } from '../../src/support-matrix/types.js';

async function buildTestUniverse() {
  const r = await scanRawSurface(createMinimalDocx(), 'test.docx');
  return buildUniverseFromCorpus([r]);
}

describe('buildSupportMatrix', () => {
  it('produces a row for every universe feature', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = { schemaVersion: 1, entries: [] };
    const matrix = buildSupportMatrix(universe.corpusUniverse, supportInput);

    expect(matrix.rows.length).toBe(universe.corpusUniverse.features.length);
  });

  it('defaults missing entries to unknown for both current and v2', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = { schemaVersion: 1, entries: [] };
    const matrix = buildSupportMatrix(universe.corpusUniverse, supportInput);

    for (const row of matrix.rows) {
      expect(row.currentSuperDoc.import).toBe('unknown');
      expect(row.currentSuperDoc.layout).toBe('unknown');
      expect(row.currentSuperDoc.render).toBe('unknown');
      expect(row.v2Target.semanticRead).toBe('unknown');
      expect(row.v2Target.semanticWrite).toBe('unknown');
    }
  });

  it('uses provided current and v2 target status', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = {
      schemaVersion: 1,
      entries: [
        {
          featureKey: 'paragraph',
          import: 'yes', layout: 'yes', render: 'yes',
          v2SemanticRead: 'yes', v2SemanticWrite: 'no',
        },
      ],
    };
    const matrix = buildSupportMatrix(universe.corpusUniverse, supportInput);

    const paraRow = matrix.rows.find((r) => r.featureKey === 'paragraph')!;
    expect(paraRow.currentSuperDoc.import).toBe('yes');
    expect(paraRow.v2Target.semanticRead).toBe('yes');
    expect(paraRow.v2Target.semanticWrite).toBe('no');
  });

  it('partial status requires a note', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = {
      schemaVersion: 1,
      entries: [
        { featureKey: 'paragraph', import: 'partial', layout: 'yes', render: 'yes' },
      ],
    };

    expect(() => buildSupportMatrix(universe.corpusUniverse, supportInput)).toThrow('importNote');
  });

  it('partial status with note is accepted', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = {
      schemaVersion: 1,
      entries: [
        {
          featureKey: 'run',
          import: 'yes', layout: 'partial', render: 'partial',
          layoutNote: 'some runs unsupported', renderNote: 'same issue as layout',
        },
      ],
    };
    const matrix = buildSupportMatrix(universe.corpusUniverse, supportInput);

    const runRow = matrix.rows.find((r) => r.featureKey === 'run')!;
    expect(runRow.currentSuperDoc.layout).toBe('partial');
    expect(runRow.currentSuperDoc.layoutNote).toBe('some runs unsupported');
  });

  it('reports missing features from support input', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = { schemaVersion: 1, entries: [] };
    const matrix = buildSupportMatrix(universe.corpusUniverse, supportInput);

    expect(matrix.missingFromInput.length).toBe(universe.corpusUniverse.features.length);
  });

  it('reports extra features in support input', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = {
      schemaVersion: 1,
      entries: [
        { featureKey: 'nonexistent.feature', import: 'no', layout: 'no', render: 'no' },
      ],
    };
    const matrix = buildSupportMatrix(universe.corpusUniverse, supportInput);

    expect(matrix.extraInInput).toContain('nonexistent.feature');
  });

  it('rejects duplicate featureKey entries in support input', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = {
      schemaVersion: 1,
      entries: [
        { featureKey: 'paragraph', import: 'yes', layout: 'yes', render: 'yes' },
        { featureKey: 'paragraph', import: 'no', layout: 'no', render: 'no' },
      ],
    };

    expect(() => buildSupportMatrix(universe.corpusUniverse, supportInput)).toThrow('Duplicate featureKey');
  });

  it('rejects invalid status values', async () => {
    const universe = await buildTestUniverse();
    const supportInput = {
      schemaVersion: 1,
      entries: [
        { featureKey: 'paragraph', import: 'invalid-status', layout: 'yes', render: 'yes' },
      ],
    } as unknown as SupportInput;

    expect(() => buildSupportMatrix(universe.corpusUniverse, supportInput)).toThrow('Invalid');
  });

  it('rows are sorted by featureKey', async () => {
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = { schemaVersion: 1, entries: [] };
    const matrix = buildSupportMatrix(universe.corpusUniverse, supportInput);

    for (let i = 1; i < matrix.rows.length; i++) {
      expect(
        matrix.rows[i - 1].featureKey.localeCompare(matrix.rows[i].featureKey),
      ).toBeLessThan(0);
    }
  });

  it('every status value is in the allowed vocabulary', async () => {
    const validStatuses = new Set(['yes', 'partial', 'no', 'unknown', 'not-applicable']);
    const universe = await buildTestUniverse();
    const supportInput: SupportInput = { schemaVersion: 1, entries: [] };
    const matrix = buildSupportMatrix(universe.corpusUniverse, supportInput);

    for (const row of matrix.rows) {
      expect(validStatuses.has(row.currentSuperDoc.import)).toBe(true);
      expect(validStatuses.has(row.currentSuperDoc.layout)).toBe(true);
      expect(validStatuses.has(row.currentSuperDoc.render)).toBe(true);
      expect(validStatuses.has(row.v2Target.semanticRead)).toBe(true);
      expect(validStatuses.has(row.v2Target.semanticWrite)).toBe(true);
    }
  });
});
