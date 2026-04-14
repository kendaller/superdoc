import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import V2StaticRenderer from './V2StaticRenderer.vue';

const { hostInstances, controllerInstances, sessionInstances } = vi.hoisted(() => ({
  hostInstances: [] as any[],
  controllerInstances: [] as any[],
  sessionInstances: [] as any[],
}));

vi.mock('../render/V2StaticRenderHost.js', () => ({
  V2StaticRenderHost: class V2StaticRenderHostMock {
    element: HTMLElement;
    bindEditingController = vi.fn();
    load = vi.fn().mockResolvedValue(undefined);
    updateLayoutEngineOptions = vi.fn();
    setContextMenuDisabled = vi.fn();
    destroy = vi.fn();
    onLayoutUpdated = vi.fn((handler: () => void) => {
      handler();
      return () => {};
    });
    getEditingSnapshot = vi.fn(() => ({
      blockToEntityRef: new Map([['block-1', { id: 'para-1' }]]),
      paragraphsByBlockId: new Map(),
      orderedParagraphs: [],
    }));

    constructor(options: { element: HTMLElement }) {
      this.element = options.element;
      hostInstances.push(this);
    }
  },
}));

vi.mock('../runtime/V2EditingController.js', () => ({
  V2EditingController: class V2EditingControllerMock {
    on = vi.fn(() => vi.fn());
    close = vi.fn().mockResolvedValue(undefined);

    constructor() {
      controllerInstances.push(this);
    }
  },
}));

vi.mock('../editing/V2EditingSession.js', () => ({
  V2EditingSession: class V2EditingSessionMock {
    attach = vi.fn();
    refresh = vi.fn();
    destroy = vi.fn();

    constructor(public options: Record<string, unknown>) {
      sessionInstances.push(this);
    }
  },
}));

describe('V2StaticRenderer', () => {
  beforeEach(() => {
    hostInstances.length = 0;
    controllerInstances.length = 0;
    sessionInstances.length = 0;
  });

  it('binds the editing controller and native editing session in editable mode', async () => {
    const wrapper = mount(V2StaticRenderer, {
      props: {
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
    expect(hostInstances[0].bindEditingController).toHaveBeenCalledWith(controllerInstances[0]);
    expect(sessionInstances[0].attach).toHaveBeenCalledTimes(1);
    expect(sessionInstances[0].refresh).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('renderer-ready')).toHaveLength(1);

    wrapper.unmount();

    expect(sessionInstances[0].destroy).toHaveBeenCalledTimes(1);
    expect(controllerInstances[0].close).toHaveBeenCalledTimes(1);
    expect(hostInstances[0].destroy).toHaveBeenCalledTimes(1);
  });
});
