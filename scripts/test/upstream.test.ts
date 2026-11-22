import { expect, test } from "bun:test";
import { closingCommit, commitPullsArgs, issueEventsArgs, mergedPullOf } from "../lib/forge";

// An issue closed by `Closes #n` in a pull request: its `closed` event names the merge commit,
// and the commit's pulls name the merged pull request. The shape of pi-rukas#2020, closed by
// the merge of #2469 (2026-11-21).
const SHA = "457d7e3bd74f3c46cc3daf708db0b7e8bae43028";

test("test_the_last_close_names_the_closing_commit", () => {
  const events = [
    [
      { event: "labeled" },
      { event: "cross-referenced" },
      { event: "closed", commit_id: SHA },
    ],
  ];
  expect(closingCommit(events)).toBe(SHA);
  // One flat page reads the same.
  expect(closingCommit(events[0])).toBe(SHA);
});

test("test_a_close_by_hand_or_a_reopen_names_no_commit", () => {
  expect(closingCommit([[{ event: "closed", commit_id: null }]])).toBeNull();
  expect(closingCommit([[{ event: "closed", commit_id: SHA }, { event: "reopened" }]])).toBeNull();
  expect(closingCommit([[{ event: "closed", commit_id: SHA }], [{ event: "reopened" }, { event: "closed", commit_id: null }]])).toBeNull();
  expect(closingCommit("not a list")).toBeNull();
});

test("test_the_merged_pull_request_of_the_closing_commit", () => {
  const pulls = [
    { number: 2400, merged_at: null, merge_commit_sha: SHA },
    { number: 2469, merged_at: "2026-11-21T22:49:59Z", merge_commit_sha: SHA },
  ];
  expect(mergedPullOf(pulls, SHA)).toEqual({ number: 2469, mergeCommit: SHA });
  // A commit no merged pull request made: closed without a merge.
  expect(mergedPullOf([{ number: 1, merged_at: "2026-11-21T00:00:00Z", merge_commit_sha: "other" }], SHA)).toBeNull();
  expect(mergedPullOf([], SHA)).toBeNull();
});

test("test_the_reads_are_plain_gh_api_calls", () => {
  expect(issueEventsArgs("trail-openers/pi-rukas", "trail-openers/pi-rukas#2020")).toEqual([
    "api",
    "--paginate",
    "--slurp",
    "repos/trail-openers/pi-rukas/issues/2020/events?per_page=100",
  ]);
  expect(commitPullsArgs("trail-openers/pi-rukas", SHA)).toEqual(["api", `repos/trail-openers/pi-rukas/commits/${SHA}/pulls`]);
});
