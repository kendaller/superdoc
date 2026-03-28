// ---------------------------------------------------------------------------
// Enrichment scheduler
//
// Consumes a DependencyManifest and issues prioritized enrich() calls
// through the DocumentRuntime interface. Supports incremental manifest
// updates, in-flight deduplication, and cooperative cancellation.
// ---------------------------------------------------------------------------

import type { DocumentRuntime } from '../runtime/runtime-interface.js';
import type { EnrichmentTarget } from '../runtime/worker-protocol.js';
import type { DependencyManifest } from '../projections/layout/dependency-manifest.js';
import type { EnrichmentResult } from './enrichment-results.js';
import type { EnrichmentRequest } from './enrichment-request.js';

export type EnrichmentSchedulerOptions = {
  runtime: DocumentRuntime;
  manifest: DependencyManifest;
  onResult: (result: EnrichmentResult) => void;
  onError?: (target: EnrichmentTarget, error: Error) => void;
};

export type EnrichmentSchedulerHandle = {
  /** Cancel all in-flight and pending enrichment work. */
  cancel(): void;
  /** Feed a new manifest (e.g., from a subsequent window projection). Only dispatches delta IDs. */
  updateManifest(manifest: DependencyManifest): void;
  /** Resolves when all enrichment work from the current manifest is done (or cancelled). */
  readonly completed: Promise<void>;
};

type TargetBatch = {
  target: EnrichmentTarget;
  ids: string[];
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

type IdRegistry = Map<EnrichmentTarget, Set<string>>;

/**
 * Priority order for enrichment targets.
 * Lower index = higher priority.
 */
const TARGET_PRIORITY: EnrichmentTarget[] = ['headers-footers', 'footnotes', 'images', 'comments', 'endnotes'];

/**
 * Schedule enrichment work based on a dependency manifest.
 *
 * The scheduler runs one target batch at a time in priority order. It keeps
 * track of in-flight and already-finished IDs so manifest updates can add new
 * work without redispatching items that are already running or have already
 * been attempted.
 */
export function scheduleEnrichment(options: EnrichmentSchedulerOptions): EnrichmentSchedulerHandle {
  const { runtime, onResult, onError } = options;
  const finishedIds = createIdRegistry();
  const inFlightIds = createIdRegistry();

  let currentManifest = options.manifest;
  let aborted = false;
  let pumpPromise: Promise<void> | null = null;
  let activeAbortController: AbortController | null = null;
  let drain = createDeferred<void>();
  let drainSettled = false;

  ensurePump();

  return {
    cancel(): void {
      if (aborted) {
        return;
      }

      aborted = true;
      activeAbortController?.abort();
      settleDrain();
    },

    updateManifest(manifest: DependencyManifest): void {
      if (aborted) {
        return;
      }

      currentManifest = manifest;
      ensurePump();
    },

    get completed(): Promise<void> {
      return drain.promise;
    },
  };

  function ensurePump(): void {
    if (aborted) {
      settleDrain();
      return;
    }

    if (!hasPendingWork(currentManifest)) {
      settleDrain();
      return;
    }

    if (drainSettled) {
      drain = createDeferred<void>();
      drainSettled = false;
    }

    if (!pumpPromise) {
      pumpPromise = runPump();
    }
  }

  async function runPump(): Promise<void> {
    try {
      while (!aborted) {
        const nextBatch = getNextBatch(currentManifest);
        if (!nextBatch) {
          break;
        }

        await dispatchBatch(nextBatch);
      }
    } finally {
      pumpPromise = null;

      if (aborted || !hasPendingWork(currentManifest)) {
        settleDrain();
      } else {
        ensurePump();
      }
    }
  }

  async function dispatchBatch(batch: TargetBatch): Promise<void> {
    const abortController = new AbortController();
    activeAbortController = abortController;
    markIds(inFlightIds, batch.target, batch.ids);

    try {
      const result = await runtime.enrich(
        batch.target,
        buildEnrichmentRequest(batch.target, batch.ids, currentManifest, abortController.signal),
      );

      if (aborted || abortController.signal.aborted) {
        return;
      }

      markIds(finishedIds, batch.target, batch.ids);
      onResult(result);
    } catch (error) {
      if (aborted || isAbortError(error)) {
        return;
      }

      markIds(finishedIds, batch.target, batch.ids);
      onError?.(batch.target, normalizeError(error));
    } finally {
      unmarkIds(inFlightIds, batch.target, batch.ids);
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }
  }

  function getNextBatch(manifest: DependencyManifest): TargetBatch | null {
    for (const target of TARGET_PRIORITY) {
      const ids = getPendingIds(target, manifest);
      if (ids.length > 0) {
        return { target, ids };
      }
    }

    return null;
  }

  function getPendingIds(target: EnrichmentTarget, manifest: DependencyManifest): string[] {
    const requestedIds = getIdsForTarget(manifest, target);
    const finished = finishedIds.get(target);
    const inFlight = inFlightIds.get(target);

    return requestedIds.filter((id) => !finished?.has(id) && !inFlight?.has(id));
  }

  function hasPendingWork(manifest: DependencyManifest): boolean {
    return TARGET_PRIORITY.some((target) => getPendingIds(target, manifest).length > 0);
  }

  function settleDrain(): void {
    if (drainSettled) {
      return;
    }

    drainSettled = true;
    drain.resolve(undefined);
  }
}

function getIdsForTarget(manifest: DependencyManifest, target: EnrichmentTarget): string[] {
  switch (target) {
    case 'headers-footers':
      return manifest.headerFooterRefs.map((ref) => ref.relationshipId);
    case 'footnotes':
      return manifest.footnoteRefs.map((ref) => ref.footnoteId);
    case 'endnotes':
      return manifest.endnoteRefs.map((ref) => ref.endnoteId);
    case 'comments':
      return manifest.commentRefs.map((ref) => ref.commentId);
    case 'images':
      return manifest.imageRefs.map((ref) => ref.relationshipId);
  }
}

function buildEnrichmentRequest(
  target: EnrichmentTarget,
  ids: string[],
  manifest: DependencyManifest,
  signal: AbortSignal,
): EnrichmentRequest {
  return {
    ids,
    signal,
    ...(target === 'images' ? { manifest } : {}),
  };
}

function createIdRegistry(): IdRegistry {
  return new Map();
}

function markIds(registry: IdRegistry, target: EnrichmentTarget, ids: string[]): void {
  let targetIds = registry.get(target);
  if (!targetIds) {
    targetIds = new Set();
    registry.set(target, targetIds);
  }

  for (const id of ids) {
    targetIds.add(id);
  }
}

function unmarkIds(registry: IdRegistry, target: EnrichmentTarget, ids: string[]): void {
  const targetIds = registry.get(target);
  if (!targetIds) {
    return;
  }

  for (const id of ids) {
    targetIds.delete(id);
  }

  if (targetIds.size === 0) {
    registry.delete(target);
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TaskCancelledError');
}
