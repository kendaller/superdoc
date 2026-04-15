import { describe, expect, it } from 'vitest';
import { buildCoarsePages } from './V2CoarsePagePlanner.js';

function makeParagraph(id: string, text: string) {
  return {
    kind: 'paragraph' as const,
    id,
    runs: [
      {
        kind: 'text' as const,
        text,
        fontFamily: 'Arial',
        fontSize: 16,
      },
    ],
    attrs: {},
  };
}

describe('V2CoarsePagePlanner', () => {
  it('builds a multi-page placeholder layout from projected blocks', () => {
    const blocks = Array.from({ length: 80 }, (_unused, index) => makeParagraph(`p-${index + 1}`, 'x '.repeat(140)));

    const pages = buildCoarsePages({
      blocks,
      defaultPageSize: { w: 612, h: 792 },
      defaultMargins: { top: 72, right: 72, bottom: 72, left: 72 },
      maxPageCount: 1000,
    });

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toMatchObject({
      number: 1,
      numberText: '1',
      fragments: [],
      size: { w: 612, h: 792 },
    });
    expect(pages.at(-1)?.number).toBe(pages.length);
  });
});
