// ---------------------------------------------------------------------------
// Git info detection for benchmark artifacts.
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import type { GitInfo } from "@superdoc/v2-perf";

/** Detect current git state for benchmark traceability. */
export function detectGitInfo(): GitInfo {
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf-8" }).trim().length > 0;

    return { sha, branch, dirty };
  } catch {
    return { sha: "unknown", branch: "unknown", dirty: true };
  }
}
