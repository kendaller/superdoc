// ---------------------------------------------------------------------------
// PerfTimeline — lightweight, opt-in performance timeline for v2 rendering.
//
// Design principles:
// 1. Zero overhead when disabled (all methods short-circuit on a boolean check)
// 2. No external dependencies — uses only performance.now()
// 3. Structured output — marks, spans, and counts are typed and queryable
// 4. Cross-package — imported by v2/model, super-editor, layout-engine
// ---------------------------------------------------------------------------

/** A named instant in time, relative to timeline origin. */
export type MarkEntry = {
  readonly name: string;
  readonly offsetMs: number;
  readonly detail?: Readonly<Record<string, unknown>>;
};

/** A named duration between two instants. */
export type SpanEntry = {
  readonly name: string;
  readonly startOffsetMs: number;
  readonly endOffsetMs: number;
  readonly durationMs: number;
  readonly detail?: Readonly<Record<string, unknown>>;
};

/** Immutable snapshot of the entire timeline state. */
export type TimelineSnapshot = {
  readonly originMs: number;
  readonly marks: readonly MarkEntry[];
  readonly spans: readonly SpanEntry[];
  readonly counts: Readonly<Record<string, number>>;
  readonly timings: Readonly<Record<string, number>>;
};

/**
 * Performance timeline that collects marks, spans, and counters.
 *
 * Usage:
 *   const tl = new PerfTimeline();
 *   tl.enable();
 *   tl.mark('open.start');
 *   const end = tl.startSpan('open.fastOpen');
 *   // ... work ...
 *   end();
 *   tl.count('open.xmlPartsMaterialized', 12);
 *   const snapshot = tl.collect();
 */
export class PerfTimeline {
  #enabled = false;
  #originMs = 0;
  #marks: MarkEntry[] = [];
  #spans: SpanEntry[] = [];
  #counts: Record<string, number> = {};

  /** Whether the timeline is actively collecting. */
  get enabled(): boolean {
    return this.#enabled;
  }

  /** Turn collection on and reset the origin to now. */
  enable(): void {
    this.#enabled = true;
    this.#originMs = now();
  }

  /** Turn collection off. Existing data is preserved until reset(). */
  disable(): void {
    this.#enabled = false;
  }

  /** Record a named instant. No-op when disabled. */
  mark(name: string, detail?: Record<string, unknown>): void {
    if (!this.#enabled) return;
    this.#marks.push({ name, offsetMs: now() - this.#originMs, detail });
  }

  /**
   * Begin a named span. Returns a function that ends the span.
   * If disabled, returns a no-op function (zero allocation via shared ref).
   */
  startSpan(name: string, detail?: Record<string, unknown>): () => void {
    if (!this.#enabled) return NOOP;
    const startMs = now() - this.#originMs;
    return () => {
      const endMs = now() - this.#originMs;
      this.#spans.push({
        name,
        startOffsetMs: startMs,
        endOffsetMs: endMs,
        durationMs: endMs - startMs,
        detail,
      });
    };
  }

  /** Execute a synchronous function inside a span. */
  spanSync<T>(name: string, fn: () => T, detail?: Record<string, unknown>): T {
    const end = this.startSpan(name, detail);
    try {
      return fn();
    } finally {
      end();
    }
  }

  /** Execute an async function inside a span. */
  async spanAsync<T>(name: string, fn: () => Promise<T>, detail?: Record<string, unknown>): Promise<T> {
    const end = this.startSpan(name, detail);
    try {
      return await fn();
    } finally {
      end();
    }
  }

  /**
   * Record a completed span when the duration is already known.
   *
   * This keeps instrumentation readable in callers that can compute a phase
   * duration directly, such as wrappers around `incrementalLayout()` where the
   * measurement and pagination sub-phases are derived after the call returns.
   */
  recordSpan(name: string, durationMs: number, detail?: Record<string, unknown>): void {
    if (!this.#enabled) return;

    const safeDurationMs = Math.max(0, durationMs);
    const endOffsetMs = now() - this.#originMs;
    const startOffsetMs = Math.max(0, endOffsetMs - safeDurationMs);

    this.#spans.push({
      name,
      startOffsetMs,
      endOffsetMs,
      durationMs: safeDurationMs,
      detail,
    });
  }

  /** Increment a named counter. No-op when disabled. */
  count(name: string, increment = 1): void {
    if (!this.#enabled) return;
    this.#counts[name] = (this.#counts[name] ?? 0) + increment;
  }

  /** Set a counter to an exact value. No-op when disabled. */
  gauge(name: string, value: number): void {
    if (!this.#enabled) return;
    this.#counts[name] = value;
  }

  /** Produce an immutable snapshot of all collected data. */
  collect(): TimelineSnapshot {
    const timings: Record<string, number> = {};
    for (const span of this.#spans) {
      timings[span.name] = span.durationMs;
    }

    return {
      originMs: this.#originMs,
      marks: [...this.#marks],
      spans: [...this.#spans],
      counts: { ...this.#counts },
      timings,
    };
  }

  /** Get the duration of a named span, or undefined if not recorded. */
  getSpanDuration(name: string): number | undefined {
    for (let i = this.#spans.length - 1; i >= 0; i--) {
      if (this.#spans[i].name === name) return this.#spans[i].durationMs;
    }
    return undefined;
  }

  /** Get a counter value, or 0 if not recorded. */
  getCount(name: string): number {
    return this.#counts[name] ?? 0;
  }

  /** Clear all collected data and reset the origin. */
  reset(): void {
    this.#marks = [];
    this.#spans = [];
    this.#counts = {};
    this.#originMs = this.#enabled ? now() : 0;
  }
}

// Shared no-op to avoid allocations when disabled.
const NOOP = (): void => {};

/** High-resolution timer, safe for both browser and Node. */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Global singleton timeline for the v2 fast-first-paint pipeline.
 * Disabled by default — call `v2PerfTimeline.enable()` to start collection.
 */
export const v2PerfTimeline = new PerfTimeline();
