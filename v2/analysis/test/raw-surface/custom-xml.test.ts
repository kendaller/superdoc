import { describe, it, expect } from 'vitest';
import { scanRawSurface } from '../../src/raw-surface/index.js';
import { createDocxWithCustomXml } from '../helpers/create-test-docx.js';

describe('custom XML parts', () => {
  it('scans custom XML parts with unknown namespaces', async () => {
    const bytes = createDocxWithCustomXml();
    const result = await scanRawSurface(bytes, 'custom.docx');

    const customFacts = result.facts.filter((f) => f.partUri === 'customXml/item1.xml');
    expect(customFacts.length).toBeGreaterThan(0);
  });

  it("classifies custom XML parts as 'custom-xml'", async () => {
    const bytes = createDocxWithCustomXml();
    const result = await scanRawSurface(bytes, 'custom.docx');

    const customEntry = result.packageIndex.entries.find((e) => e.path === 'customXml/item1.xml');
    expect(customEntry?.partKind).toBe('custom-xml');
    expect(customEntry?.entryKind).toBe('xml');
  });

  it('preserves unknown namespace information on facts', async () => {
    const bytes = createDocxWithCustomXml();
    const result = await scanRawSurface(bytes, 'custom.docx');

    const rootFact = result.facts.find(
      (f) => f.partUri === 'customXml/item1.xml' && f.factKind === 'element' && f.qname?.localName === 'root',
    );
    expect(rootFact).toBeDefined();
    expect(rootFact!.qname?.namespaceUri).toBe('http://example.com/custom');
    // Falls back to literal prefix since this URI is not in the canonical table
    expect(rootFact!.qname?.prefix).toBe('ns0');
  });

  it('records attribute values from custom XML', async () => {
    const bytes = createDocxWithCustomXml();
    const result = await scanRawSurface(bytes, 'custom.docx');

    const valueAttr = result.facts.find(
      (f) =>
        f.partUri === 'customXml/item1.xml' && f.factKind === 'attribute' && f.attributeName?.localName === 'value',
    );
    expect(valueAttr).toBeDefined();
    expect(valueAttr!.value?.raw).toBe('123');
    expect(valueAttr!.value?.kind).toBe('integer');
  });
});
