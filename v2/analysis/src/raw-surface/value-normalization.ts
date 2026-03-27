// ---------------------------------------------------------------------------
// Value Normalization
// ---------------------------------------------------------------------------
// Classifies attribute values into structural categories for aggregation.
// Intentionally conservative: only lexical/structural categories, no OOXML
// semantic interpretation. The raw value is always preserved alongside.
// ---------------------------------------------------------------------------

import type { NormalizedValue, ValueKind } from './types.js';

const MAX_RAW_VALUE_LENGTH = 256;

/** Classify an attribute value into a structural ValueKind. */
export function classifyValueKind(raw: string): ValueKind {
  if (raw === '') return 'empty';
  if (raw === 'true' || raw === 'false' || raw === '1' || raw === '0') return 'boolean';
  if (/^-?\d+$/.test(raw)) return 'integer';
  if (/^-?\d+\.\d+$/.test(raw)) return 'decimal';
  if (typeof raw === 'string' && raw.length > 0) return 'string';
  return 'unknown';
}

/** Create a NormalizedValue from a raw attribute string. */
export function normalizeValue(raw: string): NormalizedValue {
  const kind = classifyValueKind(raw);
  const truncated = raw.length > MAX_RAW_VALUE_LENGTH;
  const normalized = truncated ? raw.slice(0, MAX_RAW_VALUE_LENGTH) : raw;

  return { raw, normalized, kind, truncated };
}
