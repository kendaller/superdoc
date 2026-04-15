import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hostInstances, controllerInstances, sessionInstances } = vi.hoisted(() => ({
  hostInstances: [] as any[],
  controllerInstances: [] as any[],
  sessionInstances: [] as any[],
}));

vi.mock('../render/V2StreamingPaginatedRenderHost.js', () => ({
  V2StreamingPaginatedRenderHost: class V2StreamingPaginatedRenderHostMock {
    readonly bindEditingController = vi.fn();
    readonly setInitialEditingControllerBootstrap = vi.fn();
    readonly refreshEditingSnapshot = vi.fn();
    readonly refreshEditingSnapshotView = vi.fn();
    readonly prepareEditingSurface = vi.fn().mockResolvedValue({
      ready: true,
      bootstrapPhase: 'ready',
      bootstrapIssue: null,
      snapshotSource: 'merged',
      renderedParagraphCount: 1,
      renderedEditableParagraphCount: 1,
      renderedEmptyEditableParagraphCount: 0,
      domSegmentCount: 1,
      snapshotParagraphCount: 1,
      supportedParagraphCount: 1,
      emptyEditableParagraphCount: 0,
      blockIdParagraphCount: 1,
      blockIdSupportedParagraphCount: 1,
      sourceRefParagraphCount: 1,
      sourceRefSupportedParagraphCount: 1,
      blockIdOnlySupportedParagraphCount: 0,
      sourceRefOnlySupportedParagraphCount: 0,
      missingRenderedBlockIdCount: 0,
      paragraphsWithoutDomSegmentsCount: 0,
      unsupportedParagraphHistogram: [],
      missingRenderedBlockIds: [],
      paragraphsWithoutDomSegments: [],
    });
    readonly onFirstPaintComplete = vi.fn();
    readonly onStateChange = vi.fn();
    readonly onLoadingStateChange = vi.fn();
    readonly onLayoutUpdated = vi.fn((handler: () => void) => {
      handler();
      return () => {};
    });
    readonly load = vi.fn().mockResolvedValue(undefined);
    readonly destroy = vi.fn();
    readonly updateLayoutEngineOptions = vi.fn();
    readonly setContextMenuDisabled = vi.fn();
    readonly getEditingSurfaceStatus = vi.fn(() => ({
      ready: true,
      bootstrapPhase: 'ready',
      bootstrapIssue: null,
      snapshotSource: 'merged',
      renderedParagraphCount: 1,
      renderedEditableParagraphCount: 1,
      renderedEmptyEditableParagraphCount: 0,
      domSegmentCount: 1,
      snapshotParagraphCount: 1,
      supportedParagraphCount: 1,
      emptyEditableParagraphCount: 0,
      blockIdParagraphCount: 1,
      blockIdSupportedParagraphCount: 1,
      sourceRefParagraphCount: 1,
      sourceRefSupportedParagraphCount: 1,
      blockIdOnlySupportedParagraphCount: 0,
      sourceRefOnlySupportedParagraphCount: 0,
      missingRenderedBlockIdCount: 0,
      paragraphsWithoutDomSegmentsCount: 0,
      unsupportedParagraphHistogram: [],
      missingRenderedBlockIds: [],
      paragraphsWithoutDomSegments: [],
    }));
    readonly getEditingSnapshot = vi.fn(() => ({
      blockToEntityRef: new Map(),
      paragraphsByBlockId: new Map(),
      orderedParagraphs: [],
    }));
    readonly patchEditableParagraphText = vi.fn().mockReturnValue(true);
    readonly commitEditableParagraphText = vi.fn().mockReturnValue(true);

    constructor() {
      hostInstances.push(this);
    }
  },
}));

vi.mock('../runtime/V2EditingController.js', () => ({
  V2EditingController: class V2EditingControllerMock {
    readonly initialize = vi.fn().mockResolvedValue(undefined);
    readonly close = vi.fn().mockResolvedValue(undefined);
    readonly on = vi.fn(() => () => {});
    readonly applyOperation = vi.fn();
    readonly semanticModel = null;
    readonly isActive = vi.fn(() => true);

    constructor() {
      controllerInstances.push(this);
    }
  },
}));

vi.mock('../editing/V2EditingSession.js', () => ({
  V2EditingSession: class V2EditingSessionMock {
    readonly attach = vi.fn();
    readonly refresh = vi.fn();
    readonly setReady = vi.fn();
    readonly destroy = vi.fn();

    constructor(public readonly options: Record<string, unknown>) {
      sessionInstances.push(this);
    }
  },
}));

import V2StreamingRenderer from './V2StreamingRenderer.vue';

describe('V2StreamingRenderer editing mode', () => {
  beforeEach(() => {
    hostInstances.length = 0;
    controllerInstances.length = 0;
    sessionInstances.length = 0;
  });

  it('attaches the selection-based editing session in editable mode on the streaming host', async () => {
    const wrapper = mount(V2StreamingRenderer, {
      props: {
        documentId: 'doc-1',
        fileSource: new Uint8Array([1, 2, 3]),
        options: {
          documentMode: 'editing',
        },
      },
    });

    await flushPromises();

    expect(hostInstances).toHaveLength(1);
    expect(controllerInstances).toHaveLength(1);
    expect(sessionInstances).toHaveLength(1);
    expect(hostInstances[0].setInitialEditingControllerBootstrap).not.toHaveBeenCalled();
    expect(hostInstances[0].load.mock.invocationCallOrder[0]).toBeLessThan(
      controllerInstances[0].initialize.mock.invocationCallOrder[0],
    );
    expect(hostInstances[0].bindEditingController).toHaveBeenCalledWith(controllerInstances[0]);
    expect(hostInstances[0].prepareEditingSurface).toHaveBeenCalledTimes(1);
    expect(sessionInstances[0].attach).toHaveBeenCalledTimes(1);
    expect(sessionInstances[0].setReady).toHaveBeenCalledWith(true);
    expect(sessionInstances[0].refresh).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('renderer-ready')).toHaveLength(1);

    wrapper.unmount();

    expect(sessionInstances[0].destroy).toHaveBeenCalledTimes(1);
    expect(controllerInstances[0].close).toHaveBeenCalledTimes(1);
    expect(hostInstances[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the streaming host read-only in viewing mode', async () => {
    const wrapper = mount(V2StreamingRenderer, {
      props: {
        documentId: 'doc-view',
        fileSource: new Uint8Array([1, 2, 3]),
        options: {
          documentMode: 'viewing',
        },
      },
    });

    await flushPromises();

    expect(hostInstances).toHaveLength(1);
    expect(controllerInstances).toHaveLength(0);
    expect(sessionInstances).toHaveLength(0);
    expect(wrapper.emitted('renderer-ready')).toHaveLength(1);
  });

  it('defers editing controller bootstrap until after load completes for large sources too', async () => {
    const largeSource = new Uint8Array(4 * 1024 * 1024);
    const wrapper = mount(V2StreamingRenderer, {
      props: {
        documentId: 'doc-large',
        fileSource: largeSource,
        options: {
          documentMode: 'editing',
        },
      },
    });

    await flushPromises();

    expect(hostInstances).toHaveLength(1);
    expect(controllerInstances).toHaveLength(1);
    expect(sessionInstances).toHaveLength(0);
    expect(hostInstances[0].setInitialEditingControllerBootstrap).not.toHaveBeenCalled();
    expect(controllerInstances[0].initialize).not.toHaveBeenCalled();
    expect(hostInstances[0].bindEditingController).not.toHaveBeenCalled();
    expect(hostInstances[0].prepareEditingSurface).not.toHaveBeenCalled();

    await wrapper.find('.v2-streaming-renderer__host').trigger('pointerdown');
    await flushPromises();

    expect(sessionInstances).toHaveLength(1);
    expect(hostInstances[0].load.mock.invocationCallOrder[0]).toBeLessThan(
      controllerInstances[0].initialize.mock.invocationCallOrder[0],
    );
    expect(hostInstances[0].bindEditingController).toHaveBeenCalledWith(controllerInstances[0]);
    expect(hostInstances[0].prepareEditingSurface).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
