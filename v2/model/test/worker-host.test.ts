// ---------------------------------------------------------------------------
// Tests for worker save restriction (Task #14)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { installWorkerHost } from "../src/runtime/worker-host.js";
import { createMinimalDocx } from "./helpers/create-test-docx.js";

describe("worker save restriction", () => {
  it("worker host forces save target to bytes", async () => {
    let sentResponse: { id: string; ok: boolean; result: unknown } | undefined;

    const fakeScope = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage(data: unknown) {
        sentResponse = data as typeof sentResponse;
      },
    };

    installWorkerHost(fakeScope);

    // Send open
    const bytes = createMinimalDocx();
    fakeScope.onmessage!(new MessageEvent("message", {
      data: { id: "1", method: "open", params: { bytes } },
    }));

    // Wait for async response
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(sentResponse?.ok).toBe(true);

    // Send save with blob target — host should override to bytes
    fakeScope.onmessage!(new MessageEvent("message", {
      data: { id: "2", method: "save", params: { options: { target: "blob" } } },
    }));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(sentResponse?.ok).toBe(true);
    // Result should be Uint8Array, not Blob (host forces bytes)
    expect(sentResponse?.result).toBeInstanceOf(Uint8Array);
  });
});
