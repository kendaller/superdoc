import { describe, it, expect } from 'vitest';
import { buildSourceIndex } from './source-index.js';

describe('buildSourceIndex', () => {
  it('indexes a simple XML tree', () => {
    const elements = [
      {
        name: 'w:document',
        elements: [
          {
            name: 'w:body',
            elements: [
              { name: 'w:p', elements: [] },
              { name: 'w:p', elements: [] },
              { name: 'w:tbl', elements: [] },
            ],
          },
        ],
      },
    ];

    const index = buildSourceIndex(elements, 'word/document.xml', 'main');

    // Root element
    const docAnchor = index.getAnchor(elements[0]);
    expect(docAnchor).toBeDefined();
    expect(docAnchor!.xpathLikePath).toBe('word/document.xml::/w:document[1]');
    expect(docAnchor!.pathSignature).toBe('word/document.xml::/w:document');

    // w:body
    const body = elements[0].elements![0];
    const bodyAnchor = index.getAnchor(body);
    expect(bodyAnchor).toBeDefined();
    expect(bodyAnchor!.xpathLikePath).toBe('word/document.xml::/w:document[1]/w:body[1]');

    // First w:p
    const p1 = body.elements![0];
    const p1Anchor = index.getAnchor(p1);
    expect(p1Anchor).toBeDefined();
    expect(p1Anchor!.xpathLikePath).toBe('word/document.xml::/w:document[1]/w:body[1]/w:p[1]');

    // Second w:p (sibling index should be 2)
    const p2 = body.elements![1];
    const p2Anchor = index.getAnchor(p2);
    expect(p2Anchor).toBeDefined();
    expect(p2Anchor!.xpathLikePath).toBe('word/document.xml::/w:document[1]/w:body[1]/w:p[2]');

    // w:tbl (different name, so sibling index is 1)
    const tbl = body.elements![2];
    const tblAnchor = index.getAnchor(tbl);
    expect(tblAnchor).toBeDefined();
    expect(tblAnchor!.xpathLikePath).toBe('word/document.xml::/w:document[1]/w:body[1]/w:tbl[1]');
  });

  it('produces deterministic anchor IDs', () => {
    const elements = [{ name: 'w:document', elements: [{ name: 'w:body', elements: [] }] }];

    const index1 = buildSourceIndex(elements, 'word/document.xml', 'main');
    const index2 = buildSourceIndex(elements, 'word/document.xml', 'main');

    const id1 = index1.getAnchorId(elements[0]);
    const id2 = index2.getAnchorId(elements[0]);
    expect(id1).toBe(id2);
  });

  it('skips text nodes (elements without name)', () => {
    const elements = [
      {
        name: 'w:p',
        elements: [
          { type: 'text', text: 'Hello' } as any, // text node — no name
          { name: 'w:r', elements: [] },
        ],
      },
    ];

    const index = buildSourceIndex(elements, 'word/document.xml', 'main');

    // w:r should still get sibling index 1 (text nodes don't count)
    const run = elements[0].elements![1];
    const anchor = index.getAnchor(run);
    expect(anchor).toBeDefined();
    expect(anchor!.xpathLikePath).toBe('word/document.xml::/w:p[1]/w:r[1]');
  });

  it('handles deeply nested structures', () => {
    const elements = [
      {
        name: 'w:document',
        elements: [
          {
            name: 'w:body',
            elements: [
              {
                name: 'w:tbl',
                elements: [
                  {
                    name: 'w:tr',
                    elements: [
                      {
                        name: 'w:tc',
                        elements: [{ name: 'w:p', elements: [] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const index = buildSourceIndex(elements, 'word/document.xml', 'main');

    const p = elements[0].elements![0].elements![0].elements![0].elements![0].elements![0];
    const anchor = index.getAnchor(p);
    expect(anchor).toBeDefined();
    expect(anchor!.xpathLikePath).toBe('word/document.xml::/w:document[1]/w:body[1]/w:tbl[1]/w:tr[1]/w:tc[1]/w:p[1]');
  });

  it('returns undefined for objects not in the index', () => {
    const elements = [{ name: 'w:document', elements: [] }];
    const index = buildSourceIndex(elements, 'word/document.xml', 'main');

    const foreignObject = { name: 'w:foreign' };
    expect(index.getAnchor(foreignObject)).toBeUndefined();
    expect(index.getAnchorId(foreignObject)).toBeUndefined();
  });

  it('sets correct storyKind on all anchors', () => {
    const elements = [{ name: 'w:hdr', elements: [{ name: 'w:p', elements: [] }] }];
    const index = buildSourceIndex(elements, 'word/header1.xml', 'header');

    const anchor = index.getAnchor(elements[0].elements![0]);
    expect(anchor!.storyKind).toBe('header');
    expect(anchor!.partUri).toBe('word/header1.xml');
  });
});
