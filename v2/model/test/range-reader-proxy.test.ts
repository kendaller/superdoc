// ---------------------------------------------------------------------------
// Range-reader proxy tests (MessagePort-based bridge)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createPortBackedReader,
  installRangeReaderHost,
  closePortBackedReader,
} from '../src/runtime/range-reader-proxy.js';

describe('range-reader proxy', () => {
  it('reads bytes through the MessagePort bridge', async () => {
    const fullBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Simulate a real range reader
    const realReader = {
      read(opts: { start: number; endExclusive: number }): Promise<Uint8Array> {
        return Promise.resolve(fullBytes.slice(opts.start, opts.endExclusive));
      },
    };

    const channel = new MessageChannel();
    const cleanup = installRangeReaderHost(channel.port1, realReader);

    const reader = createPortBackedReader(channel.port2, fullBytes.length);
    expect(reader.size).toBe(10);

    const chunk1 = await reader.read(0, 4);
    expect(Array.from(chunk1)).toEqual([0, 1, 2, 3]);

    const chunk2 = await reader.read(5, 8);
    expect(Array.from(chunk2)).toEqual([5, 6, 7]);

    cleanup();
  });

  it('handles multiple concurrent reads', async () => {
    const fullBytes = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) fullBytes[i] = i % 256;

    const realReader = {
      read(opts: { start: number; endExclusive: number }): Promise<Uint8Array> {
        return Promise.resolve(fullBytes.slice(opts.start, opts.endExclusive));
      },
    };

    const channel = new MessageChannel();
    const cleanup = installRangeReaderHost(channel.port1, realReader);
    const reader = createPortBackedReader(channel.port2, 1000);

    const [a, b, c] = await Promise.all([reader.read(0, 10), reader.read(100, 110), reader.read(500, 510)]);

    expect(Array.from(a)).toEqual(Array.from(fullBytes.slice(0, 10)));
    expect(Array.from(b)).toEqual(Array.from(fullBytes.slice(100, 110)));
    expect(Array.from(c)).toEqual(Array.from(fullBytes.slice(500, 510)));

    cleanup();
  });

  it('propagates errors from the real reader', async () => {
    const realReader = {
      read(_opts: { start: number; endExclusive: number }): Promise<Uint8Array> {
        return Promise.reject(new Error('disk read failed'));
      },
    };

    const channel = new MessageChannel();
    const cleanup = installRangeReaderHost(channel.port1, realReader);
    const reader = createPortBackedReader(channel.port2, 100);

    await expect(reader.read(0, 10)).rejects.toThrow('disk read failed');

    cleanup();
  });

  it('closePortBackedReader cleans up the port', () => {
    const channel = new MessageChannel();
    // Just verify it doesn't throw
    closePortBackedReader(channel.port2);
  });

  it('rejects pending reads when the reader is closed', async () => {
    const channel = new MessageChannel();
    const reader = createPortBackedReader(channel.port2, 100);

    const pendingRead = reader.read(0, 10);
    closePortBackedReader(channel.port2);

    await expect(pendingRead).rejects.toThrow('Port-backed reader closed');
  });
});
