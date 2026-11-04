// Fixture: extension/src/headless/capabilities.ts at pi-rukas v0.14.50. The block is an
// excerpt - a subset of the tag's real entries, every one of them checked against the
// tag by scripts/test/fixtures.test.ts - plus one synthetic entry, marked below.

export const HEADLESS_FEATURES = {
  /** #1189 — the result is taken from the driver's in-memory state, not the state file. */
  resultFromMemory: true,
  /** #1238 — a cycle that hits its deadline parks with a handoff (not a kill). */
  cycleDeadline: true,
  /** #1367 — the result's `failure` gives the reason behind its `cap` as stable fields. */
  failureReason: true,
  /** #1471 — `plan --start` / `--resume`: a planning session, one turn per run, filed only on a confirm. */
  planTurns: true,
  /**
   * #1743 — a park is remembered per (issue, cap) whether or not a comment was
   * ever posted; a THIRD identical start is refused before any step runs.
   */
  repeatParkGuard: true,
  /**
   * #1883 — `work-lean <issue>` runs the lean engine's phase-1 pipeline once
   * and exits with the code its own step log stamped.
   */
  workLeanVerb: true,
  /**
   * SYNTHETIC - hand-added, not an entry of the real v0.14.50 file. No pi-rukas tag
   * declares issueComments yet, so this is the shape pi-rukas#2020 takes when it
   * lands: the release the probe must fail on while polyfill.json still says active.
   */
  issueComments: true,
} as const;
