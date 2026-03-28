import { StyleResolver } from '../resolve/style-resolver.js';
import { projectWindowToFlowBlocks, type WindowedProjectionResult } from '../projections/layout/index.js';
import type { DocumentHandle } from '../types/session.js';
import type { ProjectWindowParams, WindowContinuation } from './worker-protocol.js';

type PrefetchWindowParams = {
  startBodyChildIndex: number;
  maxBodyChildCount: number;
};

/**
 * Shared windowed-projection helper used by both runtime implementations.
 *
 * The controller keeps the projection logic and the small prefetch cache in
 * one place so the in-process runtime and the worker host stay behaviorally
 * aligned.
 */
export class WindowProjectionController {
  #prefetchedWindows = new Map<string, WindowedProjectionResult>();

  clear(): void {
    this.#prefetchedWindows.clear();
  }

  projectWindow(handle: DocumentHandle, params: ProjectWindowParams): WindowedProjectionResult {
    const cachedResult = this.#takePrefetchedWindow(params);
    if (cachedResult) {
      return cachedResult;
    }

    return this.#projectWindow(handle, params);
  }

  projectNextWindow(handle: DocumentHandle, continuation: WindowContinuation): WindowedProjectionResult {
    return this.projectWindow(handle, {
      startBodyChildIndex: continuation.nextBodyChildIndex,
      maxBodyChildCount: continuation.maxBodyChildCount,
    });
  }

  prefetchWindow(handle: DocumentHandle, params: PrefetchWindowParams): void {
    const cacheKey = buildWindowCacheKey(params);
    if (this.#prefetchedWindows.has(cacheKey)) {
      return;
    }

    this.#prefetchedWindows.set(
      cacheKey,
      this.#projectWindow(handle, {
        startBodyChildIndex: params.startBodyChildIndex,
        maxBodyChildCount: params.maxBodyChildCount,
      }),
    );
  }

  #takePrefetchedWindow(params: ProjectWindowParams): WindowedProjectionResult | undefined {
    const cacheKey = buildWindowCacheKey(params);
    const cachedResult = this.#prefetchedWindows.get(cacheKey);
    if (!cachedResult) {
      return undefined;
    }

    this.#prefetchedWindows.delete(cacheKey);
    return cachedResult;
  }

  #projectWindow(handle: DocumentHandle, params: ProjectWindowParams): WindowedProjectionResult {
    const renderShell = handle.renderShell();
    if (!renderShell) {
      throw new Error('Render shell is not available. Call ready("render-shell") before projecting windows.');
    }

    const views = handle.views();
    const resolver = new StyleResolver(views.styles?.rootElement(), views.numbering?.rootElement());

    return projectWindowToFlowBlocks(renderShell, params, { resolver });
  }
}

function buildWindowCacheKey(params: ProjectWindowParams | PrefetchWindowParams): string {
  const stopAfterPageEstimate = 'stopAfterPageEstimate' in params ? (params.stopAfterPageEstimate ?? '') : '';
  const includeDependencyManifest =
    'includeDependencyManifest' in params && params.includeDependencyManifest === true ? '1' : '0';

  return [params.startBodyChildIndex, params.maxBodyChildCount, stopAfterPageEstimate, includeDependencyManifest].join(
    ':',
  );
}
