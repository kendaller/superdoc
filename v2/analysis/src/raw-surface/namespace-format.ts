// ---------------------------------------------------------------------------
// Namespace Formatting
// ---------------------------------------------------------------------------
// Formats qualified names using the canonical prefix table. Ensures path
// signatures are stable regardless of the prefix bindings in any particular
// document.
// ---------------------------------------------------------------------------

import type { QualifiedName } from './types.js';
import { resolveCanonicalPrefix } from './canonical-namespaces.js';

/**
 * Format a QualifiedName into its canonical string form for path signatures.
 *
 * Examples:
 *   { prefix: "w", localName: "b", namespaceUri: "http://...wordprocessingml/2006/main" }
 *   → "w:b"
 *
 *   { prefix: "custom", localName: "tag", namespaceUri: undefined }
 *   → "custom:tag"
 *
 *   { localName: "root" }
 *   → "root"
 */
export function formatQName(qname: QualifiedName): string {
  const prefix = resolveCanonicalPrefix(qname.namespaceUri, qname.prefix);
  return prefix ? `${prefix}:${qname.localName}` : qname.localName;
}
