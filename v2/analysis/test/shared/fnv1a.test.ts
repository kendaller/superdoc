import { describe, it, expect } from 'vitest';
import { fnv1a64 } from '../../src/shared/fnv1a.js';

describe('fnv1a64', () => {
  it('returns a 16-character hex string', () => {
    const hash = fnv1a64('hello');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic — same input produces same output', () => {
    const a = fnv1a64('test-input');
    const b = fnv1a64('test-input');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = fnv1a64('input-a');
    const b = fnv1a64('input-b');
    expect(a).not.toBe(b);
  });

  it('handles empty string', () => {
    const hash = fnv1a64('');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is sensitive to null-byte separators', () => {
    const combined = fnv1a64('abc\0def');
    const noCombined = fnv1a64('abcdef');
    expect(combined).not.toBe(noCombined);
  });
});
