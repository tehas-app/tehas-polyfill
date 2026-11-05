// Fixture: extension/src/headless/capabilities.ts at pi-rukas v0.14.0. The block is an
// excerpt - a subset of the tag's real entries, every one of them checked against the
// tag by scripts/test/fixtures.test.ts. This release does not declare the polyfilled
// feature, so the polyfill is still the thing that runs.

export const HEADLESS_FEATURES = {
  /** #1189 — the result is taken from the driver's in-memory state, not the state file. */
  resultFromMemory: true,
  /** #1238 — a cycle that hits its deadline parks with a handoff (not a kill). */
  cycleDeadline: true,
  /** #1367 — the result's `failure` gives the reason behind its `cap` as stable fields. */
  failureReason: true,
  /** #1468 — `work --continue-pr` continues the issue's open PR; the result's `continuedPr`. */
  continuePr: true,
  /** #1471 — `plan --start` / `--resume`: a planning session, one turn per run, filed only on a confirm. */
  planTurns: true,
} as const;
