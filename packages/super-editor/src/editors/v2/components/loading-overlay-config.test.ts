import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DOCUMENT_LOADING_TEXTS,
  resolveDocumentLoadingConfig,
  resolveDocumentLoadingRendering,
} from './loading-overlay-config.js';

describe('loading overlay config', () => {
  it('returns built-in defaults when config is omitted', () => {
    const resolved = resolveDocumentLoadingConfig(undefined);
    const rendering = resolveDocumentLoadingRendering(resolved, {
      documentId: 'doc-1',
      texts: resolved.texts,
    });

    expect(resolved.enabled).toBe(true);
    expect(resolved.texts).toEqual(DEFAULT_DOCUMENT_LOADING_TEXTS);
    expect(rendering).toEqual({ builtin: true });
  });

  it('supports resolver-driven custom rendering', () => {
    const component = { name: 'CustomLoader' };
    const resolver = vi.fn().mockReturnValue({
      type: 'custom',
      component,
      props: { tone: 'brand' },
    });

    const resolved = resolveDocumentLoadingConfig({
      resolver,
      title: 'Working',
    });
    const rendering = resolveDocumentLoadingRendering(resolved, {
      documentId: 'doc-2',
      texts: resolved.texts,
    });

    expect(resolver).toHaveBeenCalledWith({
      documentId: 'doc-2',
      texts: expect.objectContaining({ title: 'Working' }),
    });
    expect(rendering).toEqual({
      component,
      props: { tone: 'brand' },
    });
  });

  it('throws when both component and render are provided', () => {
    expect(() =>
      resolveDocumentLoadingConfig({
        component: { name: 'One' },
        render: () => undefined,
      }),
    ).toThrow('documentLoading cannot provide both "component" and "render"');
  });
});
