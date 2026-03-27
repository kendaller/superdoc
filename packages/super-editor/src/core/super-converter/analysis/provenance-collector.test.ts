import { describe, it, expect } from 'vitest';
import { createProvenanceCollector } from './provenance-collector.js';

describe('createProvenanceCollector', () => {
  it('creates anchors with deterministic IDs', () => {
    const collector = createProvenanceCollector();
    const id = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    });

    expect(id).toMatch(/^a:[0-9a-f]{16}$/);
  });

  it('returns the same ID for duplicate anchors (idempotent)', () => {
    const collector = createProvenanceCollector();
    const input = {
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main' as const,
    };

    const id1 = collector.createAnchor(input);
    const id2 = collector.createAnchor(input);
    expect(id1).toBe(id2);
  });

  it('creates different IDs for different anchors', () => {
    const collector = createProvenanceCollector();
    const id1 = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    });
    const id2 = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[2]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    });

    expect(id1).not.toBe(id2);
  });

  it('binds JSON nodes to source anchors', () => {
    const collector = createProvenanceCollector();
    const anchorId = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    });

    const jsonNode = { type: 'paragraph', content: [] };
    collector.bindJsonNode([anchorId], jsonNode, {
      nodeType: 'paragraph',
      traceability: 'occurrence',
    });

    const result = collector.finalize();
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].anchorIds).toContain(anchorId);
    expect(result.bindings[0].bindingKind).toBe('pm-node');
    expect(result.bindings[0].traceability).toBe('occurrence');
    expect(result.bindings[0].jsonNode).toBe(jsonNode); // same reference
  });

  it('binds marks as feature-level', () => {
    const collector = createProvenanceCollector();
    const anchorId = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]/w:r[1]/w:rPr[1]/w:b[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p/w:r/w:rPr/w:b',
      storyKind: 'main',
    });

    const jsonNode = { type: 'text', text: 'Hello' };
    collector.bindMark([anchorId], jsonNode, 'bold', {
      traceability: 'feature',
    });

    const result = collector.finalize();
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].bindingKind).toBe('mark-on-node');
    expect(result.bindings[0].markType).toBe('bold');
    expect(result.bindings[0].traceability).toBe('feature');
  });

  it('binds synthetic nodes', () => {
    const collector = createProvenanceCollector();
    const id1 = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]/w:r[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p/w:r',
      storyKind: 'main',
    });
    const id2 = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]/w:r[2]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p/w:r',
      storyKind: 'main',
    });

    const jsonNode = { type: 'hyperlink', attrs: {} };
    collector.bindSynthetic([id1, id2], jsonNode, {
      nodeType: 'hyperlink',
      traceability: 'feature',
    });

    const result = collector.finalize();
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].bindingKind).toBe('synthetic-node');
    expect(result.bindings[0].anchorIds).toEqual([id1, id2]);
    expect(result.bindings[0].status).toBe('synthetic');
  });

  it('binds feature anchors without requiring a runtime node reference', () => {
    const collector = createProvenanceCollector();
    const anchorId = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]/w:pPr[1]/w:pStyle[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p/w:pPr/w:pStyle',
      storyKind: 'main',
    });

    collector.bindFeature([anchorId], 'style-reference.paragraph', {
      featureKey: 'style-reference.paragraph',
      traceability: 'feature',
    });

    const result = collector.finalize();
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].bindingKind).toBe('feature-anchor');
    expect(result.bindings[0].featureKey).toBe('style-reference.paragraph');
    expect(result.bindings[0].traceability).toBe('feature');
  });

  it('records diagnostics', () => {
    const collector = createProvenanceCollector();
    const anchorId = collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    });

    collector.addDiagnostic([anchorId], 'Unsupported element type');

    const result = collector.finalize();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe('Unsupported element type');
    expect(result.diagnostics[0].anchorIds).toContain(anchorId);
  });

  it('respects story context for bindings', () => {
    const collector = createProvenanceCollector();
    collector.setStoryContext({ storyKind: 'header', storyKey: 'header:rId8' });

    const anchorId = collector.createAnchor({
      partUri: 'word/header1.xml',
      xpathLikePath: 'word/header1.xml::/w:hdr[1]/w:p[1]',
      pathSignature: 'word/header1.xml::/w:hdr/w:p',
      storyKind: 'header',
    });

    const jsonNode = { type: 'paragraph', content: [] };
    collector.bindJsonNode([anchorId], jsonNode, { nodeType: 'paragraph', traceability: 'occurrence' });

    const result = collector.finalize();
    expect(result.bindings[0].storyRef.storyKind).toBe('header');
    expect(result.bindings[0].storyRef.storyKey).toBe('header:rId8');
  });

  it('sorts anchors by anchorId on finalize', () => {
    const collector = createProvenanceCollector();
    // Create anchors in arbitrary order — they should be sorted on finalize
    collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[2]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    });
    collector.createAnchor({
      partUri: 'word/document.xml',
      xpathLikePath: 'word/document.xml::/w:document[1]/w:body[1]/w:p[1]',
      pathSignature: 'word/document.xml::/w:document/w:body/w:p',
      storyKind: 'main',
    });

    const result = collector.finalize();
    expect(result.sourceAnchors).toHaveLength(2);

    // Verify sorted by anchorId
    for (let i = 1; i < result.sourceAnchors.length; i++) {
      expect(result.sourceAnchors[i - 1].anchorId < result.sourceAnchors[i].anchorId).toBe(true);
    }
  });
});
