import { describe, it, expect } from 'vitest';
import { PathState } from '../../src/raw-surface/path-state.js';
import {
  emitElementFact,
  emitAttributeFacts,
  emitProcessingInstructionFact,
  emitCommentFact,
  type FactEmitterContext,
} from '../../src/raw-surface/fact-emitter.js';

const W_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function createCtx(partUri = 'word/document.xml'): FactEmitterContext {
  return {
    docId: 'test.docx',
    docFingerprint: 'abc123',
    partUri,
    partKind: 'main-document',
    pathState: new PathState(partUri),
  };
}

describe('emitElementFact', () => {
  it('produces a fact with correct structure', () => {
    const ctx = createCtx();
    ctx.pathState.pushElement({ prefix: 'w', localName: 'document', namespaceUri: W_URI });

    const fact = emitElementFact(ctx, { prefix: 'w', localName: 'document', namespaceUri: W_URI }, 1, 0);

    expect(fact.factKind).toBe('element');
    expect(fact.docId).toBe('test.docx');
    expect(fact.partUri).toBe('word/document.xml');
    expect(fact.pathSignature).toBe('word/document.xml::/w:document');
    expect(fact.xpathLikePath).toBe('word/document.xml::/w:document[1]');
    expect(fact.qname?.localName).toBe('document');
    expect(fact.rawFactId).toMatch(/^raw:/);
  });

  it('omits markupCompatibilityContext when outside mc:AlternateContent', () => {
    const ctx = createCtx();
    ctx.pathState.pushElement({ prefix: 'w', localName: 'p', namespaceUri: W_URI });

    const fact = emitElementFact(ctx, { prefix: 'w', localName: 'p', namespaceUri: W_URI });
    expect(fact.markupCompatibilityContext).toBeUndefined();
  });
});

describe('emitAttributeFacts', () => {
  it('emits one fact per attribute', () => {
    const ctx = createCtx();
    ctx.pathState.pushElement({ prefix: 'w', localName: 'pgSz', namespaceUri: W_URI });

    const attrs = {
      '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w': {
        prefix: 'w',
        local: 'w',
        uri: W_URI,
        value: '12240',
      },
      '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h': {
        prefix: 'w',
        local: 'h',
        uri: W_URI,
        value: '15840',
      },
    };

    const facts = emitAttributeFacts(ctx, attrs);
    expect(facts).toHaveLength(2);
    expect(facts.every((f) => f.factKind === 'attribute')).toBe(true);
  });

  it('sorts attributes deterministically', () => {
    const ctx = createCtx();
    ctx.pathState.pushElement({ prefix: 'w', localName: 'pgSz', namespaceUri: W_URI });

    const attrs = {
      'z-attr': { prefix: '', local: 'z-attr', uri: '', value: 'z' },
      'a-attr': { prefix: '', local: 'a-attr', uri: '', value: 'a' },
    };

    const facts = emitAttributeFacts(ctx, attrs);
    expect(facts[0].attributeName?.localName).toBe('a-attr');
    expect(facts[1].attributeName?.localName).toBe('z-attr');
  });

  it('normalizes attribute values', () => {
    const ctx = createCtx();
    ctx.pathState.pushElement({ prefix: 'w', localName: 'sz', namespaceUri: W_URI });

    const attrs = {
      val: { prefix: '', local: 'val', uri: '', value: '24' },
    };

    const facts = emitAttributeFacts(ctx, attrs);
    expect(facts[0].value?.kind).toBe('integer');
    expect(facts[0].value?.raw).toBe('24');
  });
});

describe('emitProcessingInstructionFact', () => {
  it('produces a PI fact with indexed path', () => {
    const ctx = createCtx();
    ctx.pathState.pushElement({ prefix: 'w', localName: 'document', namespaceUri: W_URI });

    const fact = emitProcessingInstructionFact(ctx, 'mso-application', 1);
    expect(fact.factKind).toBe('processing-instruction');
    expect(fact.pathSignature).toContain('processing-instruction(mso-application)');
    expect(fact.xpathLikePath).toContain('processing-instruction(mso-application)[1]');
  });
});

describe('emitCommentFact', () => {
  it('produces a comment fact with indexed path', () => {
    const ctx = createCtx();
    ctx.pathState.pushElement({ prefix: 'w', localName: 'document', namespaceUri: W_URI });

    const fact = emitCommentFact(ctx, 1);
    expect(fact.factKind).toBe('comment');
    expect(fact.pathSignature).toContain('comment()');
    expect(fact.xpathLikePath).toContain('comment()[1]');
  });
});
