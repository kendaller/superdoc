import { describe, it, expect } from 'vitest';
import { scanXmlPart } from '../../src/raw-surface/xml-event-scan.js';

describe('xml-event-scan', () => {
  it('indexes processing instructions per parent instead of resetting on child elements', () => {
    const xml = new TextEncoder().encode(`<?xml version="1.0"?><root><?a?><child/><?a?></root>`);

    const result = scanXmlPart(xml, 'word/document.xml', 'main-document', 'doc', 'fingerprint');
    const piFacts = result.facts.filter((fact) => fact.factKind === 'processing-instruction');

    expect(piFacts).toHaveLength(2);
    expect(piFacts[0].xpathLikePath).toBe('word/document.xml::/root[1]/processing-instruction(a)[1]');
    expect(piFacts[1].xpathLikePath).toBe('word/document.xml::/root[1]/processing-instruction(a)[2]');
    expect(piFacts[0].rawFactId).not.toBe(piFacts[1].rawFactId);
  });

  it('indexes comments per parent instead of colliding across intervening elements', () => {
    const xml = new TextEncoder().encode(`<?xml version="1.0"?><root><!--one--><child/><!--two--></root>`);

    const result = scanXmlPart(xml, 'word/document.xml', 'main-document', 'doc', 'fingerprint');
    const commentFacts = result.facts.filter((fact) => fact.factKind === 'comment');

    expect(commentFacts).toHaveLength(2);
    expect(commentFacts[0].xpathLikePath).toBe('word/document.xml::/root[1]/comment()[1]');
    expect(commentFacts[1].xpathLikePath).toBe('word/document.xml::/root[1]/comment()[2]');
    expect(commentFacts[0].rawFactId).not.toBe(commentFacts[1].rawFactId);
  });
});
