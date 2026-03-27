// ---------------------------------------------------------------------------
// Document Fingerprint
// ---------------------------------------------------------------------------
// Content-based identity for .docx files using SHA-256. Separates identity
// (docId/path) from content: renaming without changes keeps the same
// fingerprint; content changes with the same filename get a new one.
// ---------------------------------------------------------------------------

/** Compute a SHA-256 hex fingerprint of raw document bytes. */
export async function computeFingerprint(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer to satisfy the Web Crypto API's type constraint
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
