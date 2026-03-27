import { describe, it, expect } from "vitest";
import * as M from "../src/metrics.js";

describe("metric vocabulary", () => {
  it("open metrics use consistent prefix", () => {
    expect(M.OPEN_START).toMatch(/^open\./);
    expect(M.OPEN_FAST_OPEN_COMPLETE).toMatch(/^open\./);
    expect(M.OPEN_RENDER_SHELL_READY).toMatch(/^open\./);
    expect(M.OPEN_STRUCTURE_READY).toMatch(/^open\./);
    expect(M.OPEN_BYTES_READ_BEFORE_FIRST_PAINT).toMatch(/^open\./);
    expect(M.OPEN_XML_PARTS_MATERIALIZED_BEFORE_FIRST_PAINT).toMatch(/^open\./);
  });

  it("projection metrics use consistent prefix", () => {
    expect(M.PROJECTION_FIRST_WINDOW_START).toMatch(/^projection\./);
    expect(M.PROJECTION_FIRST_WINDOW_COMPLETE).toMatch(/^projection\./);
    expect(M.PROJECTION_BLOCKS_PROJECTED_BEFORE_FIRST_PAINT).toMatch(/^projection\./);
    expect(M.PROJECTION_APPEND_WINDOW_COUNT).toMatch(/^projection\./);
  });

  it("layout metrics use consistent prefix", () => {
    expect(M.LAYOUT_FIRST_MEASURE_START).toMatch(/^layout\./);
    expect(M.LAYOUT_FIRST_MEASURE_COMPLETE).toMatch(/^layout\./);
    expect(M.LAYOUT_FIRST_PAGINATION_COMPLETE).toMatch(/^layout\./);
    expect(M.LAYOUT_BLOCKS_MEASURED_BEFORE_FIRST_PAINT).toMatch(/^layout\./);
    expect(M.LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT).toMatch(/^layout\./);
  });

  it("paint metrics use consistent prefix", () => {
    expect(M.PAINT_FIRST_PAGE_MOUNTED).toMatch(/^paint\./);
    expect(M.PAINT_FIRST_VISIBLE_PAGE_STABLE).toMatch(/^paint\./);
    expect(M.PAINT_FULL_VISIBLE_VIEWPORT_MOUNTED).toMatch(/^paint\./);
  });

  it("enrichment metrics use consistent prefix", () => {
    expect(M.ENRICHMENT_COMMENTS_READY).toMatch(/^enrichment\./);
    expect(M.ENRICHMENT_HEADER_FOOTER_READY).toMatch(/^enrichment\./);
    expect(M.ENRICHMENT_NOTES_READY).toMatch(/^enrichment\./);
    expect(M.ENRICHMENT_STRUCTURE_READY).toMatch(/^enrichment\./);
  });

  it("runtime metrics use consistent prefix", () => {
    expect(M.RUNTIME_MAIN_THREAD_LONG_TASKS_BEFORE_FIRST_PAINT).toMatch(/^runtime\./);
    expect(M.RUNTIME_MAIN_THREAD_BLOCKED_MS_BEFORE_FIRST_PAINT).toMatch(/^runtime\./);
    expect(M.RUNTIME_WORKER_BUSY_MS_BEFORE_FIRST_PAINT).toMatch(/^runtime\./);
    expect(M.RUNTIME_PEAK_MEMORY_MB).toMatch(/^runtime\./);
    expect(M.RUNTIME_MEMORY_AT_FIRST_PAINT_MB).toMatch(/^runtime\./);
  });

  it("all metric constants are unique strings", () => {
    const allMetrics = [
      M.OPEN_START, M.OPEN_FAST_OPEN_COMPLETE, M.OPEN_RENDER_SHELL_READY,
      M.OPEN_STRUCTURE_READY, M.OPEN_BYTES_READ_BEFORE_FIRST_PAINT,
      M.OPEN_XML_PARTS_MATERIALIZED_BEFORE_FIRST_PAINT,
      M.PROJECTION_FIRST_WINDOW_START, M.PROJECTION_FIRST_WINDOW_COMPLETE,
      M.PROJECTION_BLOCKS_PROJECTED_BEFORE_FIRST_PAINT, M.PROJECTION_APPEND_WINDOW_COUNT,
      M.LAYOUT_FIRST_MEASURE_START, M.LAYOUT_FIRST_MEASURE_COMPLETE,
      M.LAYOUT_FIRST_PAGINATION_COMPLETE, M.LAYOUT_BLOCKS_MEASURED_BEFORE_FIRST_PAINT,
      M.LAYOUT_PAGES_MOUNTED_AT_FIRST_PAINT,
      M.PAINT_FIRST_PAGE_MOUNTED, M.PAINT_FIRST_VISIBLE_PAGE_STABLE,
      M.PAINT_FULL_VISIBLE_VIEWPORT_MOUNTED,
      M.ENRICHMENT_COMMENTS_READY, M.ENRICHMENT_HEADER_FOOTER_READY,
      M.ENRICHMENT_NOTES_READY, M.ENRICHMENT_STRUCTURE_READY,
      M.RUNTIME_MAIN_THREAD_LONG_TASKS_BEFORE_FIRST_PAINT,
      M.RUNTIME_MAIN_THREAD_BLOCKED_MS_BEFORE_FIRST_PAINT,
      M.RUNTIME_WORKER_BUSY_MS_BEFORE_FIRST_PAINT,
      M.RUNTIME_PEAK_MEMORY_MB, M.RUNTIME_MEMORY_AT_FIRST_PAINT_MB,
    ];

    const unique = new Set(allMetrics);
    expect(unique.size).toBe(allMetrics.length);
  });

  it("all span constants are unique strings", () => {
    const allSpans = [
      M.SPAN_OPEN, M.SPAN_FAST_OPEN, M.SPAN_MATERIALIZE_XML,
      M.SPAN_ADVANCE_TO_STRUCTURE, M.SPAN_INDEX_XML_PARTS,
      M.SPAN_PROJECTION, M.SPAN_STYLE_RESOLUTION,
      M.SPAN_MEASUREMENT, M.SPAN_PAGINATION,
      M.SPAN_PAINT, M.SPAN_RENDER, M.SPAN_RUNTIME_INIT,
    ];

    const unique = new Set(allSpans);
    expect(unique.size).toBe(allSpans.length);
  });
});
