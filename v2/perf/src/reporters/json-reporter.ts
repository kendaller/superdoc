// ---------------------------------------------------------------------------
// JSON reporter — writes benchmark artifacts to disk as stable JSON files.
// ---------------------------------------------------------------------------

import type { BenchmarkArtifact } from "../artifact.js";

/** Generate a deterministic filename for a benchmark artifact. */
export function artifactFilename(artifact: BenchmarkArtifact): string {
  const docId = artifact.document.id;
  const mode = artifact.mode;
  const date = artifact.timestamp.split("T")[0];
  const sha = artifact.git.sha.slice(0, 8);
  const cache = artifact.warmCache ? "warm" : "cold";
  return `${date}_${docId}_${mode}_${cache}_${sha}.json`;
}

/** Serialize an artifact to stable, deterministic JSON (sorted keys). */
export function serializeArtifact(artifact: BenchmarkArtifact): string {
  return JSON.stringify(artifact, sortedReplacer, 2);
}

/** Parse a serialized artifact back into a typed object. */
export function deserializeArtifact(json: string): BenchmarkArtifact {
  const parsed = JSON.parse(json);
  if (parsed.version !== 1) {
    throw new Error(`Unsupported artifact version: ${parsed.version}`);
  }
  return parsed as BenchmarkArtifact;
}

/** Serialize a batch of artifacts to a single JSON array. */
export function serializeBatch(artifacts: readonly BenchmarkArtifact[]): string {
  return JSON.stringify(artifacts, sortedReplacer, 2);
}

// ---- Helpers ---------------------------------------------------------------

/**
 * JSON replacer that sorts object keys for deterministic output.
 * This ensures that two artifacts with the same data produce identical JSON.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
