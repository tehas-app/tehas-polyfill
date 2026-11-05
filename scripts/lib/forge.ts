// The tracker's calls out (spec S7): the `gh` and `git` argument lists, the runners that run them,
// and the seams `runTrack` needs beyond spec S9's TrackOpts. Nothing here decides anything -
// decide.ts does that - and nothing here merges a pull request or applies a label.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseTagNames } from "./releases";
import type { OpenTitles, TrackOpts, UpstreamState } from "./types";

const GH_TIMEOUT_MS = 60_000;
const GIT_TIMEOUT_MS = 60_000;
/** Where the retire / decide / reminder issues go (track.yml's TEHAS_REPO). */
const DEFAULT_TEHAS_REPO = "tehas-app/tehas";
/** `gh pr|issue list` returns 30 titles unless told otherwise; idempotence needs the open ones. */
const OPEN_LIST_LIMIT = 200;

/** One filing, as a seam reports it: what would be opened, for tests that never call gh. */
export interface Filed {
  repo: string;
  title: string;
  body: string;
}

/**
 * One patch the tracker proposes, as forge.ts writes and files it. The change lives on `branch`;
 * the checkout the tracker runs in is left as it found it (spec S7: it proposes, it does not apply).
 */
export interface PatchProposal extends Filed {
  /** The branch the PR is opened against: the one the tracker is checked out on. */
  base: string;
  /** The branch the patch lands on: one per action, never reused for a different patch. */
  branch: string;
  /** The one file the branch touches, relative to the repository root. */
  path: string;
  /** Its new bytes: exactly what `applyPatch` produced. */
  content: string;
}

/** A git call, as a seam sees it: the argument list, and git's stdout. */
export type GitRunner = (args: string[]) => string;

/**
 * The seams spec S9 does not carry, declared here so `scripts/lib/types.ts` stays as written: the
 * release list, the git write, and the two filings. A supplied seam always wins; with no seam and
 * no `--dry-run` the real call runs - never a silent skip.
 */
export interface ForgeSeams {
  listTags?: (repo: string) => string[];
  /** Every git call goes through here, which is what keeps the branch write testable offline. */
  git?: GitRunner;
  /** One pull request filing: the branch is written first, then the PR that proposes it is opened. */
  openPr?: (proposal: PatchProposal) => void;
  openIssue?: (repo: string, title: string, body: string) => void;
}

/** What `runTrack` takes: spec S9's TrackOpts plus the seams above. */
export type TrackRunOpts = TrackOpts & ForgeSeams;

/** `trail-openers/pi-rukas#2020` -> `trail-openers/pi-rukas`. */
export function issueRepo(upstreamIssue: string): string {
  return upstreamIssue.split("#")[0] || upstreamIssue;
}

/** `trail-openers/pi-rukas#2020` -> `2020`. */
export function issueNumber(upstreamIssue: string): string {
  const parts = upstreamIssue.split("#");
  return parts.length > 1 ? parts[1] : parts[0];
}

/**
 * The repository the tracker opens its PRs on: `GITHUB_REPOSITORY` first, because that is what a
 * GitHub Actions run names, then the checkout's own origin remote. An unresolvable repository is a
 * named failure, never a guess from the directory the process happens to stand in.
 */
export function localRepo(git: GitRunner): string {
  const fromEnv = process.env.GITHUB_REPOSITORY ?? "";
  if (fromEnv !== "") return fromEnv;

  let url = "";
  try {
    url = git(remoteUrlArgs());
  } catch {
    url = "";
  }
  const repo = remoteRepo(url);
  if (repo === undefined) throw new Error("cannot name the repository the tracker runs in: set GITHUB_REPOSITORY or configure an origin remote");
  return repo;
}

export function remoteUrlArgs(): string[] {
  return ["remote", "get-url", "origin"];
}

/** `https://github.com/acme/polyfills.git` and `git@github.com:acme/polyfills.git` -> `acme/polyfills`. */
function remoteRepo(url: string): string | undefined {
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m === null ? undefined : m[1];
}

export function tehasRepo(): string {
  return process.env.TEHAS_REPO ?? DEFAULT_TEHAS_REPO;
}

/**
 * The credential a call on another repository needs. `github.token` is scoped to the repository
 * the workflow runs in, so it cannot read or file on tehas (R2).
 */
export function tehasToken(): string | undefined {
  const token = process.env.TEHAS_TRACKING_TOKEN ?? "";
  return token === "" ? undefined : token;
}

/** A cross-repo call with no credential is a red run: never a silent skip, never the workflow token. */
export function requireTehasToken(): string {
  const token = tehasToken();
  if (token === undefined) throw new Error(`TEHAS_TRACKING_TOKEN is not set: the tracker cannot reach ${tehasRepo()}`);
  return token;
}

/**
 * The branch one action's patch lands on: `track/issue-comments-merged`. The action's own suffix
 * is the last part, so two actions for one package never share a branch, and a branch is never
 * reused for a different patch.
 */
export function prBranch(pkgName: string, kind: string): string {
  return `track/${pkgName}-${kind.replace(/^pr-/, "")}`;
}

// The argument lists. Each one is what a real call would run, so the S7 limits - open things,
// never merge them, never label a tehas issue - are readable from the lists themselves.

export function issueArgs(repo: string, upstreamIssue: string): string[] {
  return ["api", `repos/${repo}/issues/${issueNumber(upstreamIssue)}`];
}

export function listTagsArgs(repo: string): string[] {
  return ["api", `repos/${repo}/releases?per_page=100`];
}

export function compareArgs(repo: string, tag: string, sha: string): string[] {
  return ["api", `repos/${repo}/compare/${tag}...${sha}`, "--jq", ".status"];
}

export function openPrArgs(repo: string, title: string, body: string, head: string, base: string): string[] {
  return ["pr", "create", "--repo", repo, "--base", base, "--head", head, "--title", title, "--body", body];
}

export function openIssueArgs(repo: string, title: string, body: string): string[] {
  return ["issue", "create", repo, "--title", title, "--body", body];
}

export function listOpenArgs(repo: string, kind: "pr" | "issue"): string[] {
  // Without --limit, gh stops at 30 titles and a 31st open PR or issue looks unfiled.
  const args = [kind, "list", "--state", "open", "--json", "title", "--limit", String(OPEN_LIST_LIMIT)];
  return repo === "" ? args : [...args, "--repo", repo];
}

function runGh(cwd: string, args: string[], env?: Record<string, string>): string {
  try {
    return execFileSync("gh", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GH_TIMEOUT_MS,
      env: env === undefined ? process.env : { ...process.env, ...env },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`gh ${args.join(" ")} failed: ${detail}`);
  }
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} is not JSON`);
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** The upstream issue, as `UpstreamState`: closed counts as merged only with a merge commit. */
export function fetchUpstream(root: string, repo: string, upstreamIssue: string): UpstreamState {
  const issue = parseJson(runGh(root, issueArgs(repo, upstreamIssue)), `gh issue ${upstreamIssue}`) as Record<string, unknown>;
  const state = issue.state === "closed" ? "closed" : "open";
  const pull = typeof issue.pull_request === "object" && issue.pull_request !== null ? (issue.pull_request as Record<string, unknown>) : undefined;
  const mergedAt = pull?.merged_at;
  const mergeCommit = pull?.merge_commit_sha;
  // A closed issue with no merged pull request, or a merged one with no commit to look for, is
  // "closed without a merge" (spec S7's third case).
  if (mergedAt === null || mergedAt === undefined || typeof mergeCommit !== "string" || mergeCommit === "") {
    return { state, mergedPr: null };
  }
  const number = Number(pull?.number ?? issueNumber(upstreamIssue));
  return { state, mergedPr: { number: Number.isInteger(number) ? number : 0, mergeCommit } };
}

/**
 * The titles already open on one side, so nothing is filed twice (spec S7). `env` is the credential
 * the call runs with: track.ts supplies the tehas one whenever a real run reaches tehas, so a token
 * that cannot see the repository never answers "nothing open".
 */
export function openTitles(root: string, repo: string, kind: "pr" | "issue", env?: Record<string, string>): string[] {
  const listed = parseJson(runGh(root, listOpenArgs(repo, kind), env), `gh ${kind} list`);
  if (!Array.isArray(listed)) return [];
  return listed.map((row) => field(row, "title")).filter((title): title is string => typeof title === "string");
}

/**
 * pi-rukas release tags, newest first as GitHub lists them. A draft is not a release; a prerelease
 * is. A full page is a failure: an older release could carry the merge commit (spec S7).
 */
export function listTags(root: string, repo: string): string[] {
  return releaseTagNames(parseJson(runGh(root, listTagsArgs(repo)), "gh release list"));
}

/** `gh api .../compare/<tag>...<sha>` status: `behind` or `identical` means the tag carries the commit. */
export function compareStatus(root: string, repo: string, tag: string, sha: string): string {
  return runGh(root, compareArgs(repo, tag, sha)).trim();
}

export function openIssue(root: string, repo: string, title: string, body: string): void {
  // Filing on another repository never falls back to the workflow's token: it runs with the tehas
  // credential or not at all, and a missing one is named (R2).
  runGh(root, openIssueArgs(repo, title, body), repo === tehasRepo() ? { GH_TOKEN: requireTehasToken() } : undefined);
}

// The git side: the branch a patch lands on. The tracker never pushes the branch it was checked
// out on, never stages more than the one record it is proposing, and never merges.

/** The branch the checkout is on, which is the branch a PR is proposed against. */
export function defaultBranchArgs(): string[] {
  return ["rev-parse", "--abbrev-ref", "HEAD"];
}

/**
 * Fetch the proposal branch before reusing it. `push --force-with-lease` leases against
 * `refs/remotes/origin/<branch>`, so a branch left on the remote by a closed proposal PR - never
 * fetched in this run, and ahead of the base branch - makes the push fail with `stale info`. A
 * branch that does not exist yet makes this call fail, which is the ordinary first run: the push is
 * the step that has to work.
 */
export function fetchBranchArgs(branch: string): string[] {
  return ["fetch", "--no-tags", "origin", branch];
}

/**
 * Create or reset: a proposal branch that already exists - one whose PR was closed - is reused,
 * not a fatal error (R3). The tracker never pushes the branch it was checked out on.
 */
export function createBranchArgs(branch: string): string[] {
  return ["switch", "-C", branch];
}

/** One path, named exactly. Never `git add -A`: that is how a tracker would edit files it was not asked to. */
export function addPathArgs(path: string): string[] {
  return ["add", "--", path];
}

export function commitArgs(branch: string, title: string): string[] {
  return ["commit", "-m", `${branch}: ${title}`];
}

/** Leased so a rejected push cannot leave an orphan: it only overwrites what this run fetched. */
export function pushArgs(branch: string): string[] {
  return ["push", "--force-with-lease", "-u", "origin", branch];
}

/** Back to the branch the PR is proposed against, throwing away the tracker's own edit. */
export function switchBackArgs(base: string): string[] {
  return ["switch", "-f", base];
}

function runGit(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr !== "" ? stderr.split("\n")[0] : error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/** The git runner one call uses: the supplied seam, or the real `git` in `root`. */
export function gitOf(root: string, o: ForgeSeams): GitRunner {
  return o.git ?? ((args) => runGit(root, args));
}

/** The checked-out branch, as `gh pr create --base` wants it. */
export function defaultBranch(root: string, git: GitRunner): string {
  const name = git(defaultBranchArgs()).trim();
  if (name === "" || name === "HEAD") throw new Error("cannot name the branch the pull request would propose against");
  return name;
}

/**
 * Write the branch one patch lives on: switch off the checked-out branch, write the one record,
 * stage exactly that path, commit, push. The working tree is put back byte-identical whatever
 * happens after the switch, so a failed run leaves nothing behind (spec S7).
 */
export function writeBranch(root: string, p: PatchProposal, git: GitRunner): void {
  try {
    git(fetchBranchArgs(p.branch));
  } catch {
    // No such branch on the remote yet: there is nothing to lease against, and the push below
    // creates it. Any other fetch failure shows up as the push failing.
  }
  git(createBranchArgs(p.branch));
  const file = join(root, p.path);
  const original = readFileSync(file, "utf8");
  try {
    writeFileSync(file, p.content);
    git(addPathArgs(p.path));
    git(commitArgs(p.branch, p.title));
    git(pushArgs(p.branch));
  } finally {
    git(switchBackArgs(p.base));
    // The bytes the file had before this run, whatever they were: committed or a local edit.
    writeFileSync(file, original);
  }
}

/** The real filing: `gh pr create`, naming the branch writeBranch just pushed. */
export function openPr(root: string, p: PatchProposal): void {
  runGh(root, openPrArgs(p.repo, p.title, p.body, p.branch, p.base));
}

/**
 * One patch action, filed: the branch first, then the pull request that proposes it. A supplied
 * seam replaces either half; with neither seam and no `--dry-run`, both real calls run.
 */
export function filePr(root: string, p: PatchProposal, o: ForgeSeams): void {
  writeBranch(root, p, gitOf(root, o));
  if (o.openPr !== undefined) o.openPr(p);
  else openPr(root, p);
}
