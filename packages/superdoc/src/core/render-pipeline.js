export const LEGACY_RENDER_PIPELINE = 'legacy';
export const V2_RENDER_PIPELINE = 'v2';

const V2_RENDER_PIPELINE_ALIASES = new Set([V2_RENDER_PIPELINE, 'v2-static', 'v2-streaming']);

/**
 * Normalize historical v2 pipeline aliases to the single public `v2` value.
 *
 * @param {unknown} renderPipeline
 * @returns {'legacy' | 'v2'}
 */
export function normalizeRenderPipeline(renderPipeline) {
  if (typeof renderPipeline !== 'string') {
    return LEGACY_RENDER_PIPELINE;
  }

  return V2_RENDER_PIPELINE_ALIASES.has(renderPipeline) ? V2_RENDER_PIPELINE : LEGACY_RENDER_PIPELINE;
}

/**
 * @param {unknown} renderPipeline
 * @returns {boolean}
 */
export function isV2RenderPipeline(renderPipeline) {
  return normalizeRenderPipeline(renderPipeline) === V2_RENDER_PIPELINE;
}
