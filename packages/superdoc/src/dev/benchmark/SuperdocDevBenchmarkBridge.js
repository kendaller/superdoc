import {
  v2PerfTimeline,
  OPEN_START,
  PAINT_FIRST_VISIBLE_PAGE_STABLE,
  PAINT_FULL_VISIBLE_VIEWPORT_MOUNTED,
  PROJECTION_APPEND_WINDOW_COUNT,
  RUNTIME_MAIN_THREAD_BLOCKED_MS_BEFORE_FIRST_PAINT,
  RUNTIME_MAIN_THREAD_LONG_TASKS_BEFORE_FIRST_PAINT,
  RUNTIME_MEMORY_AT_FIRST_PAINT_MB,
  RUNTIME_PEAK_MEMORY_MB,
  RUNTIME_WORKER_BUSY_MS_BEFORE_FIRST_PAINT,
} from '@superdoc/v2-perf';

const MEMORY_SAMPLE_INTERVAL_MS = 50;
const SURFACE_DISCOVERY_INTERVAL_MS = 50;
const SURFACE_DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * Create the dev-only benchmark bridge used by the Playwright TTFFP harness.
 *
 * The bridge intentionally lives inside the dev shell instead of the public
 * SuperDoc API so benchmark-only behavior stays isolated from the production
 * surface area.
 */
export function createSuperdocDevBenchmarkBridge() {
  return new SuperdocDevBenchmarkBridge();
}

class SuperdocDevBenchmarkBridge {
  #superdoc = null;
  #surface = null;
  #run = null;
  #superdocUnsubscribes = [];
  #surfaceUnsubscribe = null;
  #surfaceDiscoveryTimeoutId = null;

  attachSuperdoc(superdoc) {
    this.#cancelSurfaceDiscovery();
    this.#detachSuperdocListeners();
    this.#detachSurfaceListener();
    this.#superdoc = superdoc;

    if (!superdoc) {
      return;
    }

    this.#superdocUnsubscribes = [
      listen(superdoc, 'editorCreate', () => {
        this.#bindResolvedSurface();
      }),
      listen(superdoc, 'renderSurfaceReady', ({ surface }) => {
        this.#bindSurface(surface ?? null);
      }),
      listen(superdoc, 'ready', () => {
        this.#bindResolvedSurface();
      }),
      listen(superdoc, 'exception', (payload) => {
        this.#failRun(extractBenchmarkError(payload));
      }),
    ];

    this.#bindResolvedSurface();
    this.#scheduleSurfaceDiscovery();
  }

  detach() {
    this.#stopRunObservers();
    this.#cancelSurfaceDiscovery();
    this.#detachSurfaceListener();
    this.#detachSuperdocListeners();
    this.#superdoc = null;
    this.#surface = null;
    this.#run = null;
  }

  prepareRun({ mode, label } = {}) {
    this.#failRun(new Error('Benchmark run was replaced before completion'));

    const nextRun = createPendingRun({
      mode: mode ?? 'pm',
      label: label ?? null,
    });

    v2PerfTimeline.reset();
    v2PerfTimeline.enable();
    v2PerfTimeline.gauge(PROJECTION_APPEND_WINDOW_COUNT, 0);
    v2PerfTimeline.gauge(RUNTIME_WORKER_BUSY_MS_BEFORE_FIRST_PAINT, 0);

    if (nextRun.mode === 'pm') {
      v2PerfTimeline.mark(OPEN_START, { mode: nextRun.mode });
    }

    this.#run = nextRun;
    this.#startRunObservers(nextRun);

    return {
      runId: nextRun.id,
      mode: nextRun.mode,
      label: nextRun.label,
    };
  }

  waitForRun() {
    if (!this.#run) {
      throw new Error('No benchmark run has been prepared');
    }

    return this.#run.promise;
  }

  getStatus() {
    return {
      hasSuperdoc: Boolean(this.#superdoc),
      hasSurface: Boolean(this.#surface),
      hasPendingRun: Boolean(this.#run),
      awaitingFreshAttachment: Boolean(this.#run?.awaitFreshAttachment),
      mode: this.#run?.mode ?? null,
      label: this.#run?.label ?? null,
    };
  }

  #bindResolvedSurface() {
    this.#bindSurface(resolvePresentationSurface(this.#superdoc));
  }

  #bindSurface(surface) {
    if (!surface) {
      return;
    }

    if (surface === this.#surface) {
      this.#markFreshAttachmentReady(surface);
      return;
    }

    this.#detachSurfaceListener();
    this.#cancelSurfaceDiscovery();
    this.#surface = surface;

    const onPaginationUpdate = (payload) => {
      void this.#handlePaginationUpdate(payload);
    };

    if (typeof surface.onLayoutUpdated === 'function') {
      this.#surfaceUnsubscribe = surface.onLayoutUpdated(onPaginationUpdate);
      return;
    }

    if (typeof surface.on === 'function' && typeof surface.off === 'function') {
      surface.on('paginationUpdate', onPaginationUpdate);
      this.#surfaceUnsubscribe = () => surface.off('paginationUpdate', onPaginationUpdate);
    }

    this.#markFreshAttachmentReady(surface);
  }

  async #handlePaginationUpdate(payload) {
    const run = this.#run;
    if (!run || run.completed || run.awaitFreshAttachment) {
      return;
    }

    const layoutPageCount = Array.isArray(payload?.layout?.pages) ? payload.layout.pages.length : null;
    const surfacePageCount = countSurfacePages(this.#surface);
    const mountedPageCount = countMountedPages();
    const pageCount = layoutPageCount ?? surfacePageCount ?? mountedPageCount;

    await this.#completeRun(pageCount);
  }

  #recordRuntimeMetrics(run) {
    v2PerfTimeline.gauge(RUNTIME_MAIN_THREAD_LONG_TASKS_BEFORE_FIRST_PAINT, run.longTaskCount);
    v2PerfTimeline.gauge(RUNTIME_MAIN_THREAD_BLOCKED_MS_BEFORE_FIRST_PAINT, run.longTaskBlockedMs);

    const memoryAtFirstPaintMb = readUsedHeapMb();
    if (memoryAtFirstPaintMb != null) {
      const peakMemoryMb = Math.max(run.peakMemoryMb ?? 0, memoryAtFirstPaintMb);
      v2PerfTimeline.gauge(RUNTIME_MEMORY_AT_FIRST_PAINT_MB, memoryAtFirstPaintMb);
      v2PerfTimeline.gauge(RUNTIME_PEAK_MEMORY_MB, peakMemoryMb);
    }
  }

  #startRunObservers(run) {
    run.awaitFreshAttachment = true;
    run.surfaceDiscoveryDeadlineMs = currentTimeMs() + SURFACE_DISCOVERY_TIMEOUT_MS;

    const PerformanceObserverConstructor = getPerformanceObserverConstructor();
    if (
      PerformanceObserverConstructor &&
      Array.isArray(PerformanceObserverConstructor.supportedEntryTypes) &&
      PerformanceObserverConstructor.supportedEntryTypes.includes('longtask')
    ) {
      run.longTaskObserver = new PerformanceObserverConstructor((list) => {
        for (const entry of list.getEntries()) {
          run.longTaskCount += 1;
          run.longTaskBlockedMs += entry.duration;
        }
      });

      run.longTaskObserver.observe({ entryTypes: ['longtask'] });
    }

    const initialMemoryMb = readUsedHeapMb();
    if (initialMemoryMb != null) {
      run.peakMemoryMb = initialMemoryMb;
      run.memorySamplerId = window.setInterval(() => {
        const currentMemoryMb = readUsedHeapMb();
        if (currentMemoryMb != null) {
          run.peakMemoryMb = Math.max(run.peakMemoryMb ?? 0, currentMemoryMb);
        }
      }, MEMORY_SAMPLE_INTERVAL_MS);
    }
  }

  #stopRunObservers() {
    if (!this.#run) {
      return;
    }

    this.#run.longTaskObserver?.disconnect();
    this.#run.longTaskObserver = null;

    if (this.#run.memorySamplerId != null) {
      window.clearInterval(this.#run.memorySamplerId);
      this.#run.memorySamplerId = null;
    }
  }

  #failRun(error) {
    if (!this.#run) {
      return;
    }

    this.#stopRunObservers();
    this.#cancelSurfaceDiscovery();
    v2PerfTimeline.disable();
    this.#run.reject(error);
    this.#run = null;
  }

  #markFreshAttachmentReady(surface) {
    if (!this.#run || !this.#run.awaitFreshAttachment) {
      return;
    }

    this.#run.awaitFreshAttachment = false;
    void this.#maybeCompleteFromExistingSurface(surface);
  }

  async #maybeCompleteFromExistingSurface(surface) {
    const pageCount = countSurfacePages(surface) ?? countMountedPages();
    if (!pageCount) {
      return;
    }

    await this.#completeRun(pageCount);
  }

  async #completeRun(pageCount) {
    const run = this.#run;
    if (!run || run.completed) {
      return;
    }

    run.completed = true;

    await waitForVisualStability();

    const mountedPageCount = countMountedPages();
    v2PerfTimeline.mark(PAINT_FIRST_VISIBLE_PAGE_STABLE, { mountedPageCount });
    v2PerfTimeline.mark(PAINT_FULL_VISIBLE_VIEWPORT_MOUNTED, { mountedPageCount });

    this.#recordRuntimeMetrics(run);

    const snapshot = v2PerfTimeline.collect();
    v2PerfTimeline.disable();
    this.#stopRunObservers();
    this.#cancelSurfaceDiscovery();

    run.resolve({
      snapshot,
      pageCount,
      mountedPageCount,
      mode: run.mode,
      label: run.label,
    });

    this.#run = null;
  }

  #detachSuperdocListeners() {
    this.#superdocUnsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#superdocUnsubscribes = [];
  }

  #detachSurfaceListener() {
    if (typeof this.#surfaceUnsubscribe === 'function') {
      this.#surfaceUnsubscribe();
    }
    this.#surfaceUnsubscribe = null;
    this.#surface = null;
  }

  #scheduleSurfaceDiscovery() {
    this.#cancelSurfaceDiscovery();

    if (!this.#superdoc) {
      return;
    }

    this.#surfaceDiscoveryTimeoutId = window.setTimeout(() => {
      this.#surfaceDiscoveryTimeoutId = null;

      if (!this.#superdoc) {
        return;
      }

      const resolvedSurface = resolvePresentationSurface(this.#superdoc);
      if (resolvedSurface) {
        this.#bindSurface(resolvedSurface);
        return;
      }

      if (
        this.#run?.awaitFreshAttachment &&
        Number.isFinite(this.#run.surfaceDiscoveryDeadlineMs) &&
        currentTimeMs() >= this.#run.surfaceDiscoveryDeadlineMs
      ) {
        this.#failRun(new Error('Timed out waiting for a render surface after document upload'));
        return;
      }

      this.#scheduleSurfaceDiscovery();
    }, SURFACE_DISCOVERY_INTERVAL_MS);
  }

  #cancelSurfaceDiscovery() {
    if (this.#surfaceDiscoveryTimeoutId == null) {
      return;
    }

    window.clearTimeout(this.#surfaceDiscoveryTimeoutId);
    this.#surfaceDiscoveryTimeoutId = null;
  }
}

function createPendingRun({ mode, label }) {
  const id = `${Date.now()}-${Math.round(Math.random() * 100000)}`;

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    id,
    mode,
    label,
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    completed: false,
    awaitFreshAttachment: true,
    longTaskCount: 0,
    longTaskBlockedMs: 0,
    peakMemoryMb: null,
    longTaskObserver: null,
    memorySamplerId: null,
    surfaceDiscoveryDeadlineMs: null,
  };
}

function listen(emitter, eventName, handler) {
  emitter.on(eventName, handler);
  return () => emitter.off(eventName, handler);
}

function extractBenchmarkError(payload) {
  if (payload?.error instanceof Error) {
    return payload.error;
  }

  if (payload instanceof Error) {
    return payload;
  }

  const message =
    typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.code === 'string'
        ? payload.code
        : 'SuperDoc benchmark run failed';

  return new Error(message);
}

function countMountedPages() {
  return document.querySelectorAll('.superdoc-page').length;
}

function resolvePresentationSurface(superdoc) {
  const activePresentationEditor = superdoc?.activeEditor?.presentationEditor ?? null;
  if (activePresentationEditor) {
    return activePresentationEditor;
  }

  const documents = superdoc?.superdocStore?.documents ?? [];
  for (const documentEntry of documents) {
    const surface = documentEntry?.getPresentationEditor?.() ?? null;
    if (surface) {
      return surface;
    }
  }

  return null;
}

function countSurfacePages(surface) {
  const pages = surface?.getPages?.();
  return Array.isArray(pages) ? pages.length : null;
}

function readUsedHeapMb() {
  const performanceApi = getPerformanceApi();
  if (!performanceApi || !('memory' in performanceApi)) {
    return null;
  }

  const usedBytes = performanceApi.memory?.usedJSHeapSize;
  if (!Number.isFinite(usedBytes)) {
    return null;
  }

  return roundToTenth(usedBytes / (1024 * 1024));
}

function currentTimeMs() {
  const performanceApi = getPerformanceApi();
  return performanceApi?.now?.() ?? Date.now();
}

function getPerformanceApi() {
  return typeof globalThis === 'object' && globalThis?.performance ? globalThis.performance : null;
}

function getPerformanceObserverConstructor() {
  return typeof globalThis === 'object' && globalThis?.PerformanceObserver ? globalThis.PerformanceObserver : null;
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

async function waitForVisualStability() {
  await waitForAnimationFrame();
  await waitForAnimationFrame();
}

function waitForAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve(undefined));
  });
}
