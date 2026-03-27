import { describe, it, expect, beforeEach } from "vitest";
import { PerfTimeline, v2PerfTimeline } from "../src/timeline.js";

describe("PerfTimeline", () => {
  let tl: PerfTimeline;

  beforeEach(() => {
    tl = new PerfTimeline();
  });

  // ---- Enable/disable lifecycle -------------------------------------------

  describe("enable/disable", () => {
    it("starts disabled", () => {
      expect(tl.enabled).toBe(false);
    });

    it("can be enabled", () => {
      tl.enable();
      expect(tl.enabled).toBe(true);
    });

    it("can be disabled", () => {
      tl.enable();
      tl.disable();
      expect(tl.enabled).toBe(false);
    });
  });

  // ---- Marks ---------------------------------------------------------------

  describe("mark()", () => {
    it("records marks when enabled", () => {
      tl.enable();
      tl.mark("test.start");
      tl.mark("test.end");

      const snapshot = tl.collect();
      expect(snapshot.marks).toHaveLength(2);
      expect(snapshot.marks[0].name).toBe("test.start");
      expect(snapshot.marks[1].name).toBe("test.end");
    });

    it("records mark detail", () => {
      tl.enable();
      tl.mark("test.detail", { key: "value" });

      const snapshot = tl.collect();
      expect(snapshot.marks[0].detail).toEqual({ key: "value" });
    });

    it("is a no-op when disabled", () => {
      tl.mark("test.ignored");
      const snapshot = tl.collect();
      expect(snapshot.marks).toHaveLength(0);
    });

    it("records monotonically increasing offsets", () => {
      tl.enable();
      tl.mark("first");
      tl.mark("second");

      const snapshot = tl.collect();
      expect(snapshot.marks[0].offsetMs).toBeLessThanOrEqual(snapshot.marks[1].offsetMs);
    });
  });

  // ---- Spans ---------------------------------------------------------------

  describe("startSpan()", () => {
    it("records spans with duration", () => {
      tl.enable();
      const end = tl.startSpan("test.span");
      // Simulate some work
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      end();

      const snapshot = tl.collect();
      expect(snapshot.spans).toHaveLength(1);
      expect(snapshot.spans[0].name).toBe("test.span");
      expect(snapshot.spans[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.spans[0].startOffsetMs).toBeLessThanOrEqual(snapshot.spans[0].endOffsetMs);
      // Suppress unused variable warning
      void sum;
    });

    it("returns a no-op when disabled (zero allocation)", () => {
      const end1 = tl.startSpan("a");
      const end2 = tl.startSpan("b");
      // Both should be the same no-op reference
      expect(end1).toBe(end2);

      end1();
      end2();
      const snapshot = tl.collect();
      expect(snapshot.spans).toHaveLength(0);
    });

    it("records span detail", () => {
      tl.enable();
      const end = tl.startSpan("test.detail", { phase: "open" });
      end();

      const snapshot = tl.collect();
      expect(snapshot.spans[0].detail).toEqual({ phase: "open" });
    });
  });

  describe("spanSync()", () => {
    it("wraps a synchronous function", () => {
      tl.enable();
      const result = tl.spanSync("sync.fn", () => 42);

      expect(result).toBe(42);
      const snapshot = tl.collect();
      expect(snapshot.spans).toHaveLength(1);
      expect(snapshot.spans[0].name).toBe("sync.fn");
    });

    it("records span even when function throws", () => {
      tl.enable();
      expect(() => {
        tl.spanSync("sync.throws", () => {
          throw new Error("test");
        });
      }).toThrow("test");

      const snapshot = tl.collect();
      expect(snapshot.spans).toHaveLength(1);
    });
  });

  describe("spanAsync()", () => {
    it("wraps an async function", async () => {
      tl.enable();
      const result = await tl.spanAsync("async.fn", async () => 99);

      expect(result).toBe(99);
      const snapshot = tl.collect();
      expect(snapshot.spans).toHaveLength(1);
      expect(snapshot.spans[0].name).toBe("async.fn");
    });

    it("records span even when async function rejects", async () => {
      tl.enable();
      await expect(
        tl.spanAsync("async.throws", async () => {
          throw new Error("async test");
        }),
      ).rejects.toThrow("async test");

      const snapshot = tl.collect();
      expect(snapshot.spans).toHaveLength(1);
    });
  });

  // ---- Counts / Gauges -----------------------------------------------------

  describe("count() and gauge()", () => {
    it("increments named counters", () => {
      tl.enable();
      tl.count("blocks");
      tl.count("blocks");
      tl.count("blocks", 3);

      expect(tl.getCount("blocks")).toBe(5);
    });

    it("returns 0 for unrecorded counters", () => {
      expect(tl.getCount("nonexistent")).toBe(0);
    });

    it("gauge sets an exact value", () => {
      tl.enable();
      tl.gauge("memory.mb", 42.5);
      expect(tl.getCount("memory.mb")).toBe(42.5);

      tl.gauge("memory.mb", 100);
      expect(tl.getCount("memory.mb")).toBe(100);
    });

    it("count is no-op when disabled", () => {
      tl.count("ignored");
      tl.gauge("also.ignored", 999);
      expect(tl.getCount("ignored")).toBe(0);
      expect(tl.getCount("also.ignored")).toBe(0);
    });
  });

  // ---- Collect / Snapshot ---------------------------------------------------

  describe("collect()", () => {
    it("produces immutable snapshots", () => {
      tl.enable();
      tl.mark("a");
      tl.count("x");

      const snapshot1 = tl.collect();
      tl.mark("b");
      const snapshot2 = tl.collect();

      // snapshot1 should not be affected by later marks
      expect(snapshot1.marks).toHaveLength(1);
      expect(snapshot2.marks).toHaveLength(2);
    });

    it("includes timings derived from spans", () => {
      tl.enable();
      const end = tl.startSpan("test");
      end();

      const snapshot = tl.collect();
      expect(snapshot.timings["test"]).toBeDefined();
      expect(snapshot.timings["test"]).toBe(snapshot.spans[0].durationMs);
    });

    it("includes counts in snapshot", () => {
      tl.enable();
      tl.gauge("pages", 10);
      tl.count("blocks", 50);

      const snapshot = tl.collect();
      expect(snapshot.counts["pages"]).toBe(10);
      expect(snapshot.counts["blocks"]).toBe(50);
    });
  });

  // ---- getSpanDuration() ---------------------------------------------------

  describe("getSpanDuration()", () => {
    it("returns the duration of a named span", () => {
      tl.enable();
      const end = tl.startSpan("measured");
      end();

      const duration = tl.getSpanDuration("measured");
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it("returns the most recent span if there are duplicates", () => {
      tl.enable();
      const end1 = tl.startSpan("repeated");
      end1();
      const end2 = tl.startSpan("repeated");
      end2();

      // Returns the last one (most recent)
      const duration = tl.getSpanDuration("repeated");
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it("returns undefined for unrecorded spans", () => {
      expect(tl.getSpanDuration("nonexistent")).toBeUndefined();
    });
  });

  // ---- Reset ---------------------------------------------------------------

  describe("reset()", () => {
    it("clears all data", () => {
      tl.enable();
      tl.mark("a");
      tl.count("x", 5);
      const end = tl.startSpan("s");
      end();

      tl.reset();

      const snapshot = tl.collect();
      expect(snapshot.marks).toHaveLength(0);
      expect(snapshot.spans).toHaveLength(0);
      expect(snapshot.counts).toEqual({});
    });

    it("preserves enabled state", () => {
      tl.enable();
      tl.reset();
      expect(tl.enabled).toBe(true);
    });
  });

  // ---- Global singleton ----------------------------------------------------

  describe("v2PerfTimeline (global singleton)", () => {
    it("is a PerfTimeline instance", () => {
      expect(v2PerfTimeline).toBeInstanceOf(PerfTimeline);
    });

    it("starts disabled", () => {
      expect(v2PerfTimeline.enabled).toBe(false);
    });
  });
});
