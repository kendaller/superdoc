import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRuntime } from '@superdoc/v2-model';
import V2StreamingRenderer from './V2StreamingRenderer.vue';

function createRuntimeStub(overrides?: Partial<DocumentRuntime>): DocumentRuntime {
  return {
    openSource: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    ready: vi.fn().mockResolvedValue(undefined),
    getRenderShell: vi.fn().mockResolvedValue(undefined),
    projectWindow: vi.fn(),
    projectNextWindow: vi.fn(),
    prefetchWindow: vi.fn().mockResolvedValue(undefined),
    advanceStructure: vi.fn().mockResolvedValue(undefined),
    enrich: vi.fn().mockResolvedValue(undefined),
    cancelTask: vi.fn(),
    status: vi.fn().mockResolvedValue({ stage: 'fast-open' }),
    save: vi.fn().mockResolvedValue(new Uint8Array()),
    on: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

describe('V2StreamingRenderer', () => {
  it('emits renderer-error and suppresses renderer-ready when initialization fails', async () => {
    const runtime = createRuntimeStub({
      openSource: vi.fn().mockRejectedValue(new Error('open failed')),
    });

    const wrapper = mount(V2StreamingRenderer, {
      props: {
        runtime,
        fileSource: new Uint8Array([1, 2, 3]),
      },
    });

    await flushPromises();

    const readyEvents = wrapper.emitted('renderer-ready');
    const errorEvents = wrapper.emitted('renderer-error');

    expect(readyEvents).toBeUndefined();
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents?.[0]?.[0]).toMatchObject({
      error: expect.objectContaining({
        message: 'open failed',
      }),
    });

    wrapper.unmount();
  });
});
