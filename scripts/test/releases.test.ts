import { expect, test } from "bun:test";
import { probeReleases, releaseTags } from "../lib/releases";
import type { PolyfillRecord } from "../lib/types";

// scripts/lib/types.ts (T8) declares PolyfillRecord; these tests build their own
// records so the probe's core is testable without the tracking state layer.
function pkg(o: Partial<PolyfillRecord> & { name: string }): PolyfillRecord {
  return {
    name: o.name,
    state: o.state ?? "active",
    from: o.from ?? "v0.14.0",
    upstreamIssue: o.upstreamIssue ?? "trail-openers/pi-rukas#2020",
    upstreamFeature: o.upstreamFeature ?? "issueComments",
    pr: o.pr ?? null,
    until: o.until ?? null,
    path: o.path ?? `packages/${o.name}/polyfill.json`,
  };
}

const activeIssueComments = pkg({ name: "issue-comments" });

test("test_release_tags_plan_example", () => {
  const tags = ["v0.13.9", "v0.14.0", "v0.14.9", "v0.14.10", "v1.0.0"];
  expect(releaseTags("v0.14.0", tags, 3)).toEqual(["v1.0.0", "v0.14.10", "v0.14.0"]);
});

test("test_release_tags_nothing_at_or_after_from", () => {
  expect(releaseTags("v0.14.0", ["v0.13.9"], 12)).toEqual([]);
});

test("test_version_order_not_string_order", () => {
  // String order would rank v0.14.9 above v0.14.10.
  const tags = ["v0.14.9", "v0.14.10", "v0.14.0", "v0.9.0"];
  expect(releaseTags("v0.14.0", tags, 3)).toEqual(["v0.14.10", "v0.14.9", "v0.14.0"]);
  expect(releaseTags("v0.14.0", ["v0.14.0", "v1.0.0", "v0.14.50"], 2)).toEqual([
    "v1.0.0",
    "v0.14.0",
  ]);
});

test("test_from_always_included", () => {
  const tags = ["v0.14.0", "v0.14.1", "v0.14.2", "v0.14.3"];
  expect(releaseTags("v0.14.0", tags, 3)).toEqual(["v0.14.3", "v0.14.2", "v0.14.0"]);
  // from inside the newest window is not duplicated.
  expect(releaseTags("v0.14.10", ["v0.14.10", "v0.15.0", "v0.16.0"], 3)).toEqual([
    "v0.16.0",
    "v0.15.0",
    "v0.14.10",
  ]);
  // max 1 leaves only from.
  expect(releaseTags("v0.14.0", ["v0.14.0", "v0.14.50"], 1)).toEqual(["v0.14.0"]);
});

test("test_from_missing_upstream_is_not_invented", () => {
  // from is only probed when it is an actual release tag.
  expect(releaseTags("v0.14.0", ["v0.14.5", "v0.14.6"], 3)).toEqual(["v0.14.6", "v0.14.5"]);
});

test("test_non_release_tag_names_ignored", () => {
  const tags = ["v0.14.0", "v0.14.1-rc1", "v1.0", "release-2026", "latest", ""];
  expect(releaseTags("v0.14.0", tags, 12)).toEqual(["v0.14.0"]);
});

test("test_tags_newest_first", () => {
  const tags = ["v0.14.0", "v0.14.50", "v1.0.0", "v0.14.9"];
  expect(releaseTags("v0.14.0", tags, 12)).toEqual(["v1.0.0", "v0.14.50", "v0.14.9", "v0.14.0"]);
});

// The capabilities source the probe is handed: the file pi-rukas builds
// `--capabilities` from, read at a release tag.
const CAPS_LISTS = `export const HEADLESS_FEATURES = {
  /** #1189 — the result is taken from the driver's in-memory state. */
  resultFromMemory: true,
  /** #2020 — the host's comments blob reaches each child session. */
  issueComments: true,
} as const;`;

const CAPS_OMITS = `export const HEADLESS_FEATURES = {
  resultFromMemory: true,
  planTurns: true,
} as const;`;

const CAPS_FALSE = `export const HEADLESS_FEATURES = { issueComments: false } as const;`;

const CAPS_NO_DECLARATION = `export const CAPABILITIES_VERSION = 2 as const;`;

const CAPS_PROSE = `// the changelog says issueComments: true, which is not a declaration
export const HEADLESS_FEATURES = { planTurns: true } as const;`;

const CAPS_NON_BOOLEAN = `export const HEADLESS_FEATURES = { issueComments: FEATURE_FLAG } as const;`;

test("test_native_and_active_is_a_failure", () => {
  expect(probeReleases([activeIssueComments], { "v0.14.0": CAPS_LISTS })).toEqual([
    {
      tag: "v0.14.0",
      package: "issue-comments",
      state: "active",
      lists: true,
      fail: true,
    },
  ]);
});

test("test_merged_state_is_also_a_failure", () => {
  // PROCESS.md step 5: a merged polyfill is skipped once the feature is native.
  const rows = probeReleases([pkg({ name: "issue-comments", state: "merged" })], { "v0.15.0": CAPS_LISTS });
  expect(rows).toEqual([
    { tag: "v0.15.0", package: "issue-comments", state: "merged", lists: true, fail: true },
  ]);
});

test("test_released_state_is_silent", () => {
  const rows = probeReleases([pkg({ name: "issue-comments", state: "released", until: "v0.15.0" })], {
    "v0.15.0": CAPS_LISTS,
  });
  expect(rows).toEqual([
    {
      tag: "v0.15.0",
      package: "issue-comments",
      state: "released",
      lists: true,
      fail: false,
    },
  ]);
});

test("test_missing_features_object", () => {
  // No HEADLESS_FEATURES at all, and a declaration that says false: neither lists it.
  const none = probeReleases([activeIssueComments], { "v0.14.0": CAPS_NO_DECLARATION });
  expect(none).toEqual([
    { tag: "v0.14.0", package: "issue-comments", state: "active", lists: false, fail: false },
  ]);
  const off = probeReleases([activeIssueComments], { "v0.14.0": CAPS_FALSE });
  expect(off[0]?.lists).toBe(false);
  expect(off[0]?.fail).toBe(false);
  const empty = probeReleases([activeIssueComments], { "v0.14.0": "" });
  expect(empty[0]?.lists).toBe(false);
});

test("test_comment_prose_is_not_a_declaration", () => {
  // A changelog that names the feature is not a capabilities declaration.
  const rows = probeReleases([activeIssueComments], { "v0.14.0": CAPS_PROSE });
  expect(rows[0]?.lists).toBe(false);
  expect(rows[0]?.fail).toBe(false);
});

test("test_non_boolean_entry_is_not_a_listing", () => {
  const rows = probeReleases([activeIssueComments], { "v0.14.0": CAPS_NON_BOOLEAN });
  expect(rows[0]?.lists).toBe(false);
  expect(rows[0]?.fail).toBe(false);
});

test("test_feature_flag_comes_from_upstream_feature", () => {
  const rows = probeReleases([pkg({ name: "ensemble-limits", upstreamFeature: "ensemble" })], {
    "v0.14.0": CAPS_LISTS,
  });
  expect(rows[0]?.lists).toBe(false);
  expect(rows[0]?.fail).toBe(false);
});

test("test_absent_feature_is_silent", () => {
  const rows = probeReleases([activeIssueComments], { "v0.14.0": CAPS_OMITS });
  expect(rows[0]?.lists).toBe(false);
  expect(rows[0]?.fail).toBe(false);
});

test("test_one_row_per_package_and_release", () => {
  const docs = { "v0.14.0": CAPS_OMITS, "v0.14.50": CAPS_LISTS };
  const rows = probeReleases([activeIssueComments, pkg({ name: "other" })], docs);
  expect(rows.length).toBe(4);
  expect(rows.map((r) => `${r.package}@${r.tag}:${r.fail}`)).toEqual([
    "issue-comments@v0.14.0:false",
    "issue-comments@v0.14.50:true",
    "other@v0.14.0:false",
    "other@v0.14.50:true",
  ]);
});

test("test_no_packages_no_rows", () => {
  expect(probeReleases([], { "v0.14.0": CAPS_LISTS })).toEqual([]);
});
