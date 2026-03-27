// ---------------------------------------------------------------------------
// Monotonic session-local revision tracker
// ---------------------------------------------------------------------------

let revisionCounter = 0;

/** Generate the next revision string (e.g. "r0", "r1", "r2"). */
export function nextRevision(): string {
  return `r${revisionCounter++}`;
}

/** Reset the revision counter (for testing). */
export function resetRevisionCounter(): void {
  revisionCounter = 0;
}
