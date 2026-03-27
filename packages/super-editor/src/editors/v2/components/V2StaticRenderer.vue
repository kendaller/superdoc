<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { LayoutEngineOptions } from '../../v1/core/presentation-editor/types.js';
import { V2StaticRenderHost } from '../render/V2StaticRenderHost.js';

type DocumentMode = 'editing' | 'viewing' | 'suggesting';

type Props = {
  documentId?: string;
  fileSource?: Blob | Uint8Array | null;
  options?: {
    layoutEngineOptions?: LayoutEngineOptions;
    documentMode?: DocumentMode;
    disableContextMenu?: boolean;
  } | null;
};

const props = defineProps<Props>();

const emit = defineEmits<{
  (
    event: 'renderer-ready',
    payload: { renderer: V2StaticRenderHost; documentId?: string; container: HTMLElement },
  ): void;
  (
    event: 'renderer-error',
    payload: { error: Error; documentId?: string; fileSource?: Blob | Uint8Array | null },
  ): void;
}>();

const rootElement = ref<HTMLElement | null>(null);
const renderer = shallowRef<V2StaticRenderHost | null>(null);

async function initializeRenderer(): Promise<void> {
  if (!rootElement.value || !props.fileSource) {
    return;
  }

  teardownRenderer();

  const nextRenderer = new V2StaticRenderHost({
    element: rootElement.value,
    documentId: props.documentId,
    layoutEngineOptions: props.options?.layoutEngineOptions,
    documentMode: props.options?.documentMode,
    disableContextMenu: props.options?.disableContextMenu,
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
  <div ref="rootElement" class="v2-static-renderer" />
</template>

<style scoped>
.v2-static-renderer {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
}
</style>
