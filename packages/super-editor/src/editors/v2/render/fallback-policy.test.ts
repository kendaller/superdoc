// ---------------------------------------------------------------------------
// Fallback policy tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { evaluateFallback, DEFAULT_FALLBACK_POLICY } from './fallback-policy.js';
import type { FallbackPolicy, FallbackTelemetry } from './fallback-policy.js';
import type { HostState, DegradedInfo } from './streaming-host-types.js';

const noTelemetry: FallbackTelemetry = { workerErrorCount: 0, firstPaintMs: null, bodyChildCount: 10 };

describe('evaluateFallback', () => {
  it('returns shouldFallback=false when all thresholds are under limits', () => {
    const decision = evaluateFallback(DEFAULT_FALLBACK_POLICY, 'streaming', null, noTelemetry);
    expect(decision.shouldFallback).toBe(false);
  });

  it('forceV1 always triggers fallback', () => {
    const policy: FallbackPolicy = { ...DEFAULT_FALLBACK_POLICY, forceV1: true };
    const decision = evaluateFallback(policy, 'streaming', null, noTelemetry);
    expect(decision.shouldFallback).toBe(true);
    expect(decision.reason).toBe('forceV1');
  });

  it('non-recoverable degraded state triggers fallback', () => {
    const degradedInfo: DegradedInfo = {
      reason: 'worker-error',
      message: 'Worker crashed',
      timestamp: 1000,
      recoverable: false,
    };
    const decision = evaluateFallback(DEFAULT_FALLBACK_POLICY, 'degraded', degradedInfo, noTelemetry);
    expect(decision.shouldFallback).toBe(true);
    expect(decision.reason).toBe('non-recoverable-degraded');
    expect(decision.metadata.degradedReason).toBe('worker-error');
  });

  it('recoverable degraded state does NOT trigger fallback', () => {
    const degradedInfo: DegradedInfo = {
      reason: 'append-stalled',
      message: 'network error',
      timestamp: 1000,
      recoverable: true,
    };
    const decision = evaluateFallback(DEFAULT_FALLBACK_POLICY, 'degraded', degradedInfo, noTelemetry);
    expect(decision.shouldFallback).toBe(false);
  });

  it('failed state triggers fallback', () => {
    const decision = evaluateFallback(DEFAULT_FALLBACK_POLICY, 'failed', null, noTelemetry);
    expect(decision.shouldFallback).toBe(true);
    expect(decision.reason).toBe('failed');
  });

  it('exceeding maxWorkerErrors triggers fallback', () => {
    const telemetry: FallbackTelemetry = { workerErrorCount: 3, firstPaintMs: null, bodyChildCount: 10 };
    const decision = evaluateFallback(DEFAULT_FALLBACK_POLICY, 'streaming', null, telemetry);
    expect(decision.shouldFallback).toBe(true);
    expect(decision.reason).toBe('max-worker-errors');
    expect(decision.metadata.workerErrorCount).toBe(3);
  });

  it('under maxWorkerErrors does NOT trigger fallback', () => {
    const telemetry: FallbackTelemetry = { workerErrorCount: 2, firstPaintMs: null, bodyChildCount: 10 };
    const decision = evaluateFallback(DEFAULT_FALLBACK_POLICY, 'streaming', null, telemetry);
    expect(decision.shouldFallback).toBe(false);
  });

  it('first paint budget exceeded triggers fallback', () => {
    const policy: FallbackPolicy = { ...DEFAULT_FALLBACK_POLICY, firstPaintBudgetMs: 3000 };
    const telemetry: FallbackTelemetry = { workerErrorCount: 0, firstPaintMs: 5000, bodyChildCount: 10 };
    const decision = evaluateFallback(policy, 'complete', null, telemetry);
    expect(decision.shouldFallback).toBe(true);
    expect(decision.reason).toBe('first-paint-budget-exceeded');
  });

  it('first paint within budget does NOT trigger fallback', () => {
    const policy: FallbackPolicy = { ...DEFAULT_FALLBACK_POLICY, firstPaintBudgetMs: 3000 };
    const telemetry: FallbackTelemetry = { workerErrorCount: 0, firstPaintMs: 2000, bodyChildCount: 10 };
    const decision = evaluateFallback(policy, 'complete', null, telemetry);
    expect(decision.shouldFallback).toBe(false);
  });

  it('body child count exceeded triggers fallback', () => {
    const policy: FallbackPolicy = { ...DEFAULT_FALLBACK_POLICY, maxBodyChildren: 1000 };
    const telemetry: FallbackTelemetry = { workerErrorCount: 0, firstPaintMs: null, bodyChildCount: 1500 };
    const decision = evaluateFallback(policy, 'streaming', null, telemetry);
    expect(decision.shouldFallback).toBe(true);
    expect(decision.reason).toBe('max-body-children-exceeded');
  });

  it('null budgets mean no auto-fallback for those dimensions', () => {
    const policy: FallbackPolicy = {
      ...DEFAULT_FALLBACK_POLICY,
      firstPaintBudgetMs: null,
      maxBodyChildren: null,
    };
    const telemetry: FallbackTelemetry = { workerErrorCount: 0, firstPaintMs: 999_999, bodyChildCount: 999_999 };
    const decision = evaluateFallback(policy, 'streaming', null, telemetry);
    expect(decision.shouldFallback).toBe(false);
  });
});
