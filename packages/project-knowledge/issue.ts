// The issue number. A child is not told its issue, so the polyfill finds it, from what a real
// cycle showed a child can see:
//
// 1. `PI_ENSEMBLE_KNOWLEDGE_ISSUE`, when a host sets it.
// 2. The driver's state file `<N>.json` in `.pi/work-state/`, under `PI_ENSEMBLE_WORKSPACE_ROOT`
//    or else the main repository git names. Only a file whose `owner.pid` is this child's parent
//    (or, behind a wrapper, an ancestor) counts: a state file outlives its cycle.
// 3. The developer worktree's path, `.worktrees/issue-<N>-<name>`.
//
// The branch is not a source: children run on a detached HEAD or on the base branch.
// Every source that gives a number must give the same one. A wrong number would join what was
// served to the wrong outcome, so no number is better than a guess.
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { IssueFound, IssueSeams, IssueSource } from "./types.ts";

const STATE_NAME = /^(\d+)\.json$/;
const WORKTREE_SEGMENT = /^issue-(\d+)-./;
/** A state file is a few kilobytes. A larger one is not the driver's and is not read. */
const MAX_STATE_BYTES = 4 * 1024 * 1024;
/** How far up the process tree an owner is looked for: a wrapper or two, not the whole tree. */
const MAX_ANCESTORS = 4;
const TITLE_READ_BYTES = 4096;

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function positive(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}

interface StateFile {
  issue: number;
  ownerPid: number;
  step: string | undefined;
}

function readState(dir: string, name: string, issue: number): StateFile | undefined {
  const path = join(dir, name);
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_STATE_BYTES) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object") return undefined;
    const o = parsed as Record<string, unknown>;
    // The file's name and its own issue field must agree.
    if (o.issue !== issue) return undefined;
    const owner = o.owner as Record<string, unknown> | undefined;
    if (owner === null || typeof owner !== "object" || !positive(owner.pid)) return undefined;
    const pipeline = o.pipelineState as Record<string, unknown> | undefined;
    const step = pipeline !== null && typeof pipeline === "object" && typeof pipeline.currentStep === "string"
      ? pipeline.currentStep
      : undefined;
    return { issue, ownerPid: owner.pid, step };
  } catch {
    return undefined;
  }
}

function stateFiles(dir: string): StateFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: StateFile[] = [];
  for (const name of names) {
    const m = STATE_NAME.exec(name);
    if (m === null) continue;
    const issue = Number(m[1]);
    if (!positive(issue)) continue;
    const file = readState(dir, name, issue);
    if (file !== undefined) out.push(file);
  }
  return out;
}

/** The pids to match an owner against, nearest first: the parent, then a few of its ancestors. */
function owners(s: IssueSeams): number[] {
  const out: number[] = [];
  let pid: number | undefined = s.ppid;
  while (positive(pid) && pid !== 1 && !out.includes(pid) && out.length <= MAX_ANCESTORS) {
    out.push(pid);
    pid = s.parentOf(pid);
  }
  return out;
}

type FromState = { kind: "one"; file: StateFile } | { kind: "none" } | { kind: "ambiguous" };

/** The live state file: the files owned by the nearest owner that owns any. Two of them: ambiguous. */
function liveState(dir: string, s: IssueSeams): FromState {
  const files = stateFiles(dir);
  if (files.length === 0) return { kind: "none" };
  for (const pid of owners(s)) {
    const mine = files.filter((f) => f.ownerPid === pid);
    if (mine.length === 1 && mine[0] !== undefined) return { kind: "one", file: mine[0] };
    if (mine.length > 1) return { kind: "ambiguous" };
  }
  return { kind: "none" };
}

function fromCwd(cwd: string): number | undefined {
  const parts = cwd.split(sep);
  for (let i = 0; i + 1 < parts.length; i++) {
    if (parts[i] !== ".worktrees") continue;
    const m = WORKTREE_SEGMENT.exec(parts[i + 1] ?? "");
    if (m !== null) {
      const n = Number(m[1]);
      if (positive(n)) return n;
    }
  }
  return undefined;
}

function workStateDir(s: IssueSeams): string | undefined {
  const fromEnv = s.env.PI_ENSEMBLE_WORKSPACE_ROOT;
  const root = fromEnv !== undefined && fromEnv !== "" ? fromEnv : s.repoRoot(s.cwd);
  if (root === undefined || root === "") return undefined;
  const dir = join(root, ".pi", "work-state");
  return isDir(dir) ? dir : undefined;
}

export function findIssue(override: number | undefined, s: IssueSeams): IssueFound {
  const found: { source: IssueSource; issue: number }[] = [];
  if (override !== undefined) found.push({ source: "env", issue: override });

  const stateDir = workStateDir(s);
  let step: string | undefined;
  if (stateDir !== undefined) {
    const live = liveState(stateDir, s);
    if (live.kind === "ambiguous") return { ok: false, reason: "ambiguous" };
    if (live.kind === "one") {
      found.push({ source: "state", issue: live.file.issue });
      step = live.file.step;
    }
  }

  const cwdIssue = fromCwd(s.cwd);
  if (cwdIssue !== undefined) found.push({ source: "cwd", issue: cwdIssue });

  const first = found[0];
  if (first === undefined) return { ok: false, reason: "none" };
  if (found.some((f) => f.issue !== first.issue)) return { ok: false, reason: "ambiguous" };
  return { ok: true, issue: first.issue, sources: found.map((f) => f.source), step, stateDir };
}

/**
 * The issue's title: the first line of `<N>/issue-body.txt`, which the driver writes as the title,
 * a blank line, then the body. Only the start of the file is read; the body is never kept.
 */
export function readTitle(stateDir: string | undefined, issue: number): string | undefined {
  if (stateDir === undefined) return undefined;
  const path = join(stateDir, String(issue), "issue-body.txt");
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(TITLE_READ_BYTES);
    const n = readSync(fd, buf, 0, TITLE_READ_BYTES, 0);
    const first = buf.subarray(0, n).toString("utf8").split("\n")[0]?.trim() ?? "";
    return first === "" ? undefined : first;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Nothing to do: the read is over either way.
      }
    }
  }
}

/** The parent of a pid, from `/proc`. Undefined where there is no `/proc`. */
export function parentOf(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name is in parentheses and may hold spaces, so fields are counted after the last ")".
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ppid = Number(rest[1]);
    return positive(ppid) ? ppid : undefined;
  } catch {
    return undefined;
  }
}

/** The main repository's root, from git's common directory. A review checkout in `/tmp` finds it too. */
export function repoRoot(cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
    if (out === "") return undefined;
    const common = isAbsolute(out) ? out : resolve(cwd, out);
    return dirname(common);
  } catch {
    return undefined;
  }
}
