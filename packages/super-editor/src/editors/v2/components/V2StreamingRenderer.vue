<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { LayoutEngineOptions } from '../../v1/core/presentation-editor/types.js';
import type { DocumentRuntime } from '@superdoc/v2-model';
import { V2StreamingPaginatedRenderHost } from '../render/V2StreamingPaginatedRenderHost.js';
import type { StateChangeEvent } from '../render/streaming-host-types.js';

type DocumentMode = 'editing' | 'viewing' | 'suggesting';

type Props = {
  documentId?: string;
  fileSource?: Blob | Uint8Array | null;
  options?: {
    layoutEngineOptions?: LayoutEngineOptions;
    documentMode?: DocumentMode;
    disableContextMenu?: boolean;
  } | null;
  /** The DocumentRuntime to use (worker proxy or in-process). */
  runtime: DocumentRuntime;
  /** Body children per projection window. Default: 50. */
  windowSize?: number;
  /** stopAfterPageEstimate for the first window. Default: 3. */
  firstWindowPageEstimate?: number;
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
    runtime: props.runtime,
    windowSize: props.windowSize,
    firstWindowPageEstimate: props.firstWindowPageEstimate,
  });

  nextRenderer.onFirstPaintComplete((payload) => {
    emit('first-paint-complete', payload);
  });

  nextRenderer.onStateChange((event) => {
    emit('state-change', event);
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
  <div ref="rootElement" class="v2-streaming-renderer" />
</template>

<style scoped>
.v2-streaming-renderer {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
}
</style>
