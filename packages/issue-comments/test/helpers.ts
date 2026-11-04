// Test fixture writer for the issue-comments package: lays down a `manifest.json`
// and, unless told otherwise, the `comments.json` blob it points at.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureOpts, FixturePaths } from "../types.ts";

const DEFAULT_UNTIL = "2026-11-04T10:12:00Z";
const DEFAULT_FILE = "comments.json";
// The same name rule the reader enforces (spec S9).
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// The real file a symlinked blob points at. Not a name the reader will ever look for.
const SYMLINK_TARGET = ".blob-target";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function fileNameOf(manifest: Record<string, unknown>): string {
  const comments = manifest.comments;
  if (comments !== null && typeof comments === "object") {
    const file = (comments as Record<string, unknown>).file;
    if (typeof file === "string") return file;
  }
  return DEFAULT_FILE;
}

/**
 * Writes `dir/manifest.json` and the blob its `comments.file` names.
 *
 * - Blob bytes: `raw` if given, else `blob` as JSON, else `{version: 1, issue: manifest.issue,
 *   until, items: blobItems}`. `blob: null` writes no blob and returns `blobPath: ""`.
 * - A `comments` entry missing `bytes` or `sha256` gets the blob's real values, so a plain
 *   fixture passes the reader's integrity checks; values you set are kept as you set them.
 * - A `file` name that is not a plain name in `dir` never gets a blob written: the helper
 *   does not write outside the fixture directory, and the reader is expected to reject it.
 * - `symlink: true` puts the bytes in `dir/.blob-target` and makes the blob a symlink to it.
 * - The fixture directory is replaced, so a test can reuse a name.
 */
export function writeFixture(o: FixtureOpts): FixturePaths {
  rmSync(o.dir, { recursive: true, force: true });
  mkdirSync(o.dir, { recursive: true });

  const manifest: Record<string, unknown> = { ...o.manifest };
  const manifestPath = join(o.dir, "manifest.json");
  const fileName = fileNameOf(manifest);

  let blobBytes: Uint8Array | null;
  if (o.raw !== undefined) {
    blobBytes = o.raw;
  } else if (o.blob !== undefined) {
    blobBytes = o.blob === null ? null : jsonBytes(o.blob);
  } else {
    blobBytes = jsonBytes({
      version: 1,
      issue: manifest.issue,
      until: o.until ?? DEFAULT_UNTIL,
      items: o.blobItems ?? [],
    });
  }

  const safeName = SAFE_FILE_NAME.test(fileName);
  const blobPath = blobBytes !== null && safeName ? join(o.dir, fileName) : "";

  if (blobPath !== "" && blobBytes !== null) {
    const comments = manifest.comments;
    if (comments !== null && typeof comments === "object" && !Array.isArray(comments)) {
      const entry = comments as Record<string, unknown>;
      if (entry.bytes === undefined) entry.bytes = blobBytes.length;
      if (entry.sha256 === undefined) entry.sha256 = sha256Hex(blobBytes);
    }
    if (o.symlink) {
      const targetPath = join(o.dir, SYMLINK_TARGET);
      if (lstatSync(targetPath, { throwIfNoEntry: false })) rmSync(targetPath, { force: true });
      writeFileSync(targetPath, blobBytes);
      symlinkSync(SYMLINK_TARGET, blobPath);
    } else {
      writeFileSync(blobPath, blobBytes);
    }
  }

  writeFileSync(manifestPath, JSON.stringify(manifest));

  return { dir: o.dir, manifestPath, blobPath };
}
