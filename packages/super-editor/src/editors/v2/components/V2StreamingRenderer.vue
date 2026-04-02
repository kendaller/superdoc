<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import type { LayoutEngineOptions } from '../../v1/core/presentation-editor/types.js';
import type { DocumentRuntime } from '@superdoc/v2-model';
import { V2StreamingPaginatedRenderHost } from '../render/V2StreamingPaginatedRenderHost.js';
import type { LoadingOverlayState, LoadingOverlayTexts, StateChangeEvent } from '../render/streaming-host-types.js';
import { createDefaultV2DocumentRuntime } from '../runtime/create-default-runtime.js';
import V2LoadingOverlayExternalMount from './V2LoadingOverlayExternalMount.vue';
import type { DocumentLoadingConfig, DocumentLoadingHandle } from './loading-overlay-config.js';
import {
  DEFAULT_DOCUMENT_LOADING_TEXTS,
  resolveDocumentLoadingConfig,
  resolveDocumentLoadingRendering,
} from './loading-overlay-config.js';

type DocumentMode = 'editing' | 'viewing' | 'suggesting';

type Props = {
  documentId?: string;
  fileSource?: Blob | Uint8Array | null;
  options?: {
    layoutEngineOptions?: LayoutEngineOptions;
    documentMode?: DocumentMode;
    disableContextMenu?: boolean;
  } | null;
  /** Optional runtime override. Defaults to the worker-backed browser runtime. */
  runtime?: DocumentRuntime | null;
  /** Body children per projection window. Default: 50. */
  windowSize?: number;
  /** stopAfterPageEstimate for the first window. Default: 2. */
  firstWindowPageEstimate?: number;
  /** Optional custom loading overlay configuration. */
  loadingOverlay?: boolean | DocumentLoadingConfig | null;
};

const props = defineProps<Props>();

const emit = defineEmits<{
  (
    event: 'renderer-ready',
    payload: { renderer: V2StreamingPaginatedRenderHost; documentId?: string; container: HTMLElement },
  ): void;
  (
    event: 'renderer-error',
    payload: { error: Error; documentId?: string; fileSource?: Blob | Uint8Array | null },
  ): void;
  (event: 'first-paint-complete', payload: { pageCount: number }): void;
  (event: 'state-change', payload: StateChangeEvent): void;
}>();

const rootElement = ref<HTMLElement | null>(null);
const renderer = shallowRef<V2StreamingPaginatedRenderHost | null>(null);
const ownedRuntime = shallowRef<DocumentRuntime | null>(null);
const loadingOverlayState = reactive<LoadingOverlayState>({
  visible: false,
  title: DEFAULT_DOCUMENT_LOADING_TEXTS.title,
  message: DEFAULT_DOCUMENT_LOADING_TEXTS.openingMessage,
  progressPercent: 0,
});
const resolvedLoadingConfig = computed(() => resolveDocumentLoadingConfig(props.loadingOverlay));
const resolvedLoadingRendering = computed(() =>
  resolveDocumentLoadingRendering(resolvedLoadingConfig.value, {
    documentId: props.documentId,
    texts: resolvedLoadingConfig.value.texts,
  }),
);
const shouldUseDefaultLoadingOverlay = computed(() => Boolean(resolvedLoadingRendering.value.builtin));
const customLoadingComponent = computed(() => resolvedLoadingRendering.value.component ?? null);
const customLoadingRender = computed(() => resolvedLoadingRendering.value.render ?? null);
const customLoadingProps = computed(() => resolvedLoadingRendering.value.props ?? {});

const loadingOverlayHandle: DocumentLoadingHandle = {
  get visible() {
    return loadingOverlayState.visible;
  },
  get title() {
    return loadingOverlayState.title;
  },
  get message() {
    return loadingOverlayState.message;
  },
  get progressPercent() {
    return loadingOverlayState.progressPercent;
  },
  get texts() {
    return resolvedLoadingConfig.value.texts;
  },
  subscribe(listener) {
    const stop = watch(
      () => ({
        visible: loadingOverlayState.visible,
        title: loadingOverlayState.title,
        message: loadingOverlayState.message,
        progressPercent: loadingOverlayState.progressPercent,
      }),
      (nextState) => {
        listener(nextState);
      },
      { immediate: true },
    );

    return stop;
  },
};

async function initializeRenderer(): Promise<void> {
  if (!rootElement.value || !props.fileSource) {
    return;
  }

  teardownRenderer();

  const nextRenderer = new V2StreamingPaginatedRenderHost({
    element: rootElement.value,
    documentId: props.documentId,
    layoutEngineOptions: props.options?.layoutEngineOptions,
    documentMode: props.options?.documentMode,
    disableContextMenu: props.options?.disableContextMenu,
    showDefaultLoadingOverlay: shouldUseDefaultLoadingOverlay.value,
    loadingTexts: resolvedLoadingConfig.value.texts,
    runtime: resolveRuntime(),
    windowSize: props.windowSize,
    firstWindowPageEstimate: props.firstWindowPageEstimate,
  });

  nextRenderer.onFirstPaintComplete((payload) => {
    emit('first-paint-complete', payload);
  });

  nextRenderer.onStateChange((event) => {
    emit('state-change', event);
  });

  nextRenderer.onLoadingStateChange((state) => {
    loadingOverlayState.visible = state.visible;
    loadingOverlayState.title = state.title;
    loadingOverlayState.message = state.message;
    loadingOverlayState.progressPercent = state.progressPercent;
  });

  try {
    await nextRenderer.load(props.fileSource);
    renderer.value = nextRenderer;
    emit('renderer-ready', {
      renderer: nextRenderer,
      documentId: props.documentId,
      container: rootElement.value,
    });
  } catch (error) {
    nextRenderer.destroy();
    emit('renderer-error', {
      error: error instanceof Error ? error : new Error(String(error)),
      documentId: props.documentId,
      fileSource: props.fileSource,
    });
  }
}

function teardownRenderer(): void {
  renderer.value?.destroy();
  renderer.value = null;
  loadingOverlayState.visible = false;

  if (ownedRuntime.value) {
    void ownedRuntime.value.close();
    ownedRuntime.value = null;
  }
}

function resolveRuntime(): DocumentRuntime {
  if (props.runtime) {
    return props.runtime;
  }

  if (!ownedRuntime.value) {
    ownedRuntime.value = createDefaultV2DocumentRuntime();
  }

  return ownedRuntime.value;
}

watch(
  () => props.fileSource,
  () => {
    void initializeRenderer();
  },
);

watch(
  () => props.options?.layoutEngineOptions,
  (nextOptions) => {
    renderer.value?.updateLayoutEngineOptions(nextOptions ?? undefined);
  },
  { deep: true },
);

watch(
  () => props.options?.documentMode,
  (nextMode) => {
    if (nextMode) {
      renderer.value?.setDocumentMode(nextMode);
    }
  },
);

watch(
  () => props.options?.disableContextMenu,
  (disabled) => {
    if (typeof disabled === 'boolean') {
      renderer.value?.setContextMenuDisabled(disabled);
    }
  },
);

onMounted(() => {
  void initializeRenderer();
});

onBeforeUnmount(() => {
  teardownRenderer();
});
</script>

<template>
  <div class="v2-streaming-renderer">
    <div ref="rootElement" class="v2-streaming-renderer__host" />

    <div v-if="customLoadingComponent && loadingOverlayState.visible" class="v2-streaming-renderer__custom-loading">
      <component
        :is="customLoadingComponent"
        v-bind="{
          ...customLoadingProps,
          loadingOverlay: loadingOverlayHandle,
        }"
      />
    </div>

    <div v-else-if="customLoadingRender && loadingOverlayState.visible" class="v2-streaming-renderer__custom-loading">
      <V2LoadingOverlayExternalMount
        :render="customLoadingRender"
        :document-id="documentId"
        :state="loadingOverlayState"
        :texts="resolvedLoadingConfig.texts"
      />
    </div>
  </div>
</template>

<style scoped>
.v2-streaming-renderer {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
}

.v2-streaming-renderer__host {
  width: 100%;
  height: 100%;
}

.v2-streaming-renderer__custom-loading {
  position: fixed;
  top: var(--sd-ui-loader-offset-top, 132px);
  left: 50%;
  transform: translateX(-50%);
  width: var(--sd-ui-loader-width, min(420px, calc(100vw - 48px)));
  z-index: var(--sd-ui-loader-z-index, 20);
  pointer-events: none;
}
</style>
