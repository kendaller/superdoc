import { describe, expect, it } from 'vitest';
import { buildSourceIndex } from './source-index.js';
import { createProvenanceCollector } from './provenance-collector.js';
import { createProvenanceHooks } from './provenance-hooks.js';

describe('createProvenanceHooks', () => {
  it('preserves featureKey metadata for node bindings', () => {
    const paragraphNode = {
      name: 'w:p',
      elements: [],
    };
    const collector = createProvenanceCollector();
    const sourceIndex = buildSourceIndex(
      [{ name: 'w:document', elements: [{ name: 'w:body', elements: [paragraphNode] }] }],
      'word/document.xml',
      'main',
    );
    const hooks = createProvenanceHooks(sourceIndex, collector);

    hooks.bindNode(
      paragraphNode,
      { type: 'paragraph', content: [] },
      {
        featureKey: 'paragraph',
        nodeType: 'paragraph',
        traceability: 'occurrence',
      },
    );

    const result = collector.finalize();
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].featureKey).toBe('paragraph');
    expect(result.bindings[0].bindingKind).toBe('pm-node');
  });
});
