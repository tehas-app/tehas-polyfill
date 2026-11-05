// Tests for the tracker entry and its gh and git calls: spec S7 (what the workflow may do) and
// PROCESS.md step 6. Everything here is offline: the world arrives through the TrackOpts seams
// plus the seams forge.ts declares, and a fixture repository stands in for a repo path. No `gh`
// is ever run, and no fixture has an `origin` remote, so no fixture can push anywhere.

import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addPathArgs,
  commitArgs,
  compareArgs,
  createBranchArgs,
  defaultBranchArgs,
  fetchBranchArgs,
  issueArgs,
  listOpenArgs,
  listTagsArgs,
  listTags,
  localRepo,
  openIssueArgs,
  openPrArgs,
  prBranch,
  pushArgs,
  requireTehasToken,
  switchBackArgs,
  writeBranch,
  type Filed,
  type GitRunner,
  type PatchProposal,
} from "../lib/forge";
import { applyPatch } from "../lib/state";
import { runTrack } from "../track";
import type { TrackRunOpts } from "../lib/forge";
import type { OpenTitles } from "../lib/types";

const RETIRE_TITLE = "Retire polyfill issue-comments: pi-rukas v0.15.0 ships trail-openers/pi-rukas#2020";
const MERGED_TITLE = "issue-comments: upstream merged (pi-rukas#2020)";
const RELEASED_TITLE = "issue-comments: upstream released (pi-rukas v0.15.0)";
const DECLINED_TITLE = "issue-comments: upstream closed without a merge (pi-rukas#2020)";
const DECIDE_TITLE = "Decide what replaces polyfill issue-comments: trail-openers/pi-rukas#2020 closed without a merge";
const REMIND_TITLE = "Polyfill issue-comments is still active";
/** What `gh pr create --repo` names: the repository the tracker runs in. */
const LOCAL = "tehas-app/tehas-polyfill";
const RECORD = join("packages", "issue-comments", "polyfill.json");
/** The branch a fixture checkout is on, and the branch a PR is proposed against. */
const BASE = "main";

const madeDirs: string[] = [];

afterEach(() => {
  for (const dir of madeDirs.splice(0, madeDirs.length)) rmSync(dir, { recursive: true, force: true });
});

function recordOf(name: string, state: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    upstream: { issue: "trail-openers/pi-rukas#2020", feature: "issueComments" },
    from: "v0.14.0",
    state,
    pr: null,
    until: null,
    ...extra,
  };
}

/** A throwaway directory whose packages/ holds the named records, in name order. Not a git repo. */
function fixtureRoot(records: Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), "track-run-"));
  madeDirs.push(dir);
  for (const record of records) {
    const name = String(record.name);
    mkdirSync(join(dir, "packages", name), { recursive: true });
    writeFileSync(join(dir, "packages", name, "polyfill.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
  return dir;
}

function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", ["-c", "user.email=track@example.com", "-c", "user.name=track", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...env },
  });
}

/** A git repository whose first commit touching the record is `at`: that is the record's age. */
function agedRoot(at: string): string {
  const dir = fixtureRoot([recordOf("issue-comments", "active")]);
  git(dir, ["init", "-q", "-b", BASE]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "add the polyfill"], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  return dir;
}

interface Captured {
  prs: PatchProposal[];
  issues: Filed[];
  compares: string[][];
  /** Every git argument list the run built, in order. */
  git: string[][];
}

function capture(): Captured {
  return { prs: [], issues: [], compares: [], git: [] };
}

/** The seams every test injects, so nothing here reaches for `gh` or for a real `git`. */
function seams(captured: Captured, o: Partial<TrackRunOpts> = {}): TrackRunOpts {
  return {
    dryRun: false,
    listTags: () => ["v0.14.0", "v0.14.50", "v0.15.0"],
    compare: (tag, sha) => {
      captured.compares.push([tag, sha]);
      return tag === "v0.15.0" ? "behind" : "ahead";
    },
    git: (args) => {
      captured.git.push(args);
      return `${BASE}\n`;
    },
    openPr: (proposal) => {
      captured.prs.push(proposal);
    },
    openIssue: (repo, title, body) => {
      captured.issues.push({ repo, title, body });
    },
    now: new Date("2026-11-24T12:00:00Z"),
    ...o,
  };
}

/** A git seam where the step named by `failAt` is the one that fails. */
function gitFailingAt(captured: Captured, failAt: string): (args: string[]) => string {
  return (args) => {
    captured.git.push(args);
    if (args[0] === failAt) throw new Error(`git ${args.join(" ")} failed: the step named ${failAt} is the one that fails`);
    return `${BASE}\n`;
  };
}

const closedMerged = () => ({ state: "closed" as const, mergedPr: { number: 2100, mergeCommit: "abc123" } });
const closedUnmerged = () => ({ state: "closed" as const, mergedPr: null });
const openUpstream = () => ({ state: "open" as const, mergedPr: null });
const nothingOpen = openBoth({ prs: [], issues: [] });

/** stdout of a run, so the printed plan can be asserted without a console. */
function outputOf(fn: () => unknown): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

function stderrLines(fn: () => unknown): string[] {
  const lines: string[] = [];
  const original = console.error;
  const originalWrite = process.stderr.write;
  console.error = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  // runTrack reports a failed call on process.stderr directly, not through console.error.
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk.trimEnd() : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    console.error = original;
    process.stderr.write = originalWrite;
  }
  return lines;
}

/** The tracker names its repository from GITHUB_REPOSITORY; the tests name it here. */
function inLocalRepo(fn: () => void): void {
  const saved = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = LOCAL;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved;
  }
}

/**
 * A filing on tehas is cross-repo, so it needs its own credential (R2). The tests carry a fake
 * one so the filing tests can run; the token tests take it away.
 */
function withTehasToken(fn: () => void): void {
  const saved = process.env.TEHAS_TRACKING_TOKEN;
  process.env.TEHAS_TRACKING_TOKEN = "a-fake-cross-repo-token";
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.TEHAS_TRACKING_TOKEN;
    else process.env.TEHAS_TRACKING_TOKEN = saved;
  }
}

function withoutTehasToken(fn: () => void): void {
  const saved = process.env.TEHAS_TRACKING_TOKEN;
  delete process.env.TEHAS_TRACKING_TOKEN;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.TEHAS_TRACKING_TOKEN;
    else process.env.TEHAS_TRACKING_TOKEN = saved;
  }
}

/**
 * A run outside a GitHub Actions checkout: `GITHUB_REPOSITORY` is not there to lean on. Only the
 * tests that check what happens then use it, and they call `runTrack` rather than `run`.
 */
function withoutLocalRepo(fn: () => void): void {
  const saved = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved;
  }
}

/**
 * One tracking run, in a repository it can name: the precondition every real run has, stated at the
 * run that needs it rather than set once for the file.
 */
function run(root: string, o: TrackRunOpts): number {
  let code = 0;
  inLocalRepo(() => {
    code = runTrack(root, o);
  });
  return code;
}

/** The titles a run sees, as the seam now reports them: one repository and kind at a time. */
function openBoth(titles: OpenTitles): (repo: string, kind: "pr" | "issue") => string[] {
  return (_repo, kind) => (kind === "pr" ? titles.prs : titles.issues);
}

function recordText(root: string, name = "issue-comments"): string {
  return readFileSync(join(root, "packages", name, "polyfill.json"), "utf8");
}

function actionLines(out: string): string[] {
  return out.split("\n").filter((line) => line.includes("would open") || line.includes("would file") || line.includes("opened") || line.includes("filed"));
}

const activeRecord = recordOf("issue-comments", "active");
const mergedRecord = recordOf("issue-comments", "merged", { pr: 2100 });

test("test_dry_run_changes_nothing: no file written, no filing call, no git call, one line per action", () => {
  const root = fixtureRoot([activeRecord]);
  const before = recordText(root);
  const captured = capture();

  let code = 0;
  const out = outputOf(() => {
    code = run(root, seams(captured, { dryRun: true, fetchUpstream: closedMerged, listOpen: nothingOpen }));
  });

  expect(code).toBe(0);
  expect(out).toContain(`issue-comments: would open PR "${MERGED_TITLE}"`);
  expect(actionLines(out)).toHaveLength(1);
  expect(recordText(root)).toBe(before);
  expect(captured.prs).toEqual([]);
  expect(captured.issues).toEqual([]);
  // A dry run performs none of the git write either: not even the branch it would propose.
  expect(captured.git).toEqual([]);
});

test("nothing_to_do: a run with no action says so and exits 0", () => {
  const root = fixtureRoot([activeRecord]);
  const captured = capture();

  let code = 0;
  const out = outputOf(() => {
    code = run(root, seams(captured, { dryRun: true, fetchUpstream: openUpstream, listOpen: nothingOpen }));
  });

  expect(code).toBe(0);
  expect(out).toContain("issue-comments: nothing to do");
  expect(captured.prs).toEqual([]);
  expect(captured.git).toEqual([]);
});

test("merged package: the first containing tag becomes until and the retire issue is filed", () => {
  const root = fixtureRoot([mergedRecord]);
  const captured = capture();

  let code = 0;
  const out = outputOf(() => {
    code = run(root, seams(captured, { dryRun: true, fetchUpstream: closedMerged, listOpen: nothingOpen }));
  });

  expect(code).toBe(0);
  // Only tags at or after the record's `from` are compared, oldest first, against the merge commit.
  expect(captured.compares.map((c) => c[0])).toEqual(["v0.14.0", "v0.14.50", "v0.15.0"]);
  expect(captured.compares.every((c) => c[1] === "abc123")).toBe(true);
  expect(out).toContain(`would open PR "${RELEASED_TITLE}"`);
  expect(out).toContain(`would file issue "${RETIRE_TITLE}"`);
  expect(actionLines(out)).toHaveLength(2);

  // A dry run never patches the record: `until` is still null on disk.
  expect(JSON.parse(recordText(root)).until).toBeNull();
});

test("test_idempotent_by_title: a title that is already open files nothing", () => {
  const root = fixtureRoot([activeRecord]);
  const captured = capture();

  let code = 0;
  const out = outputOf(() => {
    code = run(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: openBoth({ prs: [MERGED_TITLE], issues: [] }) }));
  });

  expect(code).toBe(0);
  expect(captured.prs).toEqual([]);
  expect(captured.issues).toEqual([]);
  expect(out).toContain("issue-comments: nothing to do");
  expect(JSON.parse(recordText(root)).state).toBe("active");
  expect(JSON.parse(recordText(root)).pr).toBeNull();
  // Nothing open means nothing filed, so nothing is branched or pushed.
  expect(captured.git).toEqual([]);
});

test("a filed title is not filed again by the next run", () => {
  const root = fixtureRoot([activeRecord]);
  const before = recordText(root);
  const first = capture();

  inLocalRepo(() => {
    outputOf(() => {
      expect(run(root, seams(first, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen }))).toBe(0);
    });
  });
  expect(first.prs.map((p) => p.title)).toEqual([MERGED_TITLE]);
  expect(first.prs[0].repo).toBe(LOCAL);
  // The tracker proposes; it does not apply. The record on disk is exactly what it was.
  expect(recordText(root)).toBe(before);

  // The next run sees that PR open and files nothing, so it branches nothing either.
  const second = capture();
  const out = outputOf(() => {
    expect(run(root, seams(second, { dryRun: false, fetchUpstream: closedMerged, listOpen: openBoth({ prs: [MERGED_TITLE], issues: [] }) }))).toBe(0);
  });
  expect(second.prs).toEqual([]);
  expect(second.git).toEqual([]);
  expect(out).toContain("issue-comments: nothing to do");
  expect(recordText(root)).toBe(before);
});

test("test_pr_branch_name_per_action: one branch per action, named for the package and the action", () => {
  expect(prBranch("issue-comments", "pr-merged")).toBe("track/issue-comments-merged");
  expect(prBranch("issue-comments", "pr-released")).toBe("track/issue-comments-released");
  expect(prBranch("issue-comments", "pr-declined")).toBe("track/issue-comments-declined");

  // The two actions a released package files land on different branches: the PR here, the issue on tehas.
  const root = fixtureRoot([mergedRecord]);
  const captured = capture();
  inLocalRepo(() => {
    withTehasToken(() => {
      outputOf(() => {
        expect(run(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen }))).toBe(0);
      });
    });
  });
  expect(captured.prs.map((p) => p.branch)).toEqual(["track/issue-comments-released"]);
  expect(captured.issues).toHaveLength(1);

  // A declined package lands on its own branch, not the merged one.
  const declined = capture();
  inLocalRepo(() => {
    withTehasToken(() => {
      outputOf(() => {
        expect(run(fixtureRoot([activeRecord]), seams(declined, { dryRun: false, fetchUpstream: closedUnmerged, listOpen: nothingOpen }))).toBe(0);
      });
    });
  });
  expect(declined.prs.map((p) => p.branch)).toEqual(["track/issue-comments-declined"]);
});

test("test_branch_write_order_and_staged_path: fetch, switch, write, stage one path, commit, push, back", () => {
  const root = fixtureRoot([activeRecord]);
  const before = recordText(root);
  const captured = capture();

  inLocalRepo(() => {
    outputOf(() => {
      expect(run(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen }))).toBe(0);
    });
  });

  const branch = "track/issue-comments-merged";
  expect(captured.git.map((args) => args[0])).toEqual(["rev-parse", "fetch", "switch", "add", "commit", "push", "switch"]);
  expect(captured.git[0]).toEqual(defaultBranchArgs());
  // The branch is fetched before it is reset: the push is leased, and a lease needs the remote's
  // current value for that branch (see test_a_branch_that_exists_on_origin_is_fetched_before_it_is_reused).
  expect(captured.git[1]).toEqual(fetchBranchArgs(branch));
  expect(captured.git[1]).toEqual(["fetch", "--no-tags", "origin", branch]);
  expect(captured.git[2]).toEqual(createBranchArgs(branch));
  // A proposal branch that already exists is reset, not fatal (R3), and the push is leased so a
  // rejected push cannot leave an orphan behind.
  expect(captured.git[2]).toEqual(["switch", "-C", branch]);
  // The repo rule: the one record path is staged by name, never `git add -A`.
  expect(captured.git[3]).toEqual(addPathArgs(RECORD));
  expect(captured.git[4]).toEqual(commitArgs(branch, MERGED_TITLE));
  expect(captured.git[5]).toEqual(pushArgs(branch));
  expect(captured.git[5]).toEqual(["push", "--force-with-lease", "-u", "origin", branch]);
  // The working tree is put back on the branch the PR is proposed against.
  expect(captured.git[6]).toEqual(switchBackArgs(BASE));

  // Only that one path is ever staged, and no git step is a merge.
  const staged = captured.git.filter((args) => args[0] === "add").flatMap((args) => args.slice(args.indexOf("--") + 1));
  expect(staged).toEqual([RECORD]);
  for (const args of captured.git) {
    expect(args).not.toContain("-A");
    expect(args).not.toContain("--all");
    expect(args[0]).not.toMatch(/merge|squash|rebase/);
  }

  // The PR carries the patched bytes; the working tree ends byte-identical.
  const proposal = captured.prs[0];
  expect(proposal.path).toBe(RECORD);
  expect(proposal.content).toBe(applyPatch(before, { state: "merged", pr: 2100 }));
  expect(proposal.content).not.toBe(before);
  expect(recordText(root)).toBe(before);
});

test("test_head_names_the_branch: gh pr create names the branch it wrote, against the default branch", () => {
  const root = fixtureRoot([activeRecord]);
  const captured = capture();

  inLocalRepo(() => {
    outputOf(() => {
      expect(run(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen }))).toBe(0);
    });
  });

  const proposal = captured.prs[0];
  const created = captured.git.find((args) => args[0] === "switch" && args[1] === "-C");
  expect(created).toBeDefined();

  const args = openPrArgs(proposal.repo, proposal.title, proposal.body, proposal.branch, proposal.base);
  expect(args.slice(0, 2)).toEqual(["pr", "create"]);
  expect(args[args.indexOf("--repo") + 1]).toBe(LOCAL);
  expect(args[args.indexOf("--base") + 1]).toBe(BASE);
  expect(args[args.indexOf("--head") + 1]).toBe(proposal.branch);
  // The branch the PR names is the branch the git write created.
  expect(args[args.indexOf("--head") + 1]).toBe(created![2]);
});

test("test_no_tehas_label: no argument list names a label, and none merges", () => {
  const root = fixtureRoot([activeRecord]);
  const captured = capture();
  inLocalRepo(() => {
    outputOf(() => {
      expect(run(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen }))).toBe(0);
    });
  });

  const lists = [
    issueArgs("trail-openers/pi-rukas", "trail-openers/pi-rukas#2020"),
    listTagsArgs("trail-openers/pi-rukas"),
    compareArgs("trail-openers/pi-rukas", "v0.15.0", "abc123"),
    listOpenArgs("tehas-app/tehas", "pr"),
    listOpenArgs("tehas-app/tehas", "issue"),
    openPrArgs(LOCAL, MERGED_TITLE, "body", "track/issue-comments-merged", BASE),
    openIssueArgs("tehas-app/tehas", RETIRE_TITLE, "body"),
    ...captured.git,
  ];

  for (const args of lists) {
    expect(args.length).toBeGreaterThan(0);
    for (const arg of args) {
      expect(arg).not.toContain("tehas:");
      if (arg.startsWith("--")) {
        // S7: the tracker opens things, never merges them and never labels a tehas issue.
        expect(arg).not.toMatch(/merge|squash|label|delete-branch/);
      }
    }
    // The verb slot of a gh call is args[0] for `gh api <endpoint>` and args[1] for `gh pr|issue <verb>`;
    // for git it is args[0]. A commit *message* may contain the word "merged" - the verb may not.
    const verbs = args[0] === "api" ? [args[0]] : [args[0], args[1]];
    expect(verbs.some((verb) => /^(merge|squash|rebase)/i.test(verb))).toBe(false);
  }

  expect(lists[5].slice(0, 2)).toEqual(["pr", "create"]);
  expect(lists[6].slice(0, 2)).toEqual(["issue", "create"]);
});

test("test_list_open_names_a_limit: gh pr|issue list does not stop at the default 30 titles", () => {
  for (const kind of ["pr", "issue"] as const) {
    const args = listOpenArgs(LOCAL, kind);
    expect(args).toContain("--limit");
    const limit = Number(args[args.indexOf("--limit") + 1]);
    expect(Number.isInteger(limit)).toBe(true);
    // gh lists 30 titles unless told otherwise, and an idempotence check that cannot see past 30
    // files a duplicate. A tracker never opens anything near this many.
    expect(limit).toBeGreaterThanOrEqual(100);
  }
});

test("test_missing_tehas_token_exits_2_and_files_nothing: a cross-repo filing is never skipped silently", () => {
  const root = fixtureRoot([activeRecord]);
  const before = recordText(root);
  const captured = capture();

  let code = 0;
  const lines = stderrLines(() => {
    withoutTehasToken(() => {
      inLocalRepo(() => {
        outputOf(() => {
          code = run(root, {
            dryRun: false,
            fetchUpstream: closedUnmerged,
            listOpen: nothingOpen,
            listTags: () => [],
            compare: () => "ahead",
            git: (args) => {
              captured.git.push(args);
              return `${BASE}\n`;
            },
            openPr: (proposal) => {
              captured.prs.push(proposal);
            },
            // No openIssue seam: this is the filing that needs a credential of its own.
            now: new Date("2026-11-24T12:00:00Z"),
          });
        });
      });
    });
  });

  expect(code).toBe(2);
  expect(lines.some((line) => line.includes("TEHAS_TRACKING_TOKEN"))).toBe(true);
  // Nothing is filed, not even the same-repo PR that came first: a run files everything or nothing.
  expect(captured.prs).toEqual([]);
  expect(captured.git).toEqual([]);
  expect(recordText(root)).toBe(before);
});

test("a dry run needs no tehas credential and files nothing", () => {
  const root = fixtureRoot([activeRecord]);
  const captured = capture();

  let code = 0;
  const out = outputOf(() => {
    withoutTehasToken(() => {
      code = run(root, {
        dryRun: true,
        fetchUpstream: closedUnmerged,
        listOpen: nothingOpen,
        listTags: () => [],
        compare: () => "ahead",
        now: new Date("2026-11-24T12:00:00Z"),
      });
    });
  });

  expect(code).toBe(0);
  expect(out).toContain(`would file issue "${DECIDE_TITLE}"`);
  expect(captured.git).toEqual([]);
});

test("requireTehasToken names the variable it wants, and never falls back to the workflow token", () => {
  withoutTehasToken(() => {
    expect(() => requireTehasToken()).toThrow(/TEHAS_TRACKING_TOKEN/);
  });
  withTehasToken(() => {
    expect(requireTehasToken()).toBe("a-fake-cross-repo-token");
  });
});

test("test_existing_proposal_branch_is_reset: a closed proposal does not break the next run", () => {
  // A real repository holding an older proposal branch, with no origin remote: the git write runs
  // for real, the branch is reused, and the push is the step that cannot succeed.
  const root = agedRoot("2026-11-01T12:00:00 +0000");
  const before = recordText(root);
  git(root, ["switch", "-C", "track/issue-comments-merged"]);
  writeFileSync(join(root, "stale.txt"), "an older proposal\n");
  git(root, ["add", "--", "stale.txt"]);
  git(root, ["commit", "-q", "-m", "the older proposal"]);
  git(root, ["switch", "-f", BASE]);

  let code = 0;
  const lines = stderrLines(() => {
    inLocalRepo(() => {
      outputOf(() => {
        code = run(root, {
          dryRun: false,
          fetchUpstream: closedMerged,
          listOpen: nothingOpen,
          now: new Date("2026-11-24T12:00:00Z"),
        });
      });
    });
  });

  expect(code).toBe(2);
  // The branch was reused rather than refused: the failure is the push, never the switch.
  expect(lines.some((line) => line.includes("git push"))).toBe(true);
  expect(lines.some((line) => line.includes("git switch"))).toBe(false);
  const subjects = git(root, ["log", "--format=%s", "track/issue-comments-merged"]).split("\n");
  expect(subjects).not.toContain("the older proposal");
  expect(subjects[0]).toContain("issue-comments: upstream merged");
  expect(recordText(root)).toBe(before);
  expect(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe(BASE);
});

test("the reminder title does not move with the record's age, so the next day files nothing", () => {
  const root = agedRoot("2026-08-26T12:00:00 +0000");
  const runs: Captured[] = [];

  for (const day of ["2026-10-26T12:00:00Z", "2026-11-24T12:00:00Z"]) {
    const captured = capture();
    runs.push(captured);
    withTehasToken(() => {
      outputOf(() => {
        expect(run(root, seams(captured, { dryRun: false, fetchUpstream: openUpstream, listOpen: nothingOpen, now: new Date(day) }))).toBe(0);
      });
    });
  }

  // 61 days old and 90 days old: the same title, so the second run's list would have matched it.
  expect(runs.map((r) => r.issues.map((i) => i.title))).toEqual([[REMIND_TITLE], [REMIND_TITLE]]);
  expect(runs[0]!.issues[0]!.body).toContain("61 days");
  expect(runs[1]!.issues[0]!.body).toContain("90 days");

  const third = capture();
  withTehasToken(() => {
    outputOf(() => {
      expect(run(root, seams(third, { dryRun: false, fetchUpstream: openUpstream, listOpen: openBoth({ prs: [], issues: [REMIND_TITLE] }), now: new Date("2026-11-25T12:00:00Z") }))).toBe(0);
    });
  });
  expect(third.issues).toEqual([]);
});

test("test_failure_exits_2_without_partial_write: every unfinished polyfill.json is byte-identical", () => {
  const root = fixtureRoot([recordOf("aaa", "active"), activeRecord]);
  const before = recordText(root);
  const beforeAaa = recordText(root, "aaa");
  const captured = capture();

  let code = 0;
  outputOf(() => {
    code = run(root, seams(captured, {
      dryRun: false,
      fetchUpstream: closedMerged,
      listOpen: nothingOpen,
      // The first package is filed; the second one's filing is the one that fails.
      openPr: (proposal) => {
        if (proposal.title.startsWith("issue-comments:")) throw new Error("could not connect to api.github.com");
        captured.prs.push(proposal);
      },
    }));
  });

  expect(code).toBe(2);
  expect(recordText(root)).toBe(before);
  expect(JSON.parse(recordText(root)).state).toBe("active");
  // The filed package's own record is untouched too: its change lives on the branch it pushed.
  expect(recordText(root, "aaa")).toBe(beforeAaa);
  expect(JSON.parse(recordText(root, "aaa")).state).toBe("active");
});

test("a filing call that fails leaves that package's record byte-identical", () => {
  const root = fixtureRoot([activeRecord]);
  const before = recordText(root);
  const captured = capture();

  let code = 0;
  outputOf(() => {
    code = run(root, seams(captured, {
      dryRun: false,
      fetchUpstream: closedMerged,
      listOpen: nothingOpen,
      openPr: () => {
        throw new Error("gh pr create failed: could not connect to api.github.com");
      },
    }));
  });

  expect(code).toBe(2);
  expect(recordText(root)).toBe(before);
  expect(captured.prs).toEqual([]);
});

test("test_failure_at_each_git_step_leaves_the_record_byte_identical: switch, add, commit and push", () => {
  const ranThrough: Record<string, string[]> = {
    switch: ["rev-parse", "fetch", "switch"],
    add: ["rev-parse", "fetch", "switch", "add", "switch"],
    commit: ["rev-parse", "fetch", "switch", "add", "commit", "switch"],
    push: ["rev-parse", "fetch", "switch", "add", "commit", "push", "switch"],
  };
  for (const failAt of ["switch", "add", "commit", "push"]) {
    const root = fixtureRoot([activeRecord]);
    const before = recordText(root);
    const captured = capture();

    let code = 0;
    outputOf(() => {
      code = run(root, seams(captured, {
        dryRun: false,
        fetchUpstream: closedMerged,
        listOpen: nothingOpen,
        git: gitFailingAt(captured, failAt),
      }));
    });

    expect(code).toBe(2);
    expect(recordText(root)).toBe(before);
    expect(captured.prs).toEqual([]);
    // Nothing after the failed step ran, and the steps that did ran are put back. A failed
    // `switch -c` wrote nothing, so there is nothing to put back.
    expect(captured.git.map((args) => args[0])).toEqual(ranThrough[failAt]);
  }
});

test("test_a_branch_that_exists_on_origin_is_fetched_before_it_is_reused", () => {
  // `push --force-with-lease` leases against `refs/remotes/origin/<branch>`. A proposal branch left
  // by a closed PR exists on the remote and was never fetched in this run, so without a fetch the
  // push is rejected with `stale info` and the scheduled run exits 2. The remote here is a bare
  // repository in /tmp: the branch genuinely exists on it, and nothing reaches the network.
  const origin = mkdtempSync(join(tmpdir(), "track-origin-"));
  madeDirs.push(origin);
  git(origin, ["init", "-q", "--bare", "-b", BASE]);

  const root = agedRoot("2026-11-01T12:00:00 +0000");
  git(root, ["remote", "add", "origin", origin]);
  git(root, ["push", "-q", "origin", BASE]);

  const branch = prBranch("issue-comments", "pr-merged");
  // The out-of-band proposal commit: what a closed proposal PR leaves on the remote. A scratch clone
  // puts it there, so this checkout has no remote-tracking ref for it and its own copy of the
  // branch, if it has one, is behind - the situation a scheduled run actually meets.
  const scratch = mkdtempSync(join(tmpdir(), "track-scratch-"));
  madeDirs.push(scratch);
  git(scratch, ["clone", "-q", origin, "."]);
  git(scratch, ["switch", "-q", "-c", branch]);
  writeFileSync(join(scratch, RECORD), `${JSON.stringify(recordOf("issue-comments", "merged", { pr: 2099 }), null, 2)}\n`);
  git(scratch, ["add", "--", RECORD]);
  git(scratch, ["commit", "-q", "-m", "the proposal that was closed"]);
  git(scratch, ["push", "-q", "origin", branch]);
  expect(git(root, ["branch", "--list", branch])).toBe("");

  const before = recordText(root);
  const ran: string[][] = [];
  const proposal: PatchProposal = {
    repo: LOCAL,
    base: BASE,
    branch,
    path: RECORD,
    title: MERGED_TITLE,
    body: "proposed until v0.15.0",
    content: `${JSON.stringify(recordOf("issue-comments", "merged", { pr: 2100 }), null, 2)}\n`,
  };

  expect(() => writeBranch(root, proposal, (args) => {
    ran.push(args);
    return git(root, args);
  })).not.toThrow();
  // The fetch comes first: it is what gives the push something to lease against.
  expect(ran.map((args) => args[0])).toEqual(["fetch", "switch", "add", "commit", "push", "switch"]);
  const landed = git(origin, ["rev-parse", `refs/heads/${branch}`]).trim();
  expect(landed).toMatch(/^[0-9a-f]{40}$/);

  // The run is repeatable: the branch now exists on both sides and a second run reuses it.
  expect(() => writeBranch(root, proposal, (args) => git(root, args))).not.toThrow();
  expect(git(origin, ["rev-parse", `refs/heads/${branch}`]).trim()).toMatch(/^[0-9a-f]{40}$/);

  // And the checkout is left as it was found: the base branch, the record byte-identical.
  expect(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe(BASE);
  expect(recordText(root)).toBe(before);
  expect(git(root, ["status", "--porcelain"])).toBe("");
});

test("test_a_branch_that_does_not_exist_yet_is_created_by_the_push", () => {
  // The first run on a fresh proposal: the fetch names a ref that is not there, and that is not the
  // tracker's problem - the push creates the branch.
  const origin = mkdtempSync(join(tmpdir(), "track-origin-"));
  madeDirs.push(origin);
  git(origin, ["init", "-q", "--bare", "-b", BASE]);

  const root = agedRoot("2026-11-01T12:00:00 +0000");
  git(root, ["remote", "add", "origin", origin]);
  git(root, ["push", "-q", "origin", BASE]);

  const branch = prBranch("issue-comments", "pr-released");
  const proposal: PatchProposal = {
    repo: LOCAL,
    base: BASE,
    branch,
    path: RECORD,
    title: RELEASED_TITLE,
    body: "proposed until v0.15.0",
    content: `${JSON.stringify(recordOf("issue-comments", "released", { until: "v0.15.0" }), null, 2)}\n`,
  };

  expect(() => writeBranch(root, proposal, (args) => git(root, args))).not.toThrow();
  expect(git(origin, ["rev-parse", `refs/heads/${branch}`]).trim()).toMatch(/^[0-9a-f]{40}$/);
});

test("no seam and no dry run: the real git calls run, and a push with no remote exits 2", () => {
  // A real repository with the record committed and no `origin` remote: the real chain runs, and
  // the push is the step that cannot succeed. Nothing here can reach anywhere.
  const root = agedRoot("2026-11-01T12:00:00 +0000");
  const before = recordText(root);

  let code = 0;
  const lines = stderrLines(() => {
    inLocalRepo(() => {
      outputOf(() => {
        code = run(root, {
          dryRun: false,
          fetchUpstream: closedMerged,
          listOpen: nothingOpen,
          now: new Date("2026-11-24T12:00:00Z"),
          // No `git`, no `openPr`, no `openIssue` seam: the real calls.
        });
      });
    });
  });

  expect(code).toBe(2);
  expect(lines.some((line) => line.includes("git push"))).toBe(true);
  expect(recordText(root)).toBe(before);
  // The tracker's own branch is left behind locally, but the checkout it started on is intact.
  expect(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe(BASE);
  expect(git(root, ["status", "--porcelain"])).toBe("");
  expect(git(root, ["branch", "--list", "track/issue-comments-merged"])).toContain("track/issue-comments-merged");
});

test("a compare call that fails files nothing and writes nothing", () => {
  const root = fixtureRoot([mergedRecord]);
  const before = recordText(root);
  const captured = capture();

  let code = 0;
  outputOf(() => {
    code = run(root, seams(captured, {
      dryRun: false,
      fetchUpstream: closedMerged,
      listOpen: nothingOpen,
      compare: () => {
        throw new Error("gh api compare failed: could not connect to api.github.com");
      },
    }));
  });

  expect(code).toBe(2);
  expect(recordText(root)).toBe(before);
  expect(captured.prs).toEqual([]);
  expect(captured.issues).toEqual([]);
});

test("closed without a merge files the decline PR and the decide issue", () => {
  const root = fixtureRoot([activeRecord]);
  const captured = capture();

  let code = 0;
  outputOf(() => {
    withTehasToken(() => {
      code = run(root, seams(captured, { dryRun: false, fetchUpstream: closedUnmerged, listOpen: nothingOpen }));
    });
  });

  expect(code).toBe(0);
  expect(captured.prs.map((c) => c.title)).toEqual([DECLINED_TITLE]);
  expect(captured.issues.map((c) => c.title)).toEqual([DECIDE_TITLE]);
  expect(JSON.parse(recordText(root)).state).toBe("active");
});

test("the reminder files on tehas once the record is 90 days old", () => {
  const root = agedRoot("2026-08-26T12:00:00 +0000");
  const captured = capture();

  let code = 0;
  const out = outputOf(() => {
    withTehasToken(() => {
      code = run(root, seams(captured, { dryRun: false, fetchUpstream: openUpstream, listOpen: nothingOpen }));
    });
  });

  expect(code).toBe(0);
  expect(captured.prs).toEqual([]);
  expect(captured.issues.map((c) => c.title)).toEqual([REMIND_TITLE]);
  expect(captured.issues[0].repo).toBe("tehas-app/tehas");
  expect(out).toContain(`filed issue "${REMIND_TITLE}"`);
  // A reminder changes no record, so there is nothing to branch or push.
  expect(JSON.parse(recordText(root)).state).toBe("active");
  expect(captured.git).toEqual([]);
});

test("an already-open reminder title files nothing", () => {
  const root = agedRoot("2026-08-26T12:00:00 +0000");
  const captured = capture();

  let code = 0;
  const out = outputOf(() => {
    code = run(root, seams(captured, { dryRun: false, fetchUpstream: openUpstream, listOpen: openBoth({ prs: [], issues: [REMIND_TITLE] }) }));
  });

  expect(code).toBe(0);
  expect(captured.issues).toEqual([]);
  expect(out).toContain("issue-comments: nothing to do");
});

test("test_containment_is_not_capped_at_the_probe_window: an old containing release is still found", () => {
  const root = fixtureRoot([mergedRecord]);
  const captured = capture();
  // Twenty upstream releases, newest first as GitHub lists them. The merge commit landed in the
  // second oldest, well outside the newest 12 the probe speaks about.
  const tags = Array.from({ length: 20 }, (_, i) => `v0.14.${20 - i}`);

  let code = 0;
  withTehasToken(() => {
    inLocalRepo(() => {
      outputOf(() => {
        code = run(root, seams(captured, {
          dryRun: false,
          fetchUpstream: closedMerged,
          listOpen: nothingOpen,
          listTags: () => tags,
          compare: (tag, sha) => {
            captured.compares.push([tag, sha]);
            return tag === "v0.14.2" ? "behind" : "ahead";
          },
        }));
      });
    });
  });

  expect(code).toBe(0);
  // Oldest first, and the scan stops at the first tag that carries the commit.
  expect(captured.compares.map((c) => c[0])).toEqual(["v0.14.1", "v0.14.2"]);
  expect(captured.prs.map((p) => p.title)).toEqual(["issue-comments: upstream released (pi-rukas v0.14.2)"]);
  expect(captured.issues.map((i) => i.title)).toEqual(["Retire polyfill issue-comments: pi-rukas v0.14.2 ships trail-openers/pi-rukas#2020"]);
  expect(JSON.parse(captured.prs[0].content).until).toBe("v0.14.2");
});

test("the tag the tracker chose does not move when newer releases land", () => {
  const older = ["v0.14.0", "v0.14.50", "v0.15.0"];
  // Fifteen newer releases: a newest-12 window would not contain v0.15.0 at all.
  const newer = [...Array.from({ length: 15 }, (_, i) => `v0.16.${15 - i}`), ...older];
  const compare = (tag: string) => (tag === "v0.15.0" ? "behind" : "ahead");

  const titles: string[][] = [];
  for (const tags of [older, newer]) {
    const root = fixtureRoot([mergedRecord]);
    const captured = capture();
    withTehasToken(() => {
      inLocalRepo(() => {
        outputOf(() => {
          expect(run(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen, listTags: () => tags, compare }))).toBe(0);
        });
      });
    });
    titles.push(captured.prs.map((p) => p.title));
  }

  expect(titles[0]).toEqual([RELEASED_TITLE]);
  expect(titles[1]).toEqual(titles[0]);
});

test("the PR and the issue body name the tag the tracker chose", () => {
  // A prerelease can become a record's `until`; naming the tag in both bodies is how a human sees it.
  const root = fixtureRoot([mergedRecord]);
  const captured = capture();
  withTehasToken(() => {
    inLocalRepo(() => {
      outputOf(() => {
        expect(run(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen }))).toBe(0);
      });
    });
  });

  expect(captured.prs[0].body).toContain("v0.15.0");
  expect(captured.issues[0].body).toContain("v0.15.0");
});

test("test_open_titles_are_read_once_per_half_actually_used", () => {
  const runs: { here: string; tehas: string; used: string[][] }[] = [];

  for (const [name, setup] of [
    ["pr only", { root: () => fixtureRoot([activeRecord]), upstream: closedMerged }],
    ["issue only", { root: () => agedRoot("2026-08-26T12:00:00 +0000"), upstream: openUpstream }],
  ] as const) {
    const root = setup.root();
    const captured = capture();
    const used: string[][] = [];
    const listOpen = (repo: string, kind: "pr" | "issue") => {
      used.push([repo, kind]);
      return [];
    };
    withTehasToken(() => {
      inLocalRepo(() => {
        outputOf(() => {
          expect(run(root, seams(captured, { dryRun: false, fetchUpstream: setup.upstream, listOpen }))).toBe(0);
        });
      });
    });
    runs.push({ here: LOCAL, tehas: "tehas-app/tehas", used });
  }

  // A run that files a PR here never lists tehas issues; a reminder never lists PRs.
  expect(runs[0]!.used).toEqual([[runs[0]!.here, "pr"]]);
  expect(runs[1]!.used).toEqual([[runs[1]!.tehas, "issue"]]);
});

test("test_open_titles_are_memoized_per_repository_and_kind", () => {
  const root = fixtureRoot([recordOf("aaa", "merged", { pr: 2100 }), recordOf("bbb", "merged", { pr: 2101 })]);
  const captured = capture();
  const used: string[][] = [];

  withTehasToken(() => {
    inLocalRepo(() => {
      outputOf(() => {
        expect(run(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: (repo, kind) => {
          used.push([repo, kind]);
          return [];
        } }))).toBe(0);
      });
    });
  });

  // Two packages, one run: each half is read once, not once per package.
  expect(captured.prs).toHaveLength(2);
  expect(used.filter((c) => c[1] === "pr")).toEqual([[LOCAL, "pr"]]);
  expect(used.filter((c) => c[1] === "issue")).toEqual([["tehas-app/tehas", "issue"]]);
});

test("test_local_repo_names_its_own_repository_and_fails_when_it_cannot", () => {
  const gitOf = (urls: Record<string, string>): GitRunner => (args) => {
    const url = urls[args.join(" ")];
    if (url === undefined) throw new Error(`git ${args.join(" ")} failed: fatal: no such remote: origin`);
    return url;
  };
  const https = gitOf({ "remote get-url origin": "https://github.com/acme/polyfills.git\n" });
  const ssh = gitOf({ "remote get-url origin": "git@github.com:acme/polyfills.git\n" });

  // The Actions variable first, and no git call at all when it is there.
  inLocalRepo(() => expect(localRepo(gitOf({}))).toBe(LOCAL));
  withoutLocalRepo(() => expect(localRepo(https)).toBe("acme/polyfills"));
  withoutLocalRepo(() => expect(localRepo(ssh)).toBe("acme/polyfills"));
  // Unresolvable is a named failure, never "the repository I happen to be standing in".
  withoutLocalRepo(() => expect(() => localRepo(gitOf({}))).toThrow(/GITHUB_REPOSITORY/));
});

test("test_unparseable_from_is_warned_about: it can never match an upstream release", () => {
  // `from` is the floor of the containment scan. A value that is not a release tag makes the scan
  // answer "no candidates" silently, which would leave a merged package permanently un-releasable.
  const root = fixtureRoot([recordOf("issue-comments", "merged", { pr: 2100, from: "0.14.0" })]);
  const captured = capture();
  const compared: string[] = [];

  let code = 0;
  const lines = stderrLines(() => {
    code = run(root, seams(captured, {
      dryRun: false,
      fetchUpstream: closedMerged,
      listOpen: nothingOpen,
      listTags: () => ["v0.15.0", "v0.14.9"],
      compare: (tag) => {
        compared.push(tag);
        return "behind";
      },
    }));
  });

  expect(code).toBe(0);
  expect(compared).toEqual([]);
  expect(lines.some((line) => line.includes("0.14.0") && line.includes("v<major>.<minor>.<patch>"))).toBe(true);
});

test("a run that cannot name its repository exits 2 and files nothing", () => {
  const root = fixtureRoot([activeRecord]);
  const before = recordText(root);
  const captured = capture();

  let code = 0;
  const lines = stderrLines(() => {
    // `runTrack`, not `run`: this is the run with no repository to name.
    withoutLocalRepo(() => {
      outputOf(() => {
        code = runTrack(root, seams(captured, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen }));
      });
    });
  });

  expect(code).toBe(2);
  expect(lines.some((line) => line.includes("GITHUB_REPOSITORY"))).toBe(true);
  expect(captured.prs).toEqual([]);
  // Only the attempt to name the repository: no branch was created, staged, committed or pushed.
  expect(captured.git.map((args) => args[0])).toEqual(["remote"]);
  expect(recordText(root)).toBe(before);
});

test("test_a_real_run_reaches_tehas_only_with_its_own_credential", () => {
  // A decision that only files a PR here never reaches tehas, so it needs no tehas credential.
  const prRoot = fixtureRoot([activeRecord]);
  const prs = capture();
  let prCode = 0;
  withoutTehasToken(() => {
    inLocalRepo(() => {
      outputOf(() => {
        prCode = run(prRoot, seams(prs, { dryRun: false, fetchUpstream: closedMerged, listOpen: nothingOpen }));
      });
    });
  });
  expect(prCode).toBe(0);
  expect(prs.prs).toHaveLength(1);

  // A decision that reads or files on tehas without the credential is exit 2, naming it, and it
  // files nothing - not even the PR it would have opened first.
  const tehasRoot = fixtureRoot([activeRecord]);
  const before = recordText(tehasRoot);
  const captured = capture();
  let code = 0;
  const lines = stderrLines(() => {
    withoutTehasToken(() => {
      inLocalRepo(() => {
        outputOf(() => {
          code = run(tehasRoot, seams(captured, { dryRun: false, fetchUpstream: closedUnmerged, listOpen: nothingOpen }));
        });
      });
    });
  });
  expect(code).toBe(2);
  expect(lines.some((line) => line.includes("TEHAS_TRACKING_TOKEN"))).toBe(true);
  expect(captured.prs).toEqual([]);
  expect(captured.git).toEqual([]);
  expect(recordText(tehasRoot)).toBe(before);

  // A dry run may read with whatever credential gh already has.
  const dry = capture();
  let dryCode = 0;
  withoutTehasToken(() => {
    inLocalRepo(() => {
      outputOf(() => {
        dryCode = run(fixtureRoot([activeRecord]), seams(dry, { dryRun: true, fetchUpstream: closedUnmerged, listOpen: nothingOpen }));
      });
    });
  });
  expect(dryCode).toBe(0);
  expect(dry.issues).toEqual([]);
});
