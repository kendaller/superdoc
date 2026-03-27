import { describe, it, expect } from 'vitest';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createDocxWithAlternateContent } from '../helpers/create-test-docx.js';

describe('mc:AlternateContent handling', () => {
  it("tags facts inside mc:Choice with branch='choice'", async () => {
    const bytes = createDocxWithAlternateContent();
    const result = await scanRawSurface(bytes, 'mc.docx');

    const choiceFacts = result.facts.filter((f) => f.markupCompatibilityContext?.branch === 'choice');
    expect(choiceFacts.length).toBeGreaterThan(0);

    // w14:textFill should be in the choice branch
    const textFill = choiceFacts.find((f) => f.qname?.localName === 'textFill');
    expect(textFill).toBeDefined();
    expect(textFill!.markupCompatibilityContext!.alternateContentDepth).toBe(1);
  });

  it("tags facts inside mc:Fallback with branch='fallback'", async () => {
    const bytes = createDocxWithAlternateContent();
    const result = await scanRawSurface(bytes, 'mc.docx');

    const fallbackFacts = result.facts.filter((f) => f.markupCompatibilityContext?.branch === 'fallback');
    expect(fallbackFacts.length).toBeGreaterThan(0);
  });

  it('does not tag facts outside mc:AlternateContent', async () => {
    const bytes = createDocxWithAlternateContent();
    const result = await scanRawSurface(bytes, 'mc.docx');

    const documentFact = result.facts.find(
      (f) => f.partUri === 'word/document.xml' && f.factKind === 'element' && f.qname?.localName === 'document',
    );
    expect(documentFact).toBeDefined();
    expect(documentFact!.markupCompatibilityContext).toBeUndefined();
  });

  it('mc:AlternateContent itself is emitted as a fact', async () => {
    const bytes = createDocxWithAlternateContent();
    const result = await scanRawSurface(bytes, 'mc.docx');

    const acFact = result.facts.find((f) => f.factKind === 'element' && f.qname?.localName === 'AlternateContent');
    expect(acFact).toBeDefined();
    expect(acFact!.pathSignature).toContain('mc:AlternateContent');
  });
});
