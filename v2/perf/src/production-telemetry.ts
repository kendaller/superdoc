// ---------------------------------------------------------------------------
// Production telemetry adapter — bridges PerfTimeline to an external sink.
//
// This adapter is opt-in: instantiate it only when SD_V2_STREAMING_TELEMETRY
// is enabled. PerfTimeline remains zero-overhead when no adapter is attached.
// ---------------------------------------------------------------------------

import type { PerfTimeline, TimelineSnapshot } from './timeline.js';

// ---- Sink interface ---------------------------------------------------------

/**
 * Generic telemetry sink. Consumers implement this to forward events to
 * their analytics service (e.g., Segment, DataDog, custom backend).
 */
export type TelemetrySink = {
  sendEvent(name: string, data: Record<string, unknown>): void;
};

// ---- Adapter ----------------------------------------------------------------

export class ProductionTelemetryAdapter {
  #timeline: PerfTimeline;
  #sink: TelemetrySink;

  constructor(timeline: PerfTimeline, sink: TelemetrySink) {
    this.#timeline = timeline;
    this.#sink = sink;
  }

  /**
   * Flush the current timeline as a telemetry event.
   *
   * Call this at key lifecycle points (e.g., after first paint, after
   * streaming completes, on destroy) to send the accumulated timeline
   * to the external sink.
   */
  flush(label: string): void {
    const snapshot = this.#timeline.collect();
    this.#sink.sendEvent(`v2-streaming.${label}`, snapshotToPayload(snapshot));
  }

  /**
   * Report an enterprise hardening event immediately.
   * Use this for critical events that shouldn't wait for a flush.
   */
  reportEvent(name: string, data: Record<string, unknown>): void {
    this.#sink.sendEvent(`v2-streaming.enterprise.${name}`, data);
  }
}

// ---- Helpers ----------------------------------------------------------------

function snapshotToPayload(snapshot: TimelineSnapshot): Record<string, unknown> {
  const marks: Record<string, number> = {};
  for (const mark of snapshot.marks) {
    marks[mark.name] = mark.offsetMs;
  }

  const spans: Record<string, number> = {};
  for (const span of snapshot.spans) {
    spans[span.name] = span.durationMs;
  }

  return {
    marks,
    spans,
    counts: { ...snapshot.counts },
    timings: { ...snapshot.timings },
  };
}
