<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { LoadingOverlayState, LoadingOverlayTexts } from '../render/streaming-host-types.js';
import type { DocumentLoadingHandle, DocumentLoadingRenderContext } from './loading-overlay-config.js';

const props = defineProps<{
  render: (ctx: DocumentLoadingRenderContext) => { destroy?: () => void } | void;
  documentId?: string;
  state: LoadingOverlayState;
  texts: LoadingOverlayTexts;
}>();

const container = ref<HTMLElement | null>(null);
const listeners = new Set<(state: LoadingOverlayState) => void>();
let destroyFn: (() => void) | null = null;

const loadingOverlayHandle: DocumentLoadingHandle = {
  get visible() {
    return props.state.visible;
  },
  get title() {
    return props.state.title;
  },
  get message() {
    return props.state.message;
  },
  get progressPercent() {
    return props.state.progressPercent;
  },
  get texts() {
    return props.texts;
  },
  subscribe(listener) {
    listeners.add(listener);
    listener(props.state);
    return () => listeners.delete(listener);
  },
};

function mountExternalRenderer(): void {
  cleanup();
  if (!container.value) {
    return;
  }

  const result = props.render({
    container: container.value,
    documentId: props.documentId,
    loadingOverlay: loadingOverlayHandle,
  });

  destroyFn = result?.destroy ?? null;
}

function cleanup(): void {
  if (typeof destroyFn === 'function') {
    destroyFn();
  }
  destroyFn = null;

  if (container.value) {
    container.value.innerHTML = '';
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(props.state);
  }
}

onMounted(mountExternalRenderer);
onBeforeUnmount(() => {
  listeners.clear();
  cleanup();
});

watch(
  () => props.render,
  () => {
    mountExternalRenderer();
  },
);

watch(
  () => props.state,
  () => {
    notifyListeners();
  },
  { deep: true },
);
</script>

<template>
  <div ref="container" class="v2-loading-overlay-external-mount" />
</template>

<style scoped>
.v2-loading-overlay-external-mount {
  width: 100%;
  height: 100%;
}
</style>
