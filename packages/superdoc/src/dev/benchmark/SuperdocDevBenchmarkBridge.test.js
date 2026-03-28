import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { createSuperdocDevBenchmarkBridge } from './SuperdocDevBenchmarkBridge.js';

class FakeSurface extends EventEmitter {
  #pages;

  constructor(pageCount = 0) {
    super();
    this.#pages = createPages(pageCount);
  }

  onLayoutUpdated(handler) {
    this.on('layoutUpdated', handler);
    return () => this.off('layoutUpdated', handler);
  }

  getPages() {
    return this.#pages;
  }

  setPageCount(pageCount) {
    this.#pages = createPages(pageCount);
  }

  emitLayoutUpdated(pageCount = this.#pages.length) {
    this.setPageCount(pageCount);
    mountPages(pageCount);
    this.emit('layoutUpdated', { layout: { pages: this.#pages } });
  }
}

class FakeSuperdoc extends EventEmitter {
  constructor({ surface = null, includeActiveEditor = true } = {}) {
    super();

    this.activeEditor = includeActiveEditor && surface ? { presentationEditor: surface } : null;
    this.superdocStore = {
      documents: surface
        ? [
            {
              getPresentationEditor: () => surface,
            },
          ]
        : [],
    };
  }
}

describe('SuperdocDevBenchmarkBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        static supportedEntryTypes = [];
        observe() {}
        disconnect() {}
      },
    );
    clearMountedPages();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearMountedPages();
  });

  it('resolves a run after a fresh PM surface emits a layout update', async () => {
    const bridge = createSuperdocDevBenchmarkBridge();
    const initialSuperdoc = new FakeSuperdoc();
    const freshSurface = new FakeSurface();
    const freshSuperdoc = new FakeSuperdoc({ surface: freshSurface });

    bridge.attachSuperdoc(initialSuperdoc);
    bridge.prepareRun({ mode: 'pm', label: 'pm-doc' });

    const runPromise = bridge.waitForRun();
    bridge.attachSuperdoc(freshSuperdoc);
    freshSurface.emitLayoutUpdated(2);

    await vi.runAllTimersAsync();
    const result = await runPromise;

    expect(result.mode).toBe('pm');
    expect(result.label).toBe('pm-doc');
    expect(result.pageCount).toBe(2);
    expect(result.mountedPageCount).toBe(2);
  });

  it('finds the presentation surface from the document store when activeEditor is unavailable', async () => {
    const bridge = createSuperdocDevBenchmarkBridge();
    const surface = new FakeSurface(1);
    const superdoc = new FakeSuperdoc({
      surface,
      includeActiveEditor: false,
    });

    bridge.prepareRun({ mode: 'v2', label: 'store-surface' });
    const runPromise = bridge.waitForRun();
    bridge.attachSuperdoc(superdoc);

    await vi.runAllTimersAsync();
    const result = await runPromise;

    expect(result.mode).toBe('v2');
    expect(result.pageCount).toBe(1);
  });

  it('fails the pending run when the current SuperDoc emits an exception', async () => {
    const bridge = createSuperdocDevBenchmarkBridge();
    const superdoc = new FakeSuperdoc();

    bridge.attachSuperdoc(superdoc);
    bridge.prepareRun({ mode: 'pm', label: 'broken-doc' });

    const runPromise = bridge.waitForRun();
    superdoc.emit('exception', { error: new Error('render failed') });

    await expect(runPromise).rejects.toThrow('render failed');
  });
});

function createPages(count) {
  return Array.from({ length: count }, () => ({}));
}

function mountPages(count) {
  clearMountedPages();

  for (let index = 0; index < count; index += 1) {
    const page = document.createElement('div');
    page.className = 'superdoc-page';
    document.body.append(page);
  }
}

function clearMountedPages() {
  document.querySelectorAll('.superdoc-page').forEach((page) => page.remove());
}
