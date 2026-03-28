type PositiveInteger = number;

export type StreamingBatchPolicy = {
  bodyChildLimit: PositiveInteger;
  maxBodyChildLimit: PositiveInteger;
  pageEstimate: PositiveInteger;
};

export type StreamingBatchOutcome = {
  durationMs: number;
  bodyChildrenConsumed: PositiveInteger;
  pagesAdded: PositiveInteger;
  /** Fraction of projected paragraphs classified as field-heavy (0.0–1.0). */
  fieldHeavyRatio?: number;
};

const DEFAULT_APPEND_PAGE_ESTIMATE = 2;
const INITIAL_BODY_CHILD_DIVISOR = 4;
const MIN_INITIAL_BODY_CHILD_LIMIT = 4;
const MAX_INITIAL_BODY_CHILD_LIMIT = 16;
const AGGRESSIVE_SLOW_APPEND_MS = 600;
const SLOW_APPEND_MS = 250;
const FAST_APPEND_MS = 80;
const STABLE_APPEND_MS = 140;
const AGGRESSIVE_SHRINK_FACTOR = 0.5;
const MODERATE_SHRINK_FACTOR = 0.75;
const FAST_GROWTH_FACTOR = 1.5;
const MODERATE_GROWTH_FACTOR = 1.25;

/**
 * The streaming host uses two separate knobs:
 * - a page estimate, which caps how much page content each append can add
 * - a body-child limit, which prevents a single append from traversing an
 *   unbounded number of document nodes while it looks for those pages
 *
 * The page estimate stays fixed. The body-child limit adapts after each batch.
 */
export function createInitialStreamingBatchPolicy(
  maxBodyChildLimit: number,
  pageEstimate = DEFAULT_APPEND_PAGE_ESTIMATE,
): StreamingBatchPolicy {
  const normalizedMax = normalizePositiveInteger(maxBodyChildLimit, 1);
  const initialBodyChildLimit = clampInteger(
    Math.ceil(normalizedMax / INITIAL_BODY_CHILD_DIVISOR),
    Math.min(normalizedMax, MIN_INITIAL_BODY_CHILD_LIMIT),
    Math.min(normalizedMax, MAX_INITIAL_BODY_CHILD_LIMIT),
  );

  return {
    bodyChildLimit: initialBodyChildLimit,
    maxBodyChildLimit: normalizedMax,
    pageEstimate: normalizePositiveInteger(pageEstimate, DEFAULT_APPEND_PAGE_ESTIMATE),
  };
}

export function advanceStreamingBatchPolicy(
  policy: StreamingBatchPolicy,
  outcome: StreamingBatchOutcome,
): StreamingBatchPolicy {
  if (outcome.bodyChildrenConsumed <= 0) {
    return policy;
  }

  const nextBodyChildLimit = resolveNextBodyChildLimit(policy, outcome);
  if (nextBodyChildLimit === policy.bodyChildLimit) {
    return policy;
  }

  return {
    ...policy,
    bodyChildLimit: nextBodyChildLimit,
  };
}

function resolveNextBodyChildLimit(policy: StreamingBatchPolicy, outcome: StreamingBatchOutcome): number {
  // Field-heavy batches that are slow get a more aggressive shrink since
  // each body child is more expensive than a plain paragraph.
  const isFieldHeavy = (outcome.fieldHeavyRatio ?? 0) > 0.5;

  if (outcome.durationMs >= AGGRESSIVE_SLOW_APPEND_MS) {
    return shrinkBodyChildLimit(policy, AGGRESSIVE_SHRINK_FACTOR);
  }

  if (outcome.durationMs >= SLOW_APPEND_MS) {
    return shrinkBodyChildLimit(policy, isFieldHeavy ? AGGRESSIVE_SHRINK_FACTOR : MODERATE_SHRINK_FACTOR);
  }

  const hitBodyChildLimit = outcome.bodyChildrenConsumed >= policy.bodyChildLimit;
  const underfilledPageTarget = outcome.pagesAdded > 0 && outcome.pagesAdded < policy.pageEstimate;

  if (outcome.durationMs <= FAST_APPEND_MS && (hitBodyChildLimit || underfilledPageTarget)) {
    return growBodyChildLimit(policy, FAST_GROWTH_FACTOR);
  }

  if (outcome.durationMs <= STABLE_APPEND_MS && underfilledPageTarget) {
    return growBodyChildLimit(policy, MODERATE_GROWTH_FACTOR);
  }

  return policy.bodyChildLimit;
}

function shrinkBodyChildLimit(policy: StreamingBatchPolicy, factor: number): number {
  return clampInteger(Math.floor(policy.bodyChildLimit * factor), 1, policy.maxBodyChildLimit);
}

function growBodyChildLimit(policy: StreamingBatchPolicy, factor: number): number {
  return clampInteger(Math.ceil(policy.bodyChildLimit * factor), 1, policy.maxBodyChildLimit);
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function clampInteger(value: number, min: number, max: number): number {
  if (min > max) {
    return max;
  }

  return Math.min(max, Math.max(min, value));
}
