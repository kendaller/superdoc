import { describe, it, expect } from 'vitest';
import { PathState } from '../../src/raw-surface/path-state.js';

describe('PathState', () => {
  it('builds correct path signature for nested elements', () => {
    const state = new PathState('word/document.xml');

    state.pushElement({
      localName: 'document',
      prefix: 'w',
      namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    });
    state.pushElement({
      localName: 'body',
      prefix: 'w',
      namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    });
    state.pushElement({
      localName: 'p',
      prefix: 'w',
      namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    });

    expect(state.getPathSignature()).toBe('word/document.xml::/w:document/w:body/w:p');
  });

  it('builds correct xpath-like path with sibling indexes', () => {
    const state = new PathState('word/document.xml');

    state.pushElement({
      localName: 'document',
      prefix: 'w',
      namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    });
    state.pushElement({
      localName: 'body',
      prefix: 'w',
      namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    });
    state.pushElement({
      localName: 'p',
      prefix: 'w',
      namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    });

    expect(state.getXpathLikePath()).toBe('word/document.xml::/w:document[1]/w:body[1]/w:p[1]');
  });

  it('increments sibling indexes for same-name siblings', () => {
    const state = new PathState('word/document.xml');
    const wUri = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    state.pushElement({ localName: 'document', prefix: 'w', namespaceUri: wUri });
    state.pushElement({ localName: 'body', prefix: 'w', namespaceUri: wUri });

    // First <w:p>
    state.pushElement({ localName: 'p', prefix: 'w', namespaceUri: wUri });
    expect(state.getXpathLikePath()).toBe('word/document.xml::/w:document[1]/w:body[1]/w:p[1]');
    state.popElement();

    // Second <w:p>
    state.pushElement({ localName: 'p', prefix: 'w', namespaceUri: wUri });
    expect(state.getXpathLikePath()).toBe('word/document.xml::/w:document[1]/w:body[1]/w:p[2]');
    state.popElement();
  });

  it('produces unindexed path signature regardless of sibling count', () => {
    const state = new PathState('word/document.xml');
    const wUri = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    state.pushElement({ localName: 'document', prefix: 'w', namespaceUri: wUri });
    state.pushElement({ localName: 'body', prefix: 'w', namespaceUri: wUri });

    state.pushElement({ localName: 'p', prefix: 'w', namespaceUri: wUri });
    const sig1 = state.getPathSignature();
    state.popElement();

    state.pushElement({ localName: 'p', prefix: 'w', namespaceUri: wUri });
    const sig2 = state.getPathSignature();
    state.popElement();

    expect(sig1).toBe(sig2);
    expect(sig1).toBe('word/document.xml::/w:document/w:body/w:p');
  });

  it('builds attribute path with @ suffix', () => {
    const state = new PathState('word/document.xml');
    const wUri = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    state.pushElement({ localName: 'pgSz', prefix: 'w', namespaceUri: wUri });

    expect(state.getAttributePathSignature('w:w')).toBe('word/document.xml::/w:pgSz@w:w');
    expect(state.getAttributeXpathLikePath('w:w')).toBe('word/document.xml::/w:pgSz[1]/@w:w');
  });

  it('returns parent path signature', () => {
    const state = new PathState('word/document.xml');
    const wUri = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    state.pushElement({ localName: 'document', prefix: 'w', namespaceUri: wUri });
    state.pushElement({ localName: 'body', prefix: 'w', namespaceUri: wUri });
    state.pushElement({ localName: 'p', prefix: 'w', namespaceUri: wUri });

    expect(state.getParentPathSignature()).toBe('word/document.xml::/w:document/w:body');
  });

  it('returns undefined parent for root element', () => {
    const state = new PathState('word/document.xml');
    state.pushElement({
      localName: 'document',
      prefix: 'w',
      namespaceUri: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    });

    expect(state.getParentPathSignature()).toBeUndefined();
  });

  describe('markup compatibility context', () => {
    const mcUri = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const wUri = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    it('tracks mc:AlternateContent depth', () => {
      const state = new PathState('word/document.xml');

      state.pushElement({ localName: 'p', prefix: 'w', namespaceUri: wUri });
      expect(state.getMcContext()).toEqual({ branch: null, alternateContentDepth: 0 });

      state.pushElement({ localName: 'AlternateContent', prefix: 'mc', namespaceUri: mcUri });
      expect(state.getMcContext()).toEqual({ branch: null, alternateContentDepth: 1 });

      state.pushElement({ localName: 'Choice', prefix: 'mc', namespaceUri: mcUri });
      expect(state.getMcContext()).toEqual({ branch: 'choice', alternateContentDepth: 1 });
    });

    it('tracks fallback branch', () => {
      const state = new PathState('word/document.xml');

      state.pushElement({ localName: 'AlternateContent', prefix: 'mc', namespaceUri: mcUri });
      state.pushElement({ localName: 'Fallback', prefix: 'mc', namespaceUri: mcUri });

      expect(state.getMcContext()).toEqual({ branch: 'fallback', alternateContentDepth: 1 });
    });
  });
});
