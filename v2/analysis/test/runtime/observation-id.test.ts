import { describe, it, expect } from 'vitest';
import { buildObservationId } from '../../src/runtime/observation-id.js';

describe('buildObservationId', () => {
  it('returns a deterministic ID with obs: prefix', () => {
    const id = buildObservationId({
      runtime: 'v1',
      docId: 'test-doc',
      stage: 'import',
      featureKey: 'paragraph',
      traceabilityLevel: 'feature',
      linkMode: 'feature-only',
      canonicalAnchor: 'doc-feature',
    });
    expect(id).toMatch(/^obs:[0-9a-f]{16}$/);
  });

  it('produces same ID for same input', () => {
    const input = {
      runtime: 'v1' as const,
      docId: 'test-doc',
      stage: 'import' as const,
      featureKey: 'paragraph',
      traceabilityLevel: 'occurrence' as const,
      linkMode: 'exact' as const,
      canonicalAnchor: 'occ:abc123',
    };
    expect(buildObservationId(input)).toBe(buildObservationId(input));
  });

  it('produces different IDs for different features', () => {
    const base = {
      runtime: 'v1' as const,
      docId: 'test-doc',
      stage: 'import' as const,
      traceabilityLevel: 'feature' as const,
      linkMode: 'feature-only' as const,
      canonicalAnchor: 'doc-feature',
    };
    const a = buildObservationId({ ...base, featureKey: 'paragraph' });
    const b = buildObservationId({ ...base, featureKey: 'run' });
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different documents', () => {
    const base = {
      runtime: 'v1' as const,
      stage: 'import' as const,
      featureKey: 'paragraph',
      traceabilityLevel: 'feature' as const,
      linkMode: 'feature-only' as const,
      canonicalAnchor: 'doc-feature',
    };
    const a = buildObservationId({ ...base, docId: 'doc-1' });
    const b = buildObservationId({ ...base, docId: 'doc-2' });
    expect(a).not.toBe(b);
  });
});
