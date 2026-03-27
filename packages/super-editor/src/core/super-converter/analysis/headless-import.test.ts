import { describe, expect, it } from 'vitest';
import { buildStoryInputs } from './headless-import.js';

describe('buildStoryInputs', () => {
  it('uses imported comment IDs for comment story keys', () => {
    const stories = buildStoryInputs(
      {
        comments: [
          {
            commentId: 'internal-comment-id',
            importedId: '7',
            elements: [{ type: 'paragraph', content: [] }],
          },
        ],
      },
      {} as never,
    );

    expect(stories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storyRef: {
            storyKind: 'comment',
            storyKey: 'comment:7',
          },
        }),
      ]),
    );
  });

  it('uses resolved header and footer part URIs when available', () => {
    const stories = buildStoryInputs(
      {
        headers: { rId8: { type: 'doc', content: [] } },
        footers: { rId9: { type: 'doc', content: [] } },
        _headerPartUris: { rId8: 'word/header2.xml' },
        _footerPartUris: { rId9: 'word/footer3.xml' },
      },
      {} as never,
    );

    expect(stories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storyRef: {
            storyKind: 'header',
            storyKey: 'header:rId8',
          },
          partUri: 'word/header2.xml',
        }),
        expect.objectContaining({
          storyRef: {
            storyKind: 'footer',
            storyKey: 'footer:rId9',
          },
          partUri: 'word/footer3.xml',
        }),
      ]),
    );
  });
});
