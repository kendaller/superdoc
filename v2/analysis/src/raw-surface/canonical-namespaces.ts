// ---------------------------------------------------------------------------
// Canonical Namespace Prefix Table
// ---------------------------------------------------------------------------
// Maps well-known OOXML namespace URIs to their conventional prefixes.
// Used to ensure path signatures are stable regardless of the prefix
// bindings a particular document generator chose.
//
// For unknown URIs the scanner falls back to the document's literal prefix.
// ---------------------------------------------------------------------------

/** URI -> canonical prefix for well-known OOXML namespaces. */
export const CANONICAL_NAMESPACE_PREFIXES: ReadonlyMap<string, string> = new Map([
  // WordprocessingML
  ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w'],

  // Relationships
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r'],
  ['http://schemas.openxmlformats.org/package/2006/relationships', 'pr'],

  // DrawingML
  ['http://schemas.openxmlformats.org/drawingml/2006/main', 'a'],
  ['http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'wp'],
  ['http://schemas.openxmlformats.org/drawingml/2006/picture', 'pic'],
  ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'c'],
  ['http://schemas.openxmlformats.org/drawingml/2006/diagram', 'dgm'],

  // Markup Compatibility
  ['http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc'],

  // Math
  ['http://schemas.openxmlformats.org/officeDocument/2006/math', 'm'],

  // Document properties
  ['http://schemas.openxmlformats.org/officeDocument/2006/extended-properties', 'ap'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/custom-properties', 'cust'],
  ['http://schemas.openxmlformats.org/package/2006/metadata/core-properties', 'cp'],

  // Dublin Core (used inside docProps/core.xml)
  ['http://purl.org/dc/elements/1.1/', 'dc'],
  ['http://purl.org/dc/terms/', 'dcterms'],
  ['http://purl.org/dc/dcmitype/', 'dcmitype'],

  // VML
  ['urn:schemas-microsoft-com:vml', 'v'],
  ['urn:schemas-microsoft-com:office:office', 'o'],
  ['urn:schemas-microsoft-com:office:word', 'wvml'],

  // Content Types
  ['http://schemas.openxmlformats.org/package/2006/content-types', 'ct'],

  // Microsoft Office extensions (Word 2010–2016+)
  ['http://schemas.microsoft.com/office/word/2010/wordml', 'w14'],
  ['http://schemas.microsoft.com/office/word/2012/wordml', 'w15'],
  ['http://schemas.microsoft.com/office/word/2015/wordml/symex', 'w16se'],
  ['http://schemas.microsoft.com/office/word/2018/wordml/cex', 'w16cex'],
  ['http://schemas.microsoft.com/office/word/2018/wordml/cid', 'w16cid'],
  ['http://schemas.microsoft.com/office/word/2018/wordml', 'w16'],

  // Microsoft Office drawing extensions
  ['http://schemas.microsoft.com/office/drawing/2010/main', 'a14'],
  ['http://schemas.microsoft.com/office/drawing/2014/main', 'a16'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing', 'wp14'],

  // XML digital signatures (rare but seen)
  ['http://www.w3.org/2000/09/xmldsig#', 'ds'],
]);

/**
 * Resolve a namespace URI to its canonical prefix.
 * Returns the document's literal prefix if the URI is not in the table.
 */
export function resolveCanonicalPrefix(
  namespaceUri: string | undefined,
  literalPrefix: string | undefined,
): string | undefined {
  if (namespaceUri) {
    const canonical = CANONICAL_NAMESPACE_PREFIXES.get(namespaceUri);
    if (canonical) return canonical;
  }
  return literalPrefix;
}
