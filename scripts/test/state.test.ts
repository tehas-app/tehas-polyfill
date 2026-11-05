// Tests for the tracker's state and idempotence helpers: spec S7 (what the workflow may read)
// and S9 (the shape of a polyfill record).

import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alreadyOpen, applyPatch, firstCommitAgeDays, readPackages, trackedPackages } from "../lib/state";

const ROOT = join(import.meta.dir, "..", "..");
const REAL_POLYFILL = join(ROOT, "packages", "issue-comments", "polyfill.json");

const madeDirs: string[] = [];

function newRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "track-state-"));
  madeDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of madeDirs.splice(0, madeDirs.length)) rmSync(dir, { recursive: true, force: true });
});

function writePolyfill(root: string, dirName: string, body: string | Record<string, unknown>): string {
  const dir = join(root, "packages", dirName);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "polyfill.json");
  writeFileSync(path, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  return path;
}

function polyfillOf(name: string, state: string): Record<string, unknown> {
  return {
    name,
    upstream: { issue: "trail-openers/pi-rukas#2020", feature: name },
    from: "v0.14.0",
    state,
    pr: null,
    until: null,
  };
}

function stderrLines(fn: () => unknown): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", ["-c", "user.email=track@example.com", "-c", "user.name=track", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...env },
  });
}

/** A throwaway git repository with one commit touching `packages/issue-comments/polyfill.json`. */
function gitRepoWithCommit(at: string): string {
  const repo = newRoot();
  git(repo, ["init", "-q", "-b", "main"]);
  writePolyfill(repo, "issue-comments", polyfillOf("issue-comments", "active"));
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "add the polyfill"], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  return repo;
}

test("readPackages reads the polyfill records this repository ships", () => {
  const packages = readPackages(ROOT);
  expect(packages).toContainEqual({
    name: "issue-comments",
    state: "active",
    from: "v0.14.0",
    upstreamIssue: "trail-openers/pi-rukas#2020",
    upstreamFeature: "issueComments",
    pr: null,
    until: null,
    path: "packages/issue-comments/polyfill.json",
  });
});

test("unreadable_polyfill_json: one stderr line naming the file, no throw, no package", () => {
  const root = newRoot();
  writePolyfill(root, "broken", "{not json");
  writePolyfill(root, "good", polyfillOf("good", "active"));
  mkdirSync(join(root, "packages", "manifestIsDir", "polyfill.json"), { recursive: true });
  writePolyfill(root, "noUpstream", { name: "noUpstream", from: "v0.14.0", state: "active" });

  let packages: ReturnType<typeof readPackages> | undefined;
  const lines = stderrLines(() => {
    packages = readPackages(root);
  });
  expect(packages!.map((p) => p.name)).toEqual(["good"]);
  expect(lines.length).toBe(3);
  for (const name of ["broken", "manifestIsDir", "noUpstream"]) {
    expect(lines.some((line) => line.includes(join("packages", name, "polyfill.json")))).toBe(true);
  }
});

test("an empty or missing packages directory is not an error", () => {
  const lines = stderrLines(() => {
    expect(readPackages(newRoot())).toEqual([]);
  });
  expect(lines.length).toBe(0);
});

test("states_outside_scope: only active and merged are tracked", () => {
  const root = newRoot();
  for (const state of ["active", "merged", "released", "declined", "some future state"]) {
    writePolyfill(root, state, polyfillOf(state, state));
  }
  expect(readPackages(root).length).toBe(5);
  expect(trackedPackages(root).map((p) => p.name).sort()).toEqual(["active", "merged"]);
});

test("patch_keeps_key_order_and_two_space_indent", () => {
  const original = readFileSync(REAL_POLYFILL, "utf8");
  const patched = applyPatch(original, { state: "merged", pr: 2100 });

  expect(patched.startsWith('{\n  "name": "issue-comments",\n')).toBe(true);
  expect(patched.endsWith("}\n")).toBe(true);
  expect(patched).not.toContain("\t");

  const before = JSON.parse(original) as Record<string, unknown>;
  const after = JSON.parse(patched) as Record<string, unknown>;
  expect(Object.keys(after)).toEqual(Object.keys(before));
  expect(after.state).toBe("merged");
  expect(after.pr).toBe(2100);
  expect(after.name).toBe("issue-comments");
  expect(after.until).toBeNull();
});

test("a patched key that is not in the record is added last", () => {
  const patched = applyPatch('{"name": "x", "state": "active", "pr": null}', { state: "merged", until: "v0.15.0" });
  expect(JSON.parse(patched)).toEqual({ name: "x", state: "merged", pr: null, until: "v0.15.0" });
  expect(Object.keys(JSON.parse(patched))).toEqual(["name", "state", "pr", "until"]);
});

test("a record that is not JSON is refused, not half-written", () => {
  expect(() => applyPatch("not json", { state: "merged" })).toThrow();
  expect(() => applyPatch("[1,2]", { state: "merged" })).toThrow();
});

test("a record missing name, state or from is skipped, each named by the field that is missing", () => {
  const root = newRoot();
  const upstream = { issue: "trail-openers/pi-rukas#2020", feature: "issueComments" };
  // Directory names sort, so the records warn in this order. An empty string is as missing as an
  // absent key.
  writePolyfill(root, "emptyState", { name: "emptyState", upstream, from: "v0.14.0", state: "" });
  writePolyfill(root, "noFrom", { name: "noFrom", upstream, state: "active" });
  writePolyfill(root, "noName", { upstream, from: "v0.14.0", state: "active" });
  writePolyfill(root, "noState", { name: "noState", upstream, from: "v0.14.0" });

  let packages: ReturnType<typeof readPackages> | undefined;
  const lines = stderrLines(() => {
    packages = readPackages(root);
  });
  expect(packages!.length).toBe(0);
  expect(lines).toEqual([
    "track: skipping packages/emptyState/polyfill.json: state is missing",
    "track: skipping packages/noFrom/polyfill.json: from is missing",
    "track: skipping packages/noName/polyfill.json: name is missing",
    "track: skipping packages/noState/polyfill.json: state is missing",
  ]);
});

test("the required fields are checked in order, so one record names one missing field", () => {
  const root = newRoot();
  writePolyfill(root, "bare", { upstream: { issue: "trail-openers/pi-rukas#2020", feature: "issueComments" } });

  let packages: ReturnType<typeof readPackages> | undefined;
  const lines = stderrLines(() => {
    packages = readPackages(root);
  });
  expect(packages!.length).toBe(0);
  expect(lines).toEqual(["track: skipping packages/bare/polyfill.json: name is missing"]);
});

test("alreadyOpen is an exact title match", () => {
  const title = "Retire polyfill issue-comments: pi-rukas v0.15.0 ships trail-openers/pi-rukas#2020";
  expect(alreadyOpen([title], title)).toBe(true);
  expect(alreadyOpen(["something else", title], title)).toBe(true);
  expect(alreadyOpen([], title)).toBe(false);
  expect(alreadyOpen([title.toLowerCase()], title)).toBe(false);
  expect(alreadyOpen([title.slice(0, -1)], title)).toBe(false);
});

test("age_from_first_commit: the oldest commit touching the path", () => {
  const repo = gitRepoWithCommit("2026-11-04T12:00:00 +0000");
  expect(firstCommitAgeDays(repo, "packages/issue-comments/polyfill.json", new Date("2026-12-04T12:00:00Z"))).toBe(30);

  // A later commit does not move the age.
  writePolyfill(repo, "issue-comments", polyfillOf("issue-comments", "merged"));
  git(repo, ["commit", "-q", "-am", "state moved"], { GIT_AUTHOR_DATE: "2026-11-20T12:00:00 +0000", GIT_COMMITTER_DATE: "2026-11-20T12:00:00 +0000" });
  expect(firstCommitAgeDays(repo, "packages/issue-comments/polyfill.json", new Date("2026-12-04T12:00:00Z"))).toBe(30);

  // A commit that does not touch the path does not count either.
  writeFileSync(join(repo, "docs.md"), "unrelated\n");
  git(repo, ["add", "docs.md"]);
  git(repo, ["commit", "-q", "-m", "unrelated"], { GIT_AUTHOR_DATE: "2026-11-01T12:00:00 +0000", GIT_COMMITTER_DATE: "2026-11-01T12:00:00 +0000" });
  expect(firstCommitAgeDays(repo, "packages/issue-comments/polyfill.json", new Date("2026-12-04T12:00:00Z"))).toBe(30);
});

test("an uncommitted path and a failed git run age to zero, with one stderr line", () => {
  const repo = newRoot();
  git(repo, ["init", "-q", "-b", "main"]);
  let lines = stderrLines(() => {
    expect(firstCommitAgeDays(repo, "packages/issue-comments/polyfill.json", new Date("2026-12-04T12:00:00Z"))).toBe(0);
  });
  expect(lines.length).toBe(0);

  lines = stderrLines(() => {
    expect(firstCommitAgeDays(join(repo, "not-a-repo"), "packages/issue-comments/polyfill.json", new Date("2026-12-04T12:00:00Z"))).toBe(0);
  });
  expect(lines.length).toBe(1);
  expect(lines[0]).toContain("packages/issue-comments/polyfill.json");
});
