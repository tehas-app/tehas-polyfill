// The tracker's own state: what `packages/*/polyfill.json` says, how a proposed patch is written,
// and what has already been filed (spec S7). Nothing here opens a PR or an issue.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PolyfillRecord } from "./types";

const PACKAGES_DIR = "packages";
const RECORD_NAME = "polyfill.json";
/** S7: the workflow acts on records that are still installed. */
const TRACKED_STATES = new Set(["active", "merged"]);
const GIT_TIMEOUT_MS = 60_000;
/** `git log --date=iso-strict` prints `2026-11-04T12:00:00+00:00`; the space form is `--date=iso`. */
const COMMIT_DATE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function warn(message: string): void {
  console.error(`track: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.message;
  return String(error);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** One record. A bad record is named on stderr and skipped: one unreadable package never stops the run. */
function readRecord(root: string, dirName: string): PolyfillRecord | undefined {
  const relPath = `${PACKAGES_DIR}/${dirName}/${RECORD_NAME}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, relPath), "utf8"));
  } catch (error) {
    warn(`skipping ${relPath}: ${errorText(error)}`);
    return undefined;
  }
  if (!isPlainObject(parsed)) {
    warn(`skipping ${relPath}: not a JSON object`);
    return undefined;
  }

  // Each required string is narrowed where it is read: a type predicate applied to `parsed[field]`
  // in a loop does not narrow the reads that build the record below.
  const name = parsed.name;
  if (!nonEmptyString(name)) {
    warn(`skipping ${relPath}: name is missing`);
    return undefined;
  }
  const state = parsed.state;
  if (!nonEmptyString(state)) {
    warn(`skipping ${relPath}: state is missing`);
    return undefined;
  }
  const from = parsed.from;
  if (!nonEmptyString(from)) {
    warn(`skipping ${relPath}: from is missing`);
    return undefined;
  }
  const upstream = parsed.upstream;
  if (!isPlainObject(upstream) || !nonEmptyString(upstream.issue) || !nonEmptyString(upstream.feature)) {
    warn(`skipping ${relPath}: upstream.issue and upstream.feature are required`);
    return undefined;
  }
  const upstreamIssue = upstream.issue;
  const upstreamFeature = upstream.feature;

  const pr = parsed.pr ?? null;
  if (pr !== null && (typeof pr !== "number" || !Number.isInteger(pr))) {
    warn(`skipping ${relPath}: pr must be a whole number or null`);
    return undefined;
  }
  const until = parsed.until ?? null;
  if (until !== null && !nonEmptyString(until)) {
    warn(`skipping ${relPath}: until must be a tag or null`);
    return undefined;
  }

  return {
    name,
    state,
    from,
    upstreamIssue,
    upstreamFeature,
    pr,
    until,
    path: relPath,
  };
}

/** Every `packages/<name>/polyfill.json` under `root`, in name order, bad ones named and skipped. */
export function readPackages(root: string): PolyfillRecord[] {
  const packagesDir = join(root, PACKAGES_DIR);
  let names: string[];
  try {
    names = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A repository with no packages directory yet has nothing to track (S7).
    if (code !== "ENOENT" && code !== "ENOTDIR") warn(`cannot list ${PACKAGES_DIR}: ${errorText(error)}`);
    return [];
  }

  const records: PolyfillRecord[] = [];
  for (const name of names) {
    const record = readRecord(root, name);
    if (record !== undefined) records.push(record);
  }
  return records;
}

/** The records the tracker may act on: `active` or `merged` (spec S7). */
export function trackedPackages(root: string): PolyfillRecord[] {
  return readPackages(root).filter((record) => TRACKED_STATES.has(record.state));
}

/**
 * A new `polyfill.json` with `patch` applied: existing keys keep their slot and value type,
 * unknown keys are appended, two-space indent, trailing newline. Throws rather than writing
 * half a record.
 */
export function applyPatch(content: string, patch: Record<string, unknown>): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("polyfill.json is not JSON");
  }
  if (!isPlainObject(parsed)) throw new Error("polyfill.json is not a JSON object");

  const patched: Record<string, unknown> = { ...parsed };
  for (const [key, value] of Object.entries(patch)) patched[key] = value;
  return `${JSON.stringify(patched, null, 2)}\n`;
}

/** S7 idempotence: a title is open only if it is open, exactly. */
export function alreadyOpen(open: string[], title: string): boolean {
  return open.includes(title);
}

function gitText(repo: string, args: string[]): { ok: true; out: string } | { ok: false; error: string } {
  try {
    const out = execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });
    return { ok: true, out };
  } catch (error) {
    // The stderr line is what the tracker reports; an empty one means git refused without a
    // message (a repository with no commits yet), which the caller treats as "nothing to say".
    const stderr = (error as { stderr?: unknown }).stderr;
    return { ok: false, error: typeof stderr === "string" ? (stderr.split("\n")[0] ?? "") : errorText(error) };
  }
}

function commitDate(line: string): Date | undefined {
  const m = COMMIT_DATE.exec(line);
  if (m === null) return undefined;
  let offset = m[3] ?? "";
  if (offset !== "" && offset !== "Z" && !offset.includes(":")) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const at = new Date(`${m[1]}T${m[2]}${offset}`);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/**
 * Days since the first commit touching `path` (spec S7's 60-day reminder). A path with no
 * commits yet has no age to report, so it ages to 0 rather than filing a reminder.
 */
export function firstCommitAgeDays(repo: string, path: string, now: Date): number {
  // `--quiet` keeps a repository with no commits from looking like a git failure.
  const head = gitText(repo, ["rev-parse", "--quiet", "--verify", "HEAD"]);
  if (!head.ok) {
    if (head.error !== "") warn(`${path}: git rev-parse failed: ${head.error}`);
    return 0;
  }
  const log = gitText(repo, ["log", "--reverse", "--format=%ad", "--date=iso-strict", "--", path]);
  if (!log.ok) {
    warn(`${path}: git log failed: ${log.error}`);
    return 0;
  }

  const first = log.out.split("\n").map((line) => line.trim()).find((line) => line !== "");
  if (first === undefined) return 0;

  const at = commitDate(first);
  if (at === undefined) {
    warn(`${path}: unreadable commit date "${first}"`);
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}
