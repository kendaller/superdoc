// ---------------------------------------------------------------------------
// Enrichment module — public API surface
// ---------------------------------------------------------------------------

export type {
  MergePolicy,
  EnrichmentResult,
  HeaderFooterEnrichmentResult,
  FootnoteEnrichmentResult,
  EndnoteEnrichmentResult,
  CommentEnrichmentResult,
  ImageEnrichmentResult,
  HeaderFooterItem,
  AnnotationItem,
  CommentItem,
  ImageItem,
} from './enrichment-results.js';
export type { EnrichmentRequest, SerializableEnrichmentRequest } from './enrichment-request.js';

export type { MergeAction } from './merge-policy.js';
export { classifyMergeAction } from './merge-policy.js';

export { executeEnrichment } from './executors/index.js';

export {
  scheduleEnrichment,
  type EnrichmentSchedulerOptions,
  type EnrichmentSchedulerHandle,
} from './enrichment-scheduler.js';
