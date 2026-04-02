import type { LoadingOverlayTexts, LoadingOverlayState } from '../render/streaming-host-types.js';

export type DocumentLoadingResolution =
  | { type: 'default' }
  | { type: 'none' }
  | { type: 'custom'; component: unknown; props?: Record<string, unknown> }
  | { type: 'external'; render: (ctx: DocumentLoadingRenderContext) => { destroy?: () => void } | void };

export type DocumentLoadingContext = {
  documentId?: string;
  texts: LoadingOverlayTexts;
};

export type DocumentLoadingHandle = {
  readonly visible: boolean;
  readonly title: string;
  readonly message: string;
  readonly progressPercent: number;
  readonly texts: LoadingOverlayTexts;
  subscribe(listener: (state: LoadingOverlayState) => void): () => void;
};

export type DocumentLoadingRenderContext = {
  container: HTMLElement;
  documentId?: string;
  loadingOverlay: DocumentLoadingHandle;
};

export type DocumentLoadingConfig = {
  title?: string;
  openingMessage?: string;
  preparingMessage?: string;
  almostReadyMessage?: string;
  component?: unknown;
  props?: Record<string, unknown>;
  render?: (ctx: DocumentLoadingRenderContext) => { destroy?: () => void } | void;
  resolver?: (ctx: DocumentLoadingContext) => DocumentLoadingResolution | null | undefined;
};

export type ResolvedDocumentLoadingConfig = {
  enabled: boolean;
  texts: LoadingOverlayTexts;
  component?: unknown;
  props?: Record<string, unknown>;
  render?: (ctx: DocumentLoadingRenderContext) => { destroy?: () => void } | void;
  resolver?: (ctx: DocumentLoadingContext) => DocumentLoadingResolution | null | undefined;
};

export const DEFAULT_DOCUMENT_LOADING_TEXTS: LoadingOverlayTexts = {
  title: 'Loading document',
  openingMessage: 'Opening document…',
  preparingMessage: 'Preparing first pages…',
  almostReadyMessage: 'Almost ready. Your document will appear shortly…',
};

export function resolveDocumentLoadingConfig(
  rawConfig: boolean | DocumentLoadingConfig | null | undefined,
): ResolvedDocumentLoadingConfig {
  if (rawConfig === false) {
    return {
      enabled: false,
      texts: DEFAULT_DOCUMENT_LOADING_TEXTS,
    };
  }

  if (rawConfig == null || rawConfig === true) {
    return {
      enabled: true,
      texts: DEFAULT_DOCUMENT_LOADING_TEXTS,
    };
  }

  if (rawConfig.component != null && typeof rawConfig.render === 'function') {
    throw new Error('documentLoading cannot provide both "component" and "render". Use one or the other.');
  }

  return {
    enabled: true,
    texts: {
      title: rawConfig.title ?? DEFAULT_DOCUMENT_LOADING_TEXTS.title,
      openingMessage: rawConfig.openingMessage ?? DEFAULT_DOCUMENT_LOADING_TEXTS.openingMessage,
      preparingMessage: rawConfig.preparingMessage ?? DEFAULT_DOCUMENT_LOADING_TEXTS.preparingMessage,
      almostReadyMessage: rawConfig.almostReadyMessage ?? DEFAULT_DOCUMENT_LOADING_TEXTS.almostReadyMessage,
    },
    component: rawConfig.component,
    props: rawConfig.props,
    render: rawConfig.render,
    resolver: rawConfig.resolver,
  };
}

export function resolveDocumentLoadingRendering(
  config: ResolvedDocumentLoadingConfig,
  context: DocumentLoadingContext,
): { suppressed?: boolean; builtin?: boolean; component?: unknown; props?: Record<string, unknown>; render?: (
  ctx: DocumentLoadingRenderContext,
) => { destroy?: () => void } | void } {
  if (!config.enabled) {
    return { suppressed: true };
  }

  if (typeof config.resolver === 'function') {
    const resolution = config.resolver(context);
    if (resolution != null && resolution.type !== 'default') {
      if (resolution.type === 'none') return { suppressed: true };
      if (resolution.type === 'custom') return { component: resolution.component, props: resolution.props };
      if (resolution.type === 'external') return { render: resolution.render };
    }
  }

  if (config.component != null) {
    return { component: config.component, props: config.props };
  }

  if (typeof config.render === 'function') {
    return { render: config.render };
  }

  return { builtin: true };
}
