<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { LayoutEngineOptions } from '../../v1/core/presentation-editor/types.js';
import { V2EditingSession } from '../editing/V2EditingSession.js';
import { V2StaticRenderHost } from '../render/V2StaticRenderHost.js';
import { V2EditingController } from '../runtime/V2EditingController.js';

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

const surfaceElement = ref<HTMLElement | null>(null);
const renderer = shallowRef<V2StaticRenderHost | null>(null);
const editingController = shallowRef<V2EditingController | null>(null);
const editingSession = shallowRef<V2EditingSession | null>(null);

let stopLayoutUpdated: (() => void) | null = null;

function isEditableMode(mode?: DocumentMode | null): boolean {
  return mode !== 'viewing';
}

async function initializeRenderer(): Promise<void> {
  if (!surfaceElement.value) {
    return;
  }

  if (!props.fileSource) {
    await teardownRenderer();
    return;
  }

  await teardownRenderer();

  const nextRenderer = new V2StaticRenderHost({
    element: surfaceElement.value,
    documentId: props.documentId,
    layoutEngineOptions: props.options?.layoutEngineOptions,
    documentMode: props.options?.documentMode,
    disableContextMenu: props.options?.disableContextMenu,
  });

  const nextController = isEditableMode(props.options?.documentMode) ? new V2EditingController() : null;
  let nextEditingSession: V2EditingSession | null = null;

  if (nextController) {
    nextRenderer.bindEditingController(nextController);
  }

  try {
    await nextRenderer.load(props.fileSource);

    nextEditingSession = nextController
      ? new V2EditingSession({
          container: surfaceElement.value,
          controller: nextController,
          getSnapshot: () => nextRenderer.getEditingSnapshot(),
        })
      : null;

    nextEditingSession?.attach();

    renderer.value = nextRenderer;
    editingController.value = nextController;
    editingSession.value = nextEditingSession;
    stopLayoutUpdated = nextRenderer.onLayoutUpdated(() => {
      nextEditingSession?.refresh();
    });

    emit('renderer-ready', {
      renderer: nextRenderer,
      documentId: props.documentId,
      container: surfaceElement.value,
    });
  } catch (error) {
    stopLayoutUpdated?.();
    stopLayoutUpdated = null;
    nextRenderer.destroy();
    nextEditingSession?.destroy();
    if (nextController) {
      await nextController.close().catch(() => {});
    }
    emit('renderer-error', {
      error: error instanceof Error ? error : new Error(String(error)),
      documentId: props.documentId,
      fileSource: props.fileSource,
    });
  }
}

async function teardownRenderer(): Promise<void> {
  stopLayoutUpdated?.();
  stopLayoutUpdated = null;

  const currentRenderer = renderer.value;
  const currentController = editingController.value;
  const currentEditingSession = editingSession.value;

  renderer.value = null;
  editingController.value = null;
  editingSession.value = null;

  currentEditingSession?.destroy();
  currentRenderer?.destroy();

  if (currentController) {
    await currentController.close().catch(() => {});
  }
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
  (nextMode, previousMode) => {
    if (nextMode !== previousMode) {
      void initializeRenderer();
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
  void teardownRenderer();
});
</script>

<template>
  <div class="v2-static-renderer">
    <div ref="surfaceElement" class="v2-static-renderer__surface" />
  </div>
</template>

<style scoped>
.v2-static-renderer {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.v2-static-renderer__surface {
  width: 100%;
  height: 100%;
}
</style>
