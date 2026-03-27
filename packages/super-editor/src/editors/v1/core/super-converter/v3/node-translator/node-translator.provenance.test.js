import { describe, expect, it, vi } from 'vitest';
import { NodeTranslator } from './node-translator.js';

describe('NodeTranslator provenance bindings', () => {
  it('binds structural node translations to exact universe features', () => {
    const bindNode = vi.fn();
    const translator = NodeTranslator.from({
      xmlName: 'w:p',
      sdNodeOrKeyName: 'paragraph',
      type: NodeTranslator.translatorTypes.NODE,
      encode: () => ({ type: 'paragraph', content: [] }),
    });

    const xmlNode = { name: 'w:p' };
    translator.encode({
      nodes: [xmlNode],
      extraParams: {
        provenanceHooks: {
          bindNode,
          bindFeature: vi.fn(),
        },
      },
    });

    expect(bindNode).toHaveBeenCalledTimes(1);
    expect(bindNode).toHaveBeenCalledWith(
      xmlNode,
      expect.objectContaining({ type: 'paragraph' }),
      expect.objectContaining({
        featureKey: 'paragraph',
        nodeType: 'paragraph',
        traceability: 'occurrence',
      }),
    );
  });

  it('binds mapped property translations as feature anchors', () => {
    const bindFeature = vi.fn();
    const translator = NodeTranslator.from({
      xmlName: 'w:b',
      sdNodeOrKeyName: 'bold',
      type: NodeTranslator.translatorTypes.ATTRIBUTE,
      encode: () => true,
    });

    const xmlNode = { name: 'w:b', attributes: {} };
    translator.encode({
      nodes: [xmlNode],
      extraParams: {
        provenanceHooks: {
          bindNode: vi.fn(),
          bindFeature,
        },
      },
    });

    expect(bindFeature).toHaveBeenCalledTimes(1);
    expect(bindFeature).toHaveBeenCalledWith(
      xmlNode,
      'format.bold.direct',
      expect.objectContaining({
        featureKey: 'format.bold.direct',
        traceability: 'feature',
      }),
    );
  });

  it('does not bind node translations when the emitted runtime type does not match the feature contract', () => {
    const bindNode = vi.fn();
    const translator = NodeTranslator.from({
      xmlName: 'w:p',
      sdNodeOrKeyName: 'paragraph',
      type: NodeTranslator.translatorTypes.NODE,
      encode: () => ({ type: 'tableOfContents', content: [] }),
    });

    translator.encode({
      nodes: [{ name: 'w:p' }],
      extraParams: {
        provenanceHooks: {
          bindNode,
          bindFeature: vi.fn(),
        },
      },
    });

    expect(bindNode).not.toHaveBeenCalled();
  });

  it('derives drawing feature keys from the source xml shape', () => {
    const bindNode = vi.fn();
    const translator = NodeTranslator.from({
      xmlName: 'w:drawing',
      sdNodeOrKeyName: 'drawing',
      type: NodeTranslator.translatorTypes.NODE,
      encode: () => ({ type: 'image', attrs: { isAnchor: false } }),
    });

    const xmlNode = { name: 'w:drawing', elements: [{ name: 'wp:anchor' }] };
    translator.encode({
      nodes: [xmlNode],
      extraParams: {
        provenanceHooks: {
          bindNode,
          bindFeature: vi.fn(),
        },
      },
    });

    expect(bindNode).toHaveBeenCalledWith(
      xmlNode.elements[0],
      expect.objectContaining({ type: 'image' }),
      expect.objectContaining({
        featureKey: 'drawing.anchored',
        traceability: 'occurrence',
      }),
    );
  });
});
