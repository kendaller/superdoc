<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import type { DocumentRuntime } from '@superdoc/v2-model';
import type { LayoutEngineOptions } from '../../v1/core/presentation-editor/types.js';
import { V2FastEditingSession } from '../editing/V2FastEditingSession.js';
import { V2StreamingPaginatedRenderHost } from '../render/V2StreamingPaginatedRenderHost.js';
import type { LoadingOverlayState, StateChangeEvent } from '../render/streaming-host-types.js';
import { createDefaultV2DocumentRuntime } from '../runtime/create-default-runtime.js';
import { V2EditingController } from '../runtime/V2EditingController.js';
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
  runtime?: DocumentRuntime | null;
  windowSize?: number;
  firstWindowPageEstimate?: number;
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
const editingController = shallowRef<V2EditingController | null>(null);
const editingSession = shallowRef<V2FastEditingSession | null>(null);
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
const editableMode = computed(() => props.options?.documentMode !== 'viewing');

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

let stopLayoutUpdated: (() => void) | null = null;
let initializeGeneration = 0;

async function initializeRenderer(): Promise<void> {
  if (!rootElement.value) {
    return;
  }

  if (!props.fileSource) {
    await teardownRenderer();
    return;
  }

  await teardownRenderer();
  const generation = ++initializeGeneration;

  const runtime = resolveRuntime();
  const nextEditingController = editableMode.value ? new V2EditingController() : null;

  const nextRenderer = new V2StreamingPaginatedRenderHost({
    element: rootElement.value,
    documentId: props.documentId,
    layoutEngineOptions: props.options?.layoutEngineOptions,
    documentMode: props.options?.documentMode,
    disableContextMenu: props.options?.disableContextMenu,
    showDefaultLoadingOverlay: shouldUseDefaultLoadingOverlay.value,
    loadingTexts: resolvedLoadingConfig.value.texts,
    runtime,
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
    if (generation !== initializeGeneration) {
      nextRenderer.destroy();
      await nextEditingController?.close().catch(() => {});
      return;
    }

    renderer.value = nextRenderer;
    stopLayoutUpdated = nextRenderer.onLayoutUpdated(() => {
      editingSession.value?.refresh();
      editingSession.value?.setReady(nextRenderer.getEditingSurfaceStatus().ready);
    });

    emit('renderer-ready', {
      renderer: nextRenderer,
      documentId: props.documentId,
      container: rootElement.value,
    });

    if (nextEditingController) {
      void initializeEditingInfrastructure({
        generation,
        controller: nextEditingController,
        container: rootElement.value,
        renderer: nextRenderer,
        runtime,
      });
    }
  } catch (error) {
    stopLayoutUpdated?.();
    stopLayoutUpdated = null;
    nextRenderer.destroy();
    await nextEditingController?.close().catch(() => {});

    emit('renderer-error', {
      error: error instanceof Error ? error : new Error(String(error)),
      documentId: props.documentId,
      fileSource: props.fileSource,
    });
  }
}

type EditingInfrastructureOptions = {
  generation: number;
  controller: V2EditingController;
  container: HTMLElement;
  renderer: V2StreamingPaginatedRenderHost;
  runtime: DocumentRuntime;
};

async function initializeEditingInfrastructure(options: EditingInfrastructureOptions): Promise<void> {
  const { generation, controller, container, renderer: host, runtime } = options;
  const source = props.fileSource;
  if (!source) {
    await controller.close().catch(() => {});
    return;
  }

  try {
    await controller.initialize(source);
    if (generation !== initializeGeneration || renderer.value !== host) {
      await controller.close().catch(() => {});
      return;
    }

    host.bindEditingController(controller);
    const editingSurfaceStatus = await host.prepareEditingSurface();

    const session = new V2FastEditingSession({
      container,
      controller,
      runtime,
      getSnapshot: () => host.getEditingSnapshot(),
      patchParagraphText: (blockId, text) => host.patchEditableParagraphText(blockId, text),
      refreshSnapshotFromController: () => host.prepareEditingSurface(),
    });

    editingController.value = controller;
    editingSession.value = session;
    session.attach();
    session.setReady(editingSurfaceStatus.ready);
    session.refresh();
  } catch (error) {
    if (generation !== initializeGeneration || renderer.value !== host) {
      await controller.close().catch(() => {});
      return;
    }

    await controller.close().catch(() => {});
    emit('renderer-error', {
      error: error instanceof Error ? error : new Error(String(error)),
      documentId: props.documentId,
      fileSource: props.fileSource,
    });
  }
}

async function teardownRenderer(): Promise<void> {
  initializeGeneration += 1;
  stopLayoutUpdated?.();
  stopLayoutUpdated = null;

  const currentRenderer = renderer.value;
  const currentEditingController = editingController.value;
  const currentEditingSession = editingSession.value;

  renderer.value = null;
  editingController.value = null;
  editingSession.value = null;
  loadingOverlayState.visible = false;

  currentEditingSession?.destroy();
  currentRenderer?.destroy();

  if (currentEditingController) {
    await currentEditingController.close().catch(() => {});
  }

  if (ownedRuntime.value) {
    await ownedRuntime.value.close().catch(() => {});
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
  () => props.options?.disableContextMenu,
  (disabled) => {
    if (typeof disabled === 'boolean') {
      renderer.value?.setContextMenuDisabled(disabled);
    }
  },
);

watch(
  () => props.options?.documentMode,
  (nextMode, previousMode) => {
    if (nextMode !== previousMode) {
      void initializeRenderer();
    }
  },
);

onMounted(() => {
  void initializeRenderer();
});

onBeforeUnmount(() => {
  void teardownRenderer();
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
        :loading-overlay="loadingOverlayHandle"
        v-bind="customLoadingProps"
      />
    </div>
  </div>
</template>

<style scoped>
.v2-streaming-renderer {
  position: relative;
  width: 100%;
  height: 100%;
}

.v2-streaming-renderer__host {
  width: 100%;
  height: 100%;
}

.v2-streaming-renderer__custom-loading {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}
</style>
