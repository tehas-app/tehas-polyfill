#!/usr/bin/env bun
// The tracking entry (spec S7, PROCESS.md step 6): read each tracked polyfill record, ask
// decide.ts what to file, and file it through forge.ts. A record changes only on the branch a
// proposed PR carries, never in the checkout this run is standing in.
//
// Exit codes: 0 nothing failed (including "nothing to do"), 2 a bad flag or a call that failed.
// A failed run leaves every polyfill.json byte-identical: forge.ts puts the working tree back, and
// the PR that would have carried a patch was never opened.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { containsCommit, decidePackage, upstreamSignal } from "./lib/decide";
import { compareStatus, defaultBranch, fetchUpstream, filePr, gitOf, issueRepo, listTags, localRepo, openIssue, openTitles, prBranch, requireTehasToken, tehasRepo } from "./lib/forge";
import { applyPatch, firstCommitAgeDays, trackedPackages } from "./lib/state";
import { isReleaseTag, releasesAtOrAfter } from "./lib/releases";
import type { GitRunner, PatchProposal, TrackRunOpts } from "./lib/forge";
import type { OpenTitles, PolyfillRecord, TrackAction, UpstreamState } from "./lib/types";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const USAGE = "usage: bun run scripts/track.ts [--dry-run]";

function say(line: string): void {
  console.log(line);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error);
}

function die(message: string): never {
  process.stderr.write(`track: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): TrackRunOpts {
  const o: TrackRunOpts = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") o.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else die(`unknown argument ${arg}`);
  }
  return o;
}

/** A PR proposal is filed here; a retire / decide / reminder issue is filed on tehas. */
function isPr(action: TrackAction): boolean {
  return action.kind.startsWith("pr-");
}

function describe(pkg: PolyfillRecord, action: TrackAction): string {
  return isPr(action)
    ? `${pkg.name}: would open PR "${action.title}"`
    : `${pkg.name}: would file issue "${action.title}"`;
}

function filed(pkg: PolyfillRecord, action: TrackAction): string {
  return isPr(action) ? `${pkg.name}: opened PR "${action.title}"` : `${pkg.name}: filed issue "${action.title}"`;
}

/**
 * The release tags that already carry `mergeCommit`: every upstream release at or after the
 * record's `from`, oldest first, with no cap - the newest-12 window is the probe's, not the
 * tracker's, and the release that carries the commit can be older than it. The scan stops at the
 * first hit, which is the tag `decidePackage` makes the record's `until` (spec S7).
 */
function containingTags(root: string, pkg: PolyfillRecord, mergeCommit: string, listTagsOf: (repo: string) => string[], compareTag: (tag: string, sha: string) => string): string[] {
  const repo = issueRepo(pkg.upstreamIssue);
  for (const tag of releasesAtOrAfter(pkg.from, listTagsOf(repo))) {
    if (containsCommit(compareTag(tag, mergeCommit))) return [tag];
  }
  return [];
}

/** The bytes one action's patch produces, on the branch that action's PR is opened from. */
function proposalOf(root: string, world: World, base: string, pkg: PolyfillRecord, action: TrackAction): PatchProposal {
  const patch = action.patch;
  if (patch === undefined) throw new Error(`${action.kind}: a pull request action carries no patch to write`);
  return {
    repo: world.here(),
    base,
    branch: prBranch(pkg.name, action.kind),
    path: pkg.path,
    content: applyPatch(readFileSync(join(root, pkg.path), "utf8"), patch),
    title: action.title,
    body: action.body,
  };
}

/**
 * The real open-titles read. A run that reaches tehas for real reaches it with the cross-repo
 * credential: a token that cannot see the repository must not answer "nothing open" and let a
 * duplicate through. A dry run files nothing, so it may read with whatever credential `gh` has.
 */
function openTitlesReal(root: string, o: TrackRunOpts): (repo: string, kind: "pr" | "issue") => string[] {
  return (repo, kind) => openTitles(root, repo, kind, repo === tehasRepo() && !o.dryRun ? { GH_TOKEN: requireTehasToken() } : undefined);
}

/** One read per repository and kind per run, whichever source answers it. */
function memoized(source: (repo: string, kind: "pr" | "issue") => string[]): (repo: string, kind: "pr" | "issue") => string[] {
  const cache = new Map<string, string[]>();
  return (repo, kind) => {
    const key = `${repo}\u0000${kind}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const titles = source(repo, kind);
    cache.set(key, titles);
    return titles;
  };
}

/**
 * One tracking run. Every seam in `TrackOpts` plus the filing, release-list and git seams forge.ts
 * declares is injectable, which is what keeps the tests offline; a run with no seam supplied and no
 * `--dry-run` makes the real `gh` and `git` calls.
 */
export function runTrack(root: string, o: TrackRunOpts): number {
  const now = o.now ?? new Date();
  const tehas = tehasRepo();

  const git = gitOf(root, o);
  // The repository the tracker runs in, named only when a call needs it: a reminder-only run never
  // opens a PR and never asks.
  const here = () => localRepo(git);
  const fetch = o.fetchUpstream ?? ((issue: string) => fetchUpstream(root, issueRepo(issue), issue));
  const readOpen = memoized(o.listOpen ?? openTitlesReal(root, o));
  const listTagsOf = o.listTags ?? ((repo: string) => listTags(root, repo));
  const fileIssue = o.openIssue ?? ((repo: string, title: string, body: string) => openIssue(root, repo, title, body));

  for (const pkg of trackedPackages(root)) {
    if (!isReleaseTag(pkg.from)) {
      // A `from` that is not a release tag makes every comparison return nothing, so a merged
      // package with one can never be found released. Say it, rather than deciding from an empty
      // list as if upstream had released nothing.
      process.stderr.write(`track: ${pkg.name}: from "${pkg.from}" is not a pi-rukas release tag (v<major>.<minor>.<patch>): no upstream release can be matched\n`);
    }
    try {
      trackPackage(root, pkg, o, { now, here, tehas, git, fetch, readOpen, listTagsOf, fileIssue });
    } catch (error) {
      // A failed call is exit 2. forge.ts put the working tree back, and this package's patch is on
      // no branch: the PR that would have carried it was never opened.
      process.stderr.write(`track: ${pkg.name}: ${errorText(error)}\n`);
      return 2;
    }
  }
  return 0;
}

/** The world one run reaches: the seams, resolved to either an injected one or the real call. */
interface World {
  now: Date;
  here: () => string;
  tehas: string;
  git: GitRunner;
  fetch: (issue: string) => UpstreamState;
  readOpen: (repo: string, kind: "pr" | "issue") => string[];
  listTagsOf: (repo: string) => string[];
  fileIssue: (repo: string, title: string, body: string) => void;
}

/** One package: ask, then file. A throw anywhere here leaves the checkout as it found it. */
function trackPackage(root: string, pkg: PolyfillRecord, o: TrackRunOpts, world: World): void {
  const upstream = issueRepo(pkg.upstreamIssue);
  const compareTag = o.compare ?? ((tag: string, sha: string) => compareStatus(root, upstream, tag, sha));

  const up = world.fetch(pkg.upstreamIssue);
  // Open PRs are this repository's, open issues are tehas'. Both gate the same title check, and
  // both are read on demand: `decidePackage` only looks at the half an action files into, so a run
  // that files a PR never lists tehas issues and a reminder never lists PRs.
  const open: OpenTitles = {
    get prs() {
      return world.readOpen(world.here(), "pr");
    },
    get issues() {
      return world.readOpen(world.tehas, "issue");
    },
  };
  const ageDays = firstCommitAgeDays(root, pkg.path, world.now);

  // Only a `merged` record still waiting on a release needs the release list (spec S7).
  const contained =
    pkg.state === "merged" && pkg.until === null && up.mergedPr !== null
      ? containingTags(root, pkg, up.mergedPr.mergeCommit, world.listTagsOf, compareTag)
      : [];

  const actions = decidePackage(pkg, up, contained, ageDays, open);
  if (actions.length === 0) {
    // The upstream signal the decision read, so a reader can tell "open and parked" from "open, not
    // overdue" without a filed issue. `upstreamSignal` names the closed states too, but a closed
    // package always files something here, so the line a run prints is an open one's.
    say(`${pkg.name}: nothing to do (${upstreamSignal(up)})`);
    return;
  }

  // A filing on tehas is cross-repo, so it needs a credential of its own. Without it this package
  // files nothing at all - not even its PR, and no branch is written - and the run is red rather
  // than quietly skipping (R2).
  if (!o.dryRun && actions.some((action) => !isPr(action))) requireTehasToken();

  // The branch a PR is proposed against is only named when a patch is actually filed: a reminder
  // run touches no branch, and a dry run touches nothing.
  const base = !o.dryRun && actions.some(isPr) ? defaultBranch(root, world.git) : "";

  for (const action of actions) {
    if (o.dryRun) {
      say(describe(pkg, action));
      continue;
    }
    // A PR carries the patch, written on a branch of its own; a retire / decide / reminder is an issue.
    if (isPr(action)) filePr(root, proposalOf(root, world, base, pkg, action), o);
    else world.fileIssue(world.tehas, action.title, action.body);
    say(filed(pkg, action));
  }
}

function main(): void {
  const o = parseArgs(process.argv.slice(2));
  try {
    process.exit(runTrack(ROOT, o));
  } catch (error) {
    die(errorText(error));
  }
}

// The entry only runs itself: the tests import `runTrack` from here.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === SELF) main();
