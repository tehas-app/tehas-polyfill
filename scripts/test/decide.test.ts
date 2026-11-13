// Tests for the tracking decision: spec S7 (what the workflow does for each upstream state) and
// PROCESS.md step 6. Titles are matched exactly, because idempotence is by title.

import { expect, test } from "bun:test";
import { containsCommit, decidePackage, upstreamSignal } from "../lib/decide";
import type { OpenTitles, PolyfillRecord, TrackAction, UpstreamState } from "../lib/types";

const base: PolyfillRecord = {
  name: "issue-comments",
  state: "active",
  from: "v0.14.0",
  upstreamIssue: "trail-openers/pi-rukas#2020",
  upstreamFeature: "issueComments",
  pr: null,
  until: null,
  path: "packages/issue-comments/polyfill.json",
};

const activePkg: PolyfillRecord = base;
const mergedPkg: PolyfillRecord = { ...base, state: "merged", pr: 2100 };
const mergedWithUntil: PolyfillRecord = { ...mergedPkg, until: "v0.15.0" };
const releasedPkg: PolyfillRecord = { ...mergedPkg, state: "released", until: "v0.15.0" };
const declinedPkg: PolyfillRecord = { ...base, state: "declined" };

const closedWithMerge: UpstreamState = { state: "closed", mergedPr: { number: 2100, mergeCommit: "abc123" }, labels: [] };
const closedWithoutMerge: UpstreamState = { state: "closed", mergedPr: null, labels: [] };
const openUpstream: UpstreamState = { state: "open", mergedPr: null, labels: [] };
/** trail-openers/pi-rukas#1239 as it reads today: open, `frozen`, no pull request. */
const frozenUpstream: UpstreamState = { state: "open", mergedPr: null, labels: ["frozen"] };
const nothingOpen: OpenTitles = { prs: [], issues: [] };

function kinds(actions: TrackAction[]): string[] {
  return actions.map((action) => action.kind);
}

test("open_upstream_does_nothing: an open issue that is not overdue files nothing", () => {
  expect(decidePackage(activePkg, openUpstream, [], 30, nothingOpen)).toEqual([]);
});

test("frozen_upstream_files_nothing: an open issue labelled frozen is a parked proposal", () => {
  // trail-openers/pi-rukas#1239: open, labelled `frozen`, no linked pull request, its own body says
  // nothing works on it until a person labels it. To the tracker it must not read as work in flight.
  expect(decidePackage(activePkg, frozenUpstream, [], 90, nothingOpen)).toEqual([]);
  // Not even the reminder, and not for a merged record either: nothing is filed about the polyfill.
  expect(decidePackage(activePkg, frozenUpstream, [], 60, nothingOpen)).toEqual([]);
  expect(decidePackage(mergedPkg, frozenUpstream, [], 90, nothingOpen)).toEqual([]);
});

test("a not-taken-on reading is not permanent: the same record is tracked again without the label", () => {
  // Both directions come from recomputing every run, so a wrong reading lasts one run. Upstream
  // un-freezes the issue (or a person adds any other label) and the next run reminds again.
  expect(decidePackage(activePkg, frozenUpstream, [], 90, nothingOpen)).toEqual([]);
  const actions = decidePackage(activePkg, openUpstream, [], 90, nothingOpen);
  expect(actions.map((action) => action.kind)).toEqual(["issue-reminder"]);
});

test("an issue that gains the frozen label stops being tracked on the next run", () => {
  const before = decidePackage(activePkg, openUpstream, [], 90, nothingOpen);
  expect(before.map((action) => action.kind)).toEqual(["issue-reminder"]);
  expect(decidePackage(activePkg, frozenUpstream, [], 90, nothingOpen)).toEqual([]);
});

test("a label that is not on the not-taken-on list still counts as taken on", () => {
  // Only an explicit parked label suppresses tracking: `wontfix` is an open refusal, which is a
  // second rule this tracker does not apply, and any other label carries no decision here.
  for (const labels of [["wontfix"], ["bug"], ["enhancement", "needs-repro"]]) {
    const actions = decidePackage(activePkg, { state: "open", mergedPr: null, labels }, [], 90, nothingOpen);
    expect(actions.map((action) => action.kind)).toEqual(["issue-reminder"]);
  }
});

test("the frozen label is matched case-insensitively", () => {
  expect(decidePackage(activePkg, { state: "open", mergedPr: null, labels: ["Frozen"] }, [], 90, nothingOpen)).toEqual([]);
});

test("a merged pull request outranks the frozen label", () => {
  // A merged PR is itself proof upstream took the work on, so the gate sits only on the open branch:
  // a frozen-labelled issue whose PR merged still walks merged, then released and retired.
  expect(decidePackage(activePkg, { state: "closed", mergedPr: { number: 2100, mergeCommit: "abc123" }, labels: ["frozen"] }, [], 10, nothingOpen).map((a) => a.kind)).toEqual(["pr-merged"]);
  expect(decidePackage(mergedPkg, { state: "closed", mergedPr: { number: 2100, mergeCommit: "abc123" }, labels: ["frozen"] }, ["v0.15.0"], 40, nothingOpen).map((a) => a.kind)).toEqual(["pr-released", "issue-retire"]);
  // Closed without a merge is still a decline, whatever labels it carries.
  expect(decidePackage(activePkg, { state: "closed", mergedPr: null, labels: ["frozen"] }, [], 10, nothingOpen).map((a) => a.kind)).toEqual(["pr-declined", "issue-decide"]);
});

test("upstreamSignal names the upstream signal a no-action decision read", () => {
  // So a reader can tell "open and taken on, not overdue" from "open and parked" without a filed issue.
  expect(upstreamSignal(openUpstream)).toBe("open and taken on");
  expect(upstreamSignal(frozenUpstream)).toContain("open and not taken on");
  expect(upstreamSignal(frozenUpstream)).toContain("frozen");
  expect(upstreamSignal({ state: "open", mergedPr: null, labels: ["Frozen", "wontfix"] })).toContain("frozen");
  expect(upstreamSignal({ state: "open", mergedPr: null, labels: ["wontfix"] })).toBe("open and taken on");
  expect(upstreamSignal(closedWithMerge)).toContain("merged pull request");
  expect(upstreamSignal(closedWithoutMerge)).toContain("closed without a merge");
});

test("active plus a merged upstream PR opens the merged PR here", () => {
  const actions = decidePackage(activePkg, closedWithMerge, [], 10, nothingOpen);
  expect(actions.length).toBe(1);
  expect(actions[0]).toEqual({
    kind: "pr-merged",
    title: "issue-comments: upstream merged (pi-rukas#2020)",
    body: expect.any(String),
    patch: { state: "merged", pr: 2100 },
  });
  expect(actions[0]!.body).toContain("pi-rukas#2100");
  expect(actions[0]!.body).toContain("abc123");
  expect(actions[0]!.body.length).toBeGreaterThan(0);
});

test("merged plus a release that contains the commit goes released, and files the retirement issue", () => {
  const actions = decidePackage(mergedPkg, closedWithMerge, ["v0.15.0"], 40, nothingOpen);
  expect(kinds(actions)).toEqual(["pr-released", "issue-retire"]);
  expect(actions[0]!.patch).toEqual({ state: "released", until: "v0.15.0" });
  expect(actions[1]!.title).toBe("Retire polyfill issue-comments: pi-rukas v0.15.0 ships trail-openers/pi-rukas#2020");
  expect(actions[1]!.body).toContain("v0.15.0");
});

test("the retirement body names what a pin-less host can read, and files no pin instruction", () => {
  const actions = decidePackage(mergedPkg, closedWithMerge, ["v0.15.0"], 40, nothingOpen);
  expect(kinds(actions)).toEqual(["pr-released", "issue-retire"]);
  const body = actions[1]!.body;
  // tehas keeps no version pin and writes no tehas.rukas.polyfills label (it only reads one), so the checkable fact is the base image's capabilities answer,
  // which is what tehas scripts/polyfills.sh decides expiry from.
  expect(body).toContain("/opt/pi-rukas/bin/pi-rukas-headless --capabilities");
  expect(body).toContain("issueComments");
  expect(body).toContain("v0.15.0");
  // The half of the sentence this repository owns, and nothing else in the suite pins it.
  expect(body).toContain("Then delete packages/issue-comments/ here");
  // Asserted as an instruction, not as a word: an honest sentence may contain "pin" to say tehas
  // keeps none, and a guard that forbids the word gets edited the first time someone writes it.
  expect(body).not.toContain("pi-rukas pin");
  expect(body).not.toContain("TEHAS_POLYFILL_VERSION");
  expect(body).not.toMatch(/pin to .* or later/);
});

test("the oldest containing release becomes until", () => {
  const actions = decidePackage(mergedPkg, closedWithMerge, ["v0.15.0", "v0.16.0"], 40, nothingOpen);
  expect(actions[0]!.patch).toEqual({ state: "released", until: "v0.15.0" });
});

test("merged_needs_a_release_to_go_released", () => {
  expect(decidePackage(mergedPkg, closedWithMerge, [], 40, nothingOpen)).toEqual([]);
  // A merged record that already carries an until is done waiting.
  expect(decidePackage(mergedWithUntil, closedWithMerge, ["v0.15.0"], 40, nothingOpen)).toEqual([]);
});

test("declined_when_closed_without_merge: the PR here and the decision issue on tehas", () => {
  const actions = decidePackage(activePkg, closedWithoutMerge, [], 10, nothingOpen);
  expect(kinds(actions)).toEqual(["pr-declined", "issue-decide"]);
  expect(actions[0]!.patch).toEqual({ state: "declined" });
  expect(actions[0]!.title).toContain("issue-comments");
  expect(actions[1]!.title).toContain("issue-comments");
  expect(actions[1]!.title).toContain("trail-openers/pi-rukas#2020");
});

test("a record that is already retired is left alone", () => {
  expect(decidePackage(releasedPkg, closedWithMerge, ["v0.15.0"], 40, nothingOpen)).toEqual([]);
  expect(decidePackage(declinedPkg, closedWithoutMerge, [], 40, nothingOpen)).toEqual([]);
  expect(decidePackage(releasedPkg, openUpstream, [], 90, nothingOpen)).toEqual([]);
  expect(decidePackage(declinedPkg, openUpstream, [], 90, nothingOpen)).toEqual([]);
});

test("an active package past 60 days gets one reminder issue", () => {
  expect(decidePackage(activePkg, openUpstream, [], 59, nothingOpen)).toEqual([]);
  const actions = decidePackage(activePkg, openUpstream, [], 90, nothingOpen);
  expect(actions.length).toBe(1);
  expect(actions[0]!.kind).toBe("issue-reminder");
  // The age is in the body, never in the title: an age in the title changes daily, and a title
  // that changes daily is never already open, so a new issue would be filed every day.
  expect(actions[0]!.title).toBe("Polyfill issue-comments is still active");
  expect(actions[0]!.body).toContain("active for 90 days");
  expect(actions[0]!.patch).toBeUndefined();
});

test("test_reminder_title_does_not_age: the same title tomorrow, so the open one suppresses it", () => {
  const today = decidePackage(activePkg, openUpstream, [], 61, nothingOpen);
  const nextWeek = decidePackage(activePkg, openUpstream, [], 68, nothingOpen);
  expect(today.map((a) => a.title)).toEqual(nextWeek.map((a) => a.title));
  expect(today[0]!.title).not.toContain("61");
  expect(today[0]!.title).not.toMatch(/\d/);

  // The body still says how old it is, and the second run sees the first one open.
  expect(today[0]!.body).toContain("61 days");
  expect(nextWeek[0]!.body).toContain("68 days");
  expect(decidePackage(activePkg, openUpstream, [], 68, { prs: [], issues: [today[0]!.title] })).toEqual([]);
});

test("reminder_once: an open reminder title files nothing", () => {
  const open: OpenTitles = { prs: [], issues: ["Polyfill issue-comments is still active"] };
  expect(decidePackage(activePkg, openUpstream, [], 90, open)).toEqual([]);
});

test("reminder_only_for_active: a merged package is not reminded", () => {
  expect(decidePackage(mergedPkg, openUpstream, [], 90, nothingOpen)).toEqual([]);
});

test("released_wins_over_reminder: a release in the same run replaces the reminder", () => {
  const actions = decidePackage(mergedPkg, closedWithMerge, ["v0.15.0"], 90, nothingOpen);
  expect(kinds(actions)).toEqual(["pr-released", "issue-retire"]);
});

test("an open PR or issue with the same title files nothing", () => {
  const merged = decidePackage(activePkg, closedWithMerge, [], 10, {
    prs: ["issue-comments: upstream merged (pi-rukas#2020)"],
    issues: [],
  });
  expect(merged).toEqual([]);

  const released = decidePackage(mergedPkg, closedWithMerge, ["v0.15.0"], 40, {
    prs: [],
    issues: ["Retire polyfill issue-comments: pi-rukas v0.15.0 ships trail-openers/pi-rukas#2020"],
  });
  expect(kinds(released)).toEqual(["pr-released"]);
});

test("an active package whose release is already out still goes merged first", () => {
  const actions = decidePackage(activePkg, closedWithMerge, ["v0.15.0"], 10, nothingOpen);
  expect(kinds(actions)).toEqual(["pr-merged"]);
});

test("containsCommit reads the gh compare status", () => {
  expect(containsCommit("behind")).toBe(true);
  expect(containsCommit("identical")).toBe(true);
  expect(containsCommit("ahead")).toBe(false);
  expect(containsCommit("diverged")).toBe(false);
  expect(containsCommit("")).toBe(false);
});
