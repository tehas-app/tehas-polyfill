// The tracker's decision core (spec S7, PROCESS.md step 6): given one polyfill record and what
// upstream looks like now, name the PRs and issues to file. It files nothing itself and never
// repeats a title that is already open.

import { alreadyOpen } from "./state";
import type { OpenTitles, PolyfillRecord, TrackAction, UpstreamState } from "./types";

/** PROCESS.md: a polyfill still `active` 60 days after it was added gets a reminder issue. */
const REMINDER_AFTER_DAYS = 60;
/** gh compare statuses that mean a release already carries the merge commit (spec S7). */
const CONTAINED_STATUSES = new Set(["behind", "identical"]);
/**
 * Upstream labels that mean "this issue is parked: nobody is working on it" (trail-openers/pi-rukas
 * uses `frozen` for exactly that). Labels are repository-local, so the set lives here rather than
 * scattered through the decisions, and `wontfix` is deliberately absent: an open refusal is not a
 * decline, and PROCESS.md step 6.3 maps only a closed-without-a-merge to `declined`.
 */
export const NOT_TAKEN_ON_LABELS = new Set(["frozen"]);
/** The upstream signal a parked decision names, so a reader can tell it from "open, not overdue". */
export const PARKED_SIGNAL = "open and not taken on";

interface MergedPr {
  number: number;
  mergeCommit: string;
}

/** A `gh api .../compare/<tag>...<sha>` status that says the tag contains the commit. */
export function containsCommit(status: string): boolean {
  return CONTAINED_STATUSES.has(status);
}

/**
 * Whether an upstream issue is taken on. Only an explicit not-taken-on label says otherwise: a
 * missing or empty label list is a wait, not a decline (labels are repository-local, so their
 * absence carries no information). Compared case-insensitively, because a label's spelling belongs
 * to whoever created it.
 */
export function takenOn(labels: string[]): boolean {
  return !labels.some((label) => NOT_TAKEN_ON_LABELS.has(label.toLowerCase()));
}

/**
 * The upstream signal for an open issue, as a run reports it: the label it read when it decided to
 * file nothing, so "open and parked" is distinguishable from "open, not overdue" without a new
 * filed issue. A parked issue keeps its labels in the order upstream lists them.
 */
export function upstreamSignal(up: UpstreamState): string {
  if (up.state !== "open") return up.mergedPr === null ? "closed without a merge" : "closed with a merged pull request";
  if (takenOn(up.labels)) return "open and taken on";
  const parked = up.labels.filter((label) => NOT_TAKEN_ON_LABELS.has(label.toLowerCase()));
  // The names are lower-cased on the way out: they are quoted into a log line, and a name in some
  // other spelling is a string a reader cannot search for.
  return `${PARKED_SIGNAL} (${parked.map((label) => label.toLowerCase()).join(", ")})`;
}

/** `trail-openers/pi-rukas#2020`, as a PR title reads it: `pi-rukas#2020`. */
function shortIssue(issue: string): string {
  return issue.split("/").pop() ?? issue;
}

/** The upstream repository alone, so a pull request can be named: `pi-rukas`. */
function upstreamRepo(issue: string): string {
  const repo = shortIssue(issue).split("#")[0];
  return repo === "" ? issue : repo;
}

function upstreamLine(pkg: PolyfillRecord, mergedPr?: MergedPr, until?: string): string[] {
  const lines = [`Upstream issue: ${pkg.upstreamIssue}`];
  if (mergedPr !== undefined) {
    lines.push(`Merged pull request: ${upstreamRepo(pkg.upstreamIssue)}#${mergedPr.number} (merge commit ${mergedPr.mergeCommit})`);
  }
  if (until !== undefined) lines.push(`First pi-rukas release containing it: ${upstreamRepo(pkg.upstreamIssue)} ${until}`);
  return lines;
}

/** A PR here is a proposal: the tracker never merges it (spec S7). */
function prNote(pkg: PolyfillRecord, patch: Record<string, unknown>): string {
  const sets = Object.entries(patch).map(([key, value]) => `\`${key}: ${JSON.stringify(value)}\``).join(" and ");
  return `This PR sets ${sets} in ${pkg.path}, per PROCESS.md step 6. It does not merge itself, and it changes no other file.`;
}

function mergedHere(pkg: PolyfillRecord, mergedPr: MergedPr): TrackAction {
  const patch = { state: "merged", pr: mergedPr.number };
  return {
    kind: "pr-merged",
    title: `${pkg.name}: upstream merged (${shortIssue(pkg.upstreamIssue)})`,
    body: [
      `${upstreamRepo(pkg.upstreamIssue)} closed ${shortIssue(pkg.upstreamIssue)} with a merged pull request, so the polyfill is waiting on a release.`,
      upstreamLine(pkg, mergedPr).join("\n"),
      prNote(pkg, patch),
    ].join("\n\n"),
    patch,
  };
}

function releasedHere(pkg: PolyfillRecord, mergedPr: MergedPr, until: string): TrackAction {
  const patch = { state: "released", until };
  return {
    kind: "pr-released",
    title: `${pkg.name}: upstream released (${upstreamRepo(pkg.upstreamIssue)} ${until})`,
    body: [
      `${upstreamRepo(pkg.upstreamIssue)} ${until} ships the feature natively, so the polyfill is no longer needed.`,
      upstreamLine(pkg, mergedPr, until).join("\n"),
      prNote(pkg, patch),
    ].join("\n\n"),
    patch,
  };
}

function declinedHere(pkg: PolyfillRecord): TrackAction {
  const patch = { state: "declined" };
  return {
    kind: "pr-declined",
    title: `${pkg.name}: upstream closed without a merge (${shortIssue(pkg.upstreamIssue)})`,
    body: [
      `${upstreamRepo(pkg.upstreamIssue)} closed ${shortIssue(pkg.upstreamIssue)} without merging a pull request, so the polyfill will not be retired by a release.`,
      upstreamLine(pkg).join("\n"),
      prNote(pkg, patch),
      "PROCESS.md: a polyfill never quietly becomes permanent. The paired tehas issue decides what happens instead.",
    ].join("\n\n"),
    patch,
  };
}

function retireIssue(pkg: PolyfillRecord, until: string): TrackAction {
  return {
    kind: "issue-retire",
    title: `Retire polyfill ${pkg.name}: ${upstreamRepo(pkg.upstreamIssue)} ${until} ships ${pkg.upstreamIssue}`,
    body: [
      `${upstreamRepo(pkg.upstreamIssue)} ${until} ships ${pkg.upstreamIssue} natively, so ${pkg.name} can be retired (PROCESS.md step 7).`,
      upstreamLine(pkg, undefined, until).join("\n"),
      `Check the native feature against the polyfill's tests on ${until}.`,
      `Read the fact a host can observe today: the base image's /opt/pi-rukas/bin/pi-rukas-headless --capabilities answer lists ${pkg.upstreamFeature}, which is what tehas scripts/polyfills.sh decides expiry from.`,
      `Rebuild any image that carries the package without it and without its tehas.rukas.polyfills entry (PROCESS.md step 5: tehas reads the label but writes none, and keeps no version pin for this repository). Then delete ${pkg.path.slice(0, pkg.path.lastIndexOf("/"))}/ here.`,
    ].join("\n\n"),
  };
}

function decideIssue(pkg: PolyfillRecord): TrackAction {
  return {
    kind: "issue-decide",
    title: `Decide what replaces polyfill ${pkg.name}: ${pkg.upstreamIssue} closed without a merge`,
    body: [
      `${pkg.upstreamIssue} was closed without a merged pull request, so ${pkg.name} will not be retired by a pi-rukas release.`,
      upstreamLine(pkg).join("\n"),
      "Decide which it is: move the behaviour into tehas properly, or drop it. PROCESS.md step 6.3.",
    ].join("\n\n"),
  };
}

function reminder(pkg: PolyfillRecord, ageDays: number): TrackAction {
  return {
    kind: "issue-reminder",
    // No age in the title: idempotence is an exact title match, and an age changes every day, so
    // a titled-by-age reminder would be filed again tomorrow. The age belongs in the body.
    title: `Polyfill ${pkg.name} is still active`,
    body: [
      `${pkg.name} has been active for ${ageDays} days (PROCESS.md: a reminder after ${REMINDER_AFTER_DAYS}).`,
      upstreamLine(pkg).join("\n"),
      `Decide whether to keep waiting for ${pkg.upstreamIssue}, replace it in tehas, or drop it.`,
    ].join("\n\n"),
  };
}

/** Idempotence (spec S7): a title that is already open on that side is not filed again. */
function fileable(actions: TrackAction[], open: OpenTitles): TrackAction[] {
  return actions.filter((action) => !alreadyOpen(action.kind.startsWith("pr-") ? open.prs : open.issues, action.title));
}

/**
 * What the tracker would do for one package.
 *
 * `contained` is the release tags whose compare status was `behind` or `identical`, oldest first:
 * the first becomes `until`. `ageDays` is the age of the record's first commit.
 */
export function decidePackage(
  pkg: PolyfillRecord,
  up: UpstreamState,
  contained: string[],
  ageDays: number,
  open: OpenTitles,
): TrackAction[] {
  // Only an installed polyfill is tracked; released and declined are already decided.
  if (pkg.state !== "active" && pkg.state !== "merged") return [];
  // A merged record that already carries an until has nothing left to wait for.
  if (pkg.state === "merged" && pkg.until !== null) return [];

  if (up.state === "closed") {
    const mergedPr = up.mergedPr;
    if (mergedPr === null) {
      if (pkg.state !== "active") return [];
      return fileable([declinedHere(pkg), decideIssue(pkg)], open);
    }
    // An active record always goes merged first: the state machine moves one human step at a time.
    if (pkg.state === "active") return fileable([mergedHere(pkg, mergedPr)], open);
    const until = contained[0];
    if (until === undefined) return [];
    return fileable([releasedHere(pkg, mergedPr, until), retireIssue(pkg, until)], open);
  }

  // Upstream is still open. An issue that is explicitly not taken on - a frozen proposal - files
  // nothing at all, not even the reminder: PROCESS.md's 60-day reminder is a promise about work
  // upstream has taken on, and tehas only polyfills work upstream has accepted. The reading is
  // recomputed every run from the label it just read, so upstream removing the label has the
  // package reminder-eligible again on the next run with no change to polyfill.json.
  if (!takenOn(up.labels)) return [];
  // The only action on an open, taken-on issue is the 60-day reminder, and only for an active record.
  if (pkg.state === "active" && ageDays >= REMINDER_AFTER_DAYS) return fileable([reminder(pkg, ageDays)], open);
  return [];
}
