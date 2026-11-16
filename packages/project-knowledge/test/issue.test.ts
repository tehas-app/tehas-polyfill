// The issue number, found by the order a real cycle showed a child can see: the host's variable,
// the driver's state file owned by the child's parent, then the developer worktree's path. Two
// sources that disagree give none.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findIssue, readTitle } from "../issue.ts";
import { cleanup, scratch, seams, TITLE, writeState, workState } from "./helpers.ts";

const dirs: string[] = [];
function repo(): string {
  const d = scratch("issue");
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop() ?? "");
});

const ME = 4242;

describe("the host's variable", () => {
  test("alone, it gives the number", () => {
    expect(findIssue(412, seams())).toEqual({ ok: true, issue: 412, sources: ["env"], step: undefined, stateDir: undefined });
  });

  test("it agreeing with the state file gives the number and the state's step", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME, step: "plan" });
    const got = findIssue(412, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }));
    expect(got.ok && got.issue).toBe(412);
    expect(got.ok && got.sources).toEqual(["env", "state"]);
    expect(got.ok && got.step).toBe("plan");
  });

  test("it disagreeing with the state file gives none: ambiguous", () => {
    const root = repo();
    writeState(root, { issue: 413, ownerPid: ME });
    expect(findIssue(412, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }))).toEqual({ ok: false, reason: "ambiguous" });
  });
});

describe("the driver's state file", () => {
  test("the one file owned by the parent gives the number", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME, step: "develop" });
    const got = findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }));
    expect(got).toEqual({
      ok: true,
      issue: 412,
      sources: ["state"],
      step: "develop",
      stateDir: join(root, ".pi", "work-state"),
    });
  });

  test("a stale file of an earlier cycle is not read: its owner is another process", () => {
    const root = repo();
    writeState(root, { issue: 3, ownerPid: 99 });
    expect(findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }))).toEqual({ ok: false, reason: "none" });
  });

  test("a stale file beside the live one does not make it ambiguous", () => {
    const root = repo();
    writeState(root, { issue: 3, ownerPid: 99 });
    writeState(root, { issue: 412, ownerPid: ME });
    const got = findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }));
    expect(got.ok && got.issue).toBe(412);
  });

  test("two files owned by the parent: ambiguous", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME });
    writeState(root, { issue: 414, ownerPid: ME });
    expect(findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }))).toEqual({ ok: false, reason: "ambiguous" });
  });

  test("only <N>.json names are state files; the driver's side files are not", () => {
    const root = repo();
    const dir = workState(root);
    // Side files with an owner field that would match, to show the name rule alone rejects them.
    writeFileSync(join(dir, "base-health.json"), JSON.stringify({ issue: 7, owner: { pid: ME } }));
    writeFileSync(join(dir, "412.json.tmp"), JSON.stringify({ issue: 412, owner: { pid: ME } }));
    mkdirSync(join(dir, "415.json"));
    expect(findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }))).toEqual({ ok: false, reason: "none" });
  });

  test("a file whose issue field disagrees with its name is not read", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME, innerIssue: 999 });
    expect(findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }))).toEqual({ ok: false, reason: "none" });
  });

  test("a file that is not JSON is not read and does not throw", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME, raw: "{not json" });
    expect(findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root } }))).toEqual({ ok: false, reason: "none" });
  });

  test("when no file names the parent, an ancestor that owns one is taken (a shell wrapper between)", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: 100 });
    const chain: Record<number, number> = { [ME]: 300, 300: 100, 100: 1 };
    const got = findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root }, parentOf: (p) => chain[p] }));
    expect(got.ok && got.issue).toBe(412);
  });

  test("the ancestor walk stops at pid 1 and at a loop", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: 1 });
    const loop: Record<number, number> = { [ME]: 300, 300: ME };
    expect(
      findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root }, parentOf: (p) => loop[p] })),
    ).toEqual({ ok: false, reason: "none" });
    const toInit: Record<number, number> = { [ME]: 1 };
    expect(
      findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root }, parentOf: (p) => toInit[p] })),
    ).toEqual({ ok: false, reason: "none" });
  });

  test("without PI_ENSEMBLE_WORKSPACE_ROOT, the main repository from git is used", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME });
    const asked: string[] = [];
    const got = findIssue(
      undefined,
      seams({
        cwd: "/review/checkout",
        repoRoot: (cwd) => {
          asked.push(cwd);
          return root;
        },
      }),
    );
    expect(asked).toEqual(["/review/checkout"]);
    expect(got.ok && got.issue).toBe(412);
  });

  test("with PI_ENSEMBLE_WORKSPACE_ROOT set, git is not asked", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME });
    let asked = false;
    findIssue(
      undefined,
      seams({
        env: { PI_ENSEMBLE_WORKSPACE_ROOT: root },
        repoRoot: () => {
          asked = true;
          return undefined;
        },
      }),
    );
    expect(asked).toBe(false);
  });

  test("no work-state directory: none, and no throw", () => {
    expect(findIssue(undefined, seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: repo() } }))).toEqual({ ok: false, reason: "none" });
  });
});

describe("the developer worktree's path", () => {
  test(".worktrees/issue-<N>-<name> gives the number", () => {
    const got = findIssue(undefined, seams({ cwd: "/repo/.worktrees/issue-412-default" }));
    expect(got.ok && got.issue).toBe(412);
    expect(got.ok && got.sources).toEqual(["cwd"]);
  });

  test("a subdirectory of the worktree gives it too", () => {
    const got = findIssue(undefined, seams({ cwd: "/repo/.worktrees/issue-412-api/src/lib" }));
    expect(got.ok && got.issue).toBe(412);
  });

  test("other paths give nothing", () => {
    for (const cwd of ["/repo", "/repo/worktrees/issue-412-default", "/repo/.worktrees/issue-412", "/tmp/pi-rukas-review-ab12"]) {
      expect(findIssue(undefined, seams({ cwd }))).toEqual({ ok: false, reason: "none" });
    }
  });

  test("it disagreeing with the state file: ambiguous", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME });
    const got = findIssue(
      undefined,
      seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root }, cwd: join(root, ".worktrees", "issue-413-default") }),
    );
    expect(got).toEqual({ ok: false, reason: "ambiguous" });
  });

  test("it agreeing with the state file: both are named", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME });
    const got = findIssue(
      undefined,
      seams({ env: { PI_ENSEMBLE_WORKSPACE_ROOT: root }, cwd: join(root, ".worktrees", "issue-412-default") }),
    );
    expect(got.ok && got.sources).toEqual(["state", "cwd"]);
  });
});

test("the branch is not a source: children run on a detached HEAD or on main", () => {
  // A cwd that only a branch-name rule would match gives nothing.
  expect(findIssue(undefined, seams({ cwd: "/repo/feature/issue-412-add-subtract" }))).toEqual({ ok: false, reason: "none" });
});

describe("the title", () => {
  test("is the first line of the issue-body file the driver wrote", () => {
    const root = repo();
    writeState(root, { issue: 412, ownerPid: ME, title: TITLE, body: "the body" });
    expect(readTitle(join(root, ".pi", "work-state"), 412)).toBe(TITLE);
  });

  test("is undefined with no file, no directory, or an empty first line", () => {
    const root = repo();
    const dir = workState(root);
    expect(readTitle(dir, 412)).toBeUndefined();
    expect(readTitle(undefined, 412)).toBeUndefined();
    mkdirSync(join(dir, "412"));
    writeFileSync(join(dir, "412", "issue-body.txt"), "\n\nbody only");
    expect(readTitle(dir, 412)).toBeUndefined();
  });

  test("reads only the start of a large file", () => {
    const root = repo();
    const dir = workState(root);
    mkdirSync(join(dir, "412"));
    writeFileSync(join(dir, "412", "issue-body.txt"), `Short title\n\n${"b".repeat(5_000_000)}`);
    expect(readTitle(dir, 412)).toBe("Short title");
  });
});
