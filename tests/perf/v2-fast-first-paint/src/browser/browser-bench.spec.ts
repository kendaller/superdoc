import { test, expect } from '@playwright/test';
import { createArtifact, type BenchmarkArtifact, type BenchmarkMode, type TimelineSnapshot } from '@superdoc/v2-perf';
import { detectMachineInfo } from '../harness.js';
import { detectGitInfo } from '../git-info.js';
import { finalizeBrowserBenchmarkSnapshot } from '../snapshot.js';
import { loadBrowserBenchmarkEntries } from './corpus.js';
import { persistBenchmarkArtifacts } from './artifact-store.js';

const DEV_HARNESS_SELECTORS = {
  primaryUploadInput: '.dev-app__upload-input input[type="file"]',
} as const;

test.describe.configure({ mode: 'serial' });

test('collects browser TTFFP artifacts for PM and v2-static', async ({ page }) => {
  const machine = await detectMachineInfo();
  const git = detectGitInfo();
  const corpusEntries = await loadBrowserBenchmarkEntries();
  const warmCache = process.env.SUPERDOC_PERF_WARM_CACHE === '1';
  const benchmarkModes = resolveBenchmarkModes();
  const artifacts: BenchmarkArtifact[] = [];

  expect(corpusEntries.length).toBeGreaterThan(0);

  for (const entry of corpusEntries) {
    for (const mode of benchmarkModes) {
      const capturedErrors = capturePageErrors(page);

      await test.step(`${entry.id} (${mode})`, async () => {
        await page.goto(resolveDevHarnessUrl(mode));
        await page.waitForFunction(() =>
          Boolean(
            (
              window as Window & {
                __SUPERDOC_DEV_BENCHMARK__?: unknown;
              }
            ).__SUPERDOC_DEV_BENCHMARK__,
          ),
        );
        const primaryUploadInput = getPrimaryUploadInput(page);
        await expect(primaryUploadInput).toBeVisible();

        await page.evaluate(
          ({ benchmarkMode, label }) => {
            const benchmarkBridge = (
              window as Window & {
                __SUPERDOC_DEV_BENCHMARK__: {
                  prepareRun(options: { mode: BenchmarkMode; label: string }): unknown;
                };
              }
            ).__SUPERDOC_DEV_BENCHMARK__;

            return benchmarkBridge.prepareRun({
              mode: benchmarkMode,
              label,
            });
          },
          {
            benchmarkMode: mode,
            label: entry.label,
          },
        );

        const benchmarkRunPromise = page.evaluate(() => {
          const benchmarkBridge = (
            window as Window & {
              __SUPERDOC_DEV_BENCHMARK__: {
                waitForRun(): Promise<{
                  snapshot: TimelineSnapshot;
                  pageCount: number;
                  mountedPageCount: number;
                  mode: BenchmarkMode;
                  label: string | null;
                }>;
              };
            }
          ).__SUPERDOC_DEV_BENCHMARK__;

          return benchmarkBridge.waitForRun();
        });

        await primaryUploadInput.setInputFiles(entry.absolutePath);

        const runResult = await benchmarkRunPromise;
        const finalizedSnapshot = finalizeBrowserBenchmarkSnapshot(runResult.snapshot as TimelineSnapshot);

        expect(finalizedSnapshot.timings.render).toBeGreaterThan(0);
        expect(runResult.pageCount).toBeGreaterThan(0);

        artifacts.push(
          createArtifact(finalizedSnapshot, entry, mode, machine, git, {
            warmCache,
            pageCount: runResult.pageCount,
          }),
        );
      });

      expect(capturedErrors.flush()).toEqual([]);
    }
  }

  const persisted = await persistBenchmarkArtifacts({
    artifacts,
    corpusEntries,
    runLabel: process.env.SUPERDOC_PERF_RUN_LABEL ?? 'browser',
  });

  console.log(`\nBrowser benchmark artifacts written to ${persisted.outputDirectory}\n`);
  console.log(`${persisted.summaryTable}\n`);
  if (persisted.deltaTable) {
    console.log(`${persisted.deltaTable}\n`);
  }
});

function resolveBenchmarkModes(): BenchmarkMode[] {
  const configuredModes = process.env.SUPERDOC_PERF_MODES?.split(',')
    .map((mode) => mode.trim())
    .filter(Boolean);

  const normalizedModes = configuredModes?.filter(isBrowserBenchmarkMode) ?? ['pm', 'v2-static'];
  return normalizedModes.length > 0 ? normalizedModes : ['pm', 'v2-static'];
}

function isBrowserBenchmarkMode(mode: string): mode is BenchmarkMode {
  return mode === 'pm' || mode === 'v2-static';
}

function resolveDevHarnessUrl(mode: BenchmarkMode): string {
  const searchParams = new URLSearchParams();
  if (mode === 'v2-static') {
    searchParams.set('pipeline', 'v2-static');
  }

  const queryString = searchParams.toString();
  return queryString ? `/?${queryString}` : '/';
}

function getPrimaryUploadInput(page: import('@playwright/test').Page) {
  return page.locator(DEV_HARNESS_SELECTORS.primaryUploadInput);
}

function capturePageErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];

  const onPageError = (error: Error) => {
    errors.push(error.message);
  };

  const onConsoleMessage = (message: import('@playwright/test').ConsoleMessage) => {
    if (message.type() !== 'error') {
      return;
    }

    const text = message.text();
    if (text.includes('favicon.ico')) {
      return;
    }

    errors.push(text);
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsoleMessage);

  return {
    flush() {
      page.off('pageerror', onPageError);
      page.off('console', onConsoleMessage);
      return [...errors];
    },
  };
}
