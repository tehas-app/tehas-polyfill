// The blob reader for the issue-comments polyfill: spec S3 (reading rules) and S9 (reason strings).
// It finds the one `manifest.json` + blob pair in `PI_ENSEMBLE_EXTRA_IMAGE_DIRS`, checks the blob
// against the integrity fields the manifest claims, and reports every failure as a reason string.
// A directory whose manifest names a comments blob is a candidate, and its failure outranks a
// directory that had nothing to read. Nothing here throws, and nothing here gates on images or on
// `PI_ENSEMBLE_ISSUE_IMAGES`.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CollectOutcome, CommentsBlob, ReadOutcome } from "./types.ts";

const DIRS_ENV = "PI_ENSEMBLE_EXTRA_IMAGE_DIRS";
const MANIFEST_NAME = "manifest.json";

/** S9: a plain file name, so a manifest can never name a path outside its own directory. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** S9: the shape of `until` (and of every item's `at`). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** The directories the host names, in order, empty-free. */
export function imageDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = env[DIRS_ENV];
  if (typeof raw !== "string" || raw === "") return [];
  return raw.split(":").filter((dir) => dir !== "");
}

function fail(reason: string): ReadOutcome {
  return { ok: false, reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** manifest.json itself: missing is `no manifest`, anything else unreadable or unparseable is `bad manifest`. */
function readManifest(dir: string): { manifest: Record<string, unknown> } | ReadOutcome {
  let text: string;
  try {
    text = readFileSync(join(dir, MANIFEST_NAME), "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return fail(code === "ENOENT" || code === "ENOTDIR" ? "no manifest" : "bad manifest");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("bad manifest");
  }
  if (!isPlainObject(parsed)) return fail("bad manifest");
  return { manifest: parsed };
}

/**
 * One directory scanned, and whether it was a candidate: a manifest that parses and carries a
 * `comments` entry names a comments blob, so its failure is worth reporting. `no manifest` and `no
 * comments entry` are a directory with nothing to read (spec S3 rule 6).
 */
interface Scan {
  outcome: ReadOutcome;
  candidate: boolean;
}

/**
 * S3 rule 6: the reasons that are nothing to read rather than a bad pair, which is the ordinary
 * case for an attachments directory carrying images only. `index.ts` writes its failure line for
 * every reason but these, so the two files share one list.
 */
const NOTHING_TO_READ = new Set(["no dirs", "no manifest", "no comments entry"]);

/** Whether a reader reason is nothing to read. */
export function nothingToRead(reason: string): boolean {
  return NOTHING_TO_READ.has(reason);
}

/** The candidate's own rules: the name it names, the file it points at, its integrity and its body. */
function readCandidate(manifest: Record<string, unknown>, comments: Record<string, unknown>, dir: string): ReadOutcome {
  // The name is checked before the file is touched, so a lying manifest never reaches outside.
  const file = comments.file;
  if (typeof file !== "string" || !FILE_NAME.test(file)) return fail("bad file name");
  if (typeof manifest.issue !== "number" || !Number.isFinite(manifest.issue)) return fail("bad manifest");

  const blobPath = join(dir, file);
  let stats;
  try {
    stats = lstatSync(blobPath);
  } catch {
    return fail("not a file");
  }
  if (stats.isSymbolicLink()) return fail("symlink");
  if (!stats.isFile()) return fail("not a file");

  // The integrity fields are only meaningful once there is a real file to hold them up.
  if (typeof comments.bytes !== "number" || !Number.isInteger(comments.bytes) || comments.bytes < 0) {
    return fail("bad manifest");
  }
  if (typeof comments.sha256 !== "string") return fail("bad manifest");
  if (stats.size !== comments.bytes) return fail("size mismatch");

  let bytes: Uint8Array;
  try {
    bytes = readFileSync(blobPath);
  } catch {
    return fail("not a file");
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== comments.sha256.toLowerCase()) return fail("sha256 mismatch");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("bad utf8");
  }
  if (text.includes("\u0000")) return fail("nul byte");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("bad json");
  }
  if (!isPlainObject(parsed)) return fail("bad json");

  if (parsed.version !== 1) return fail("bad version");
  if (typeof parsed.issue !== "number" || parsed.issue !== manifest.issue) return fail("issue mismatch");
  if (typeof parsed.until !== "string" || !TIMESTAMP.test(parsed.until)) return fail("bad until");
  if (!Array.isArray(parsed.items)) return fail("no items");

  const blob: CommentsBlob = { version: 1, issue: parsed.issue, until: parsed.until, items: parsed.items };
  return { ok: true, dir, blob };
}

/**
 * One directory: its manifest, then, only if that manifest names a comments blob, the pair it
 * names. Never throws, and says whether the directory had something to read.
 */
function scanDir(dir: string): Scan {
  try {
    const manifestResult = readManifest(dir);
    if (!("manifest" in manifestResult)) return { outcome: manifestResult, candidate: false };

    const comments = manifestResult.manifest.comments;
    if (!isPlainObject(comments)) return { outcome: fail("no comments entry"), candidate: false };

    return { outcome: readCandidate(manifestResult.manifest, comments, dir), candidate: true };
  } catch {
    // Every I/O stage above is already mapped to a reason; this is the net that keeps S3 rule 6 true.
    return { outcome: fail("bad manifest"), candidate: false };
  }
}

/** One directory: its manifest, its blob, and the pair's integrity. Never throws. */
export function readDirComments(dir: string): ReadOutcome {
  return scanDir(dir).outcome;
}

/**
 * All directories from the env.
 *
 * Zero matches: the reported reason is the most informative failure, in this order — a candidate
 * (a manifest that named a comments blob and could not deliver it), then a manifest the host wrote
 * but that cannot be parsed, then a directory with nothing to read. So an images-only directory can
 * never hide a corrupt pair, and `index.ts` can tell the two cases apart with `nothingToRead`.
 * Two or more matches: nothing used, and the matching directories come back in `dirs` for the
 * caller to name (index.ts owns the one `issue-comments polyfill:` line, so this module never
 * writes to stderr).
 */
export function collectComments(env: NodeJS.ProcessEnv): CollectOutcome {
  const dirs = imageDirs(env);
  if (dirs.length === 0) return { ok: false, reason: "no dirs", dirs: [] };

  const matches: { ok: true; dir: string; blob: CommentsBlob }[] = [];
  let bestFailure: ReadOutcome | undefined;
  let bestRank = 3;
  for (const dir of dirs) {
    const scan = scanDir(dir);
    if (scan.outcome.ok) {
      matches.push(scan.outcome);
      continue;
    }
    // A candidate outranks a broken manifest, which outranks a directory with nothing to read.
    const rank = scan.candidate ? 0 : nothingToRead(scan.outcome.reason) ? 2 : 1;
    if (rank < bestRank) {
      bestRank = rank;
      bestFailure = scan.outcome;
    }
  }

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ok: false, reason: "ambiguous", dirs: matches.map((match) => match.dir) };

  return bestFailure ?? { ok: false, reason: "no dirs", dirs };
}
