// ---------------------------------------------------------------------------
// Enrichment request types
//
// Separates the full runtime request shape from the worker-serializable
// payload. AbortSignal stays on the local runtime interface; the worker
// transport forwards cancellation via task cancellation instead.
// ---------------------------------------------------------------------------

import type { DependencyManifest } from '../projections/layout/dependency-manifest.js';

/**
 * Local enrichment request passed to a DocumentRuntime implementation.
 *
 * `signal` is intentionally excluded from the worker transport payload.
 * WorkerProxyV2 converts it into task cancellation on the transport layer.
 */
export type EnrichmentRequest = {
  ids?: string[];
  manifest?: DependencyManifest;
  signal?: AbortSignal;
};

/** Structured-cloneable subset of {@link EnrichmentRequest}. */
export type SerializableEnrichmentRequest = Omit<EnrichmentRequest, 'signal'>;
