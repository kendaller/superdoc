import { describe, it, expect } from 'vitest';
import { classifyValueKind, normalizeValue } from '../../src/raw-surface/value-normalization.js';

describe('value normalization', () => {
  describe('classifyValueKind', () => {
    it("classifies empty string as 'empty'", () => {
      expect(classifyValueKind('')).toBe('empty');
    });

    it("classifies 'true' and 'false' as 'boolean'", () => {
      expect(classifyValueKind('true')).toBe('boolean');
      expect(classifyValueKind('false')).toBe('boolean');
    });

    it("classifies '0' and '1' as 'boolean'", () => {
      expect(classifyValueKind('0')).toBe('boolean');
      expect(classifyValueKind('1')).toBe('boolean');
    });

    it("classifies integer strings as 'integer'", () => {
      expect(classifyValueKind('42')).toBe('integer');
      expect(classifyValueKind('-100')).toBe('integer');
      expect(classifyValueKind('12240')).toBe('integer');
    });

    it("classifies decimal strings as 'decimal'", () => {
      expect(classifyValueKind('3.14')).toBe('decimal');
      expect(classifyValueKind('-0.5')).toBe('decimal');
    });

    it("classifies non-numeric strings as 'string'", () => {
      expect(classifyValueKind('Normal')).toBe('string');
      expect(classifyValueKind('rId1')).toBe('string');
      expect(classifyValueKind('FF0000')).toBe('string');
    });
  });

  describe('normalizeValue', () => {
    it('preserves the raw value', () => {
      const result = normalizeValue('12240');
      expect(result.raw).toBe('12240');
      expect(result.kind).toBe('integer');
      expect(result.truncated).toBe(false);
    });

    it('truncates normalized but preserves original raw value', () => {
      const longValue = 'x'.repeat(300);
      const result = normalizeValue(longValue);
      expect(result.truncated).toBe(true);
      expect(result.raw).toBe(longValue);
      expect(result.raw.length).toBe(300);
      expect(result.normalized.length).toBe(256);
    });

    it('does not truncate values at 256 characters', () => {
      const exact = 'x'.repeat(256);
      const result = normalizeValue(exact);
      expect(result.truncated).toBe(false);
      expect(result.raw.length).toBe(256);
    });
  });
});
