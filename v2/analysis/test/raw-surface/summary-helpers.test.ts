import { describe, it, expect } from 'vitest';
import { increment, mergeRecordCounts, buildTopSignatures, sortRecord } from '../../src/raw-surface/summary-helpers.js';

describe('increment', () => {
  it('initializes a missing key to 1', () => {
    const counts: Record<string, number> = {};
    increment(counts, 'a');
    expect(counts.a).toBe(1);
  });

  it('increments an existing key', () => {
    const counts: Record<string, number> = { a: 3 };
    increment(counts, 'a');
    expect(counts.a).toBe(4);
  });
});

describe('mergeRecordCounts', () => {
  it('merges source into target', () => {
    const target: Record<string, number> = { a: 1 };
    mergeRecordCounts(target, { a: 2, b: 3 });
    expect(target).toEqual({ a: 3, b: 3 });
  });

  it('handles empty source', () => {
    const target: Record<string, number> = { a: 1 };
    mergeRecordCounts(target, {});
    expect(target).toEqual({ a: 1 });
  });
});

describe('buildTopSignatures', () => {
  it('sorts by count descending', () => {
    const result = buildTopSignatures({ a: 1, b: 3, c: 2 }, 10);
    expect(result.map((s) => s.pathSignature)).toEqual(['b', 'c', 'a']);
  });

  it('limits to N entries', () => {
    const result = buildTopSignatures({ a: 1, b: 2, c: 3 }, 2);
    expect(result).toHaveLength(2);
  });

  it('breaks ties alphabetically', () => {
    const result = buildTopSignatures({ z: 5, a: 5 }, 10);
    expect(result[0].pathSignature).toBe('a');
    expect(result[1].pathSignature).toBe('z');
  });
});

describe('sortRecord', () => {
  it('sorts keys alphabetically', () => {
    const result = sortRecord({ z: 1, a: 2, m: 3 });
    expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
  });

  it('preserves values', () => {
    const result = sortRecord({ b: 42, a: 7 });
    expect(result.a).toBe(7);
    expect(result.b).toBe(42);
  });
});
