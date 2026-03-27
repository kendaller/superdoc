// ---------------------------------------------------------------------------
// Runtime Observation ID Generation
// ---------------------------------------------------------------------------
// Deterministic ID for each runtime observation, derived from the canonical
// formula defined in the runtime bridge contract.
// ---------------------------------------------------------------------------

import { fnv1a64 } from '../shared/fnv1a.js';
import type { ObservationStage, TraceabilityLevel, UniverseLinkMode } from './types.js';

/**
 * Build a deterministic observationId from the observation's identity components.
 *
 * Formula:
 *   fnv1a64("runtime-observation/v1" + "\0" + runtime + "\0" + docId + "\0" +
 *           stage + "\0" + featureKey + "\0" + traceabilityLevel + "\0" +
 *           linkMode + "\0" + canonicalAnchor)
 */
export function buildObservationId(input: {
  runtime: string;
  docId: string;
  stage: ObservationStage;
  featureKey: string;
  traceabilityLevel: TraceabilityLevel;
  linkMode: UniverseLinkMode;
  canonicalAnchor: string;
}): string {
  const canonical = [
    `runtime-observation/${input.runtime}`,
    input.runtime,
    input.docId,
    input.stage,
    input.featureKey,
    input.traceabilityLevel,
    input.linkMode,
    input.canonicalAnchor,
  ].join('\0');

  return `obs:${fnv1a64(canonical)}`;
}
