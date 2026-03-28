// ---------------------------------------------------------------------------
// Fallback policy — determines when to fall back from v2-streaming to the
// legacy PM rendering path.
//
// All functions are pure. The caller (V2StreamingRenderer.vue) decides what
// to do with the decision — typically emitting a 'fallback-requested' event.
// The streaming host itself NEVER silently switches paths.
// ---------------------------------------------------------------------------

import type { HostState, DegradedInfo } from './streaming-host-types.js';

// ---- Types ------------------------------------------------------------------

export type FallbackPolicy = {
  /** Fall back after N consecutive worker errors. Default: 3. */
  maxWorkerErrors: number;
  /** Fall back if first paint exceeds this budget (ms). null = no auto-fallback. */
  firstPaintBudgetMs: number | null;
  /** Fall back if the document has > N body children. null = no limit. */
  maxBodyChildren: number | null;
  /** Force v1 path unconditionally. */
  forceV1: boolean;
};

export type FallbackDecision = {
  shouldFallback: boolean;
  reason: string;
  metadata: Record<string, unknown>;
};

export type FallbackTelemetry = {
  workerErrorCount: number;
  firstPaintMs: number | null;
  bodyChildCount: number;
};

// ---- Defaults ---------------------------------------------------------------

export const DEFAULT_FALLBACK_POLICY: Readonly<FallbackPolicy> = {
  maxWorkerErrors: 3,
  firstPaintBudgetMs: null,
  maxBodyChildren: null,
  forceV1: false,
};

// ---- Evaluation -------------------------------------------------------------

/**
 * Evaluate whether the v2-streaming path should fall back to the legacy
 * PM rendering path.
 *
 * Returns a FallbackDecision. The caller is responsible for acting on it
 * (e.g., emitting a 'fallback-requested' event).
 */
export function evaluateFallback(
  policy: FallbackPolicy,
  hostState: HostState,
  degradedInfo: DegradedInfo | null,
  telemetry: FallbackTelemetry,
): FallbackDecision {
  // Force v1 — always fall back
  if (policy.forceV1) {
    return {
      shouldFallback: true,
      reason: 'forceV1',
      metadata: {},
    };
  }

  // Non-recoverable degraded state
  if (hostState === 'degraded' && degradedInfo && !degradedInfo.recoverable) {
    return {
      shouldFallback: true,
      reason: 'non-recoverable-degraded',
      metadata: { degradedReason: degradedInfo.reason, message: degradedInfo.message },
    };
  }

  // Failed state
  if (hostState === 'failed') {
    return {
      shouldFallback: true,
      reason: 'failed',
      metadata: {},
    };
  }

  // Too many worker errors
  if (telemetry.workerErrorCount >= policy.maxWorkerErrors) {
    return {
      shouldFallback: true,
      reason: 'max-worker-errors',
      metadata: { workerErrorCount: telemetry.workerErrorCount, limit: policy.maxWorkerErrors },
    };
  }

  // First paint budget exceeded
  if (policy.firstPaintBudgetMs != null && telemetry.firstPaintMs != null) {
    if (telemetry.firstPaintMs > policy.firstPaintBudgetMs) {
      return {
        shouldFallback: true,
        reason: 'first-paint-budget-exceeded',
        metadata: { firstPaintMs: telemetry.firstPaintMs, budget: policy.firstPaintBudgetMs },
      };
    }
  }

  // Body child count exceeded
  if (policy.maxBodyChildren != null && telemetry.bodyChildCount > policy.maxBodyChildren) {
    return {
      shouldFallback: true,
      reason: 'max-body-children-exceeded',
      metadata: { bodyChildCount: telemetry.bodyChildCount, limit: policy.maxBodyChildren },
    };
  }

  return {
    shouldFallback: false,
    reason: '',
    metadata: {},
  };
}
