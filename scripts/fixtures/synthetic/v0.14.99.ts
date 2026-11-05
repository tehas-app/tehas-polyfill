// SYNTHETIC fixture - not an upstream snapshot and never checked against upstream. No
// pi-rukas tag declares issueComments yet, so this hand-written release is the shape
// pi-rukas#2020 takes when it lands: the release the capability probe must fail on
// while packages/issue-comments/polyfill.json still says active.
//
// scripts/fixtures/capabilities holds the real snapshots the per-PR CI probe reads, and
// none of them may declare this feature. This directory exists so the failing case has
// a file of its own.

export const HEADLESS_FEATURES = {
  /** SYNTHETIC - the polyfilled feature, declared as pi-rukas#2020 would declare it. */
  issueComments: true,
} as const;
