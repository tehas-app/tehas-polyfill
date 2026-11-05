// Tests for the blob reader: spec S3 (reading rules) and S9 (exact reason strings).
// Every fixture goes through writeFixture, whose manifest integrity fields match the bytes it
// wrote unless the test states a lie on purpose.

import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectComments, imageDirs, readDirComments } from "../read.ts";
import { writeFixture } from "./helpers.ts";

const madeDirs: string[] = [];

/** A fresh temporary directory to hand to writeFixture. */
function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-comments-read-"));
  madeDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of madeDirs.splice(0, madeDirs.length)) rmSync(dir, { recursive: true, force: true });
});

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const ONE_ITEM = {
  source: "issue-comment",
  id: 123,
  by: "alice",
  at: "2026-11-03T09:00:00Z",
  url: "https://github.com/tehas-app/tehas-polyfill/issues/2#issuecomment-1",
  text: "start with the reader",
};

const UNTIL = "2026-11-04T10:12:00Z";

/** A manifest naming the blob, with `bytes`/`sha256` left for the helper to fill in truthfully. */
function pair(manifest: Record<string, unknown> = { issue: 42, images: [], comments: { file: "comments.json" } }) {
  return writeFixture({ dir: newDir(), manifest, blobItems: [ONE_ITEM] });
}

function blobOf(overrides: Record<string, unknown>): Record<string, unknown> {
  return { version: 1, issue: 42, until: UNTIL, items: [ONE_ITEM], ...overrides };
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

test("imageDirs splits the colon-separated list", () => {
  expect(imageDirs({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: "/a:/b" })).toEqual(["/a", "/b"]);
  expect(imageDirs({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: "/a" })).toEqual(["/a"]);
  expect(imageDirs({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: "/a::/b:" })).toEqual(["/a", "/b"]);
  expect(imageDirs({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: "" })).toEqual([]);
  expect(imageDirs({})).toEqual([]);
});

test("a valid manifest and blob are read", () => {
  const f = pair();
  const outcome = readDirComments(f.dir);
  expect(outcome.ok).toBe(true);
  if (outcome.ok) {
    expect(outcome.dir).toBe(f.dir);
    expect(outcome.blob).toEqual({ version: 1, issue: 42, until: UNTIL, items: [ONE_ITEM] });
  }
});

test("no manifest in the directory", () => {
  expect(readDirComments(newDir())).toEqual({ ok: false, reason: "no manifest" });
  expect(readDirComments(join(newDir(), "missing"))).toEqual({ ok: false, reason: "no manifest" });
});

test("an unparseable manifest is a bad manifest", () => {
  const dir = newDir();
  writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, blob: null });
  writeFileSync(join(dir, "manifest.json"), "{not json");
  expect(readDirComments(dir)).toEqual({ ok: false, reason: "bad manifest" });

  const scalarDir = newDir();
  writeFileSync(join(scalarDir, "manifest.json"), "42");
  expect(readDirComments(scalarDir)).toEqual({ ok: false, reason: "bad manifest" });

  const manifestIsDir = newDir();
  mkdirSync(join(manifestIsDir, "manifest.json"));
  expect(readDirComments(manifestIsDir)).toEqual({ ok: false, reason: "bad manifest" });
});

test("no_comments_entry: a manifest without a usable comments entry", () => {
  expect(readDirComments(writeFixture({ dir: newDir(), manifest: { issue: 42, images: [] } }).dir)).toEqual({
    ok: false,
    reason: "no comments entry",
  });
  for (const comments of ["comments.json", ["comments.json"], null]) {
    const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments } });
    expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "no comments entry" });
  }
});

test("bad_manifest: integrity fields that cannot be checked against a real file", () => {
  for (const comments of [
    { file: "comments.json", bytes: "12", sha256: sha256("{}") },
    { file: "comments.json", bytes: -3, sha256: sha256("{}") },
    { file: "comments.json", bytes: 1.5, sha256: sha256("{}") },
    { file: "comments.json", bytes: 2, sha256: 7 },
  ]) {
    const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments }, blobItems: [ONE_ITEM] });
    expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "bad manifest" });
  }
  const noIssue = writeFixture({ dir: newDir(), manifest: { comments: { file: "comments.json" } }, blobItems: [ONE_ITEM] });
  expect(readDirComments(noIssue.dir)).toEqual({ ok: false, reason: "bad manifest" });
});

test("a comments entry whose file is not a string is a bad file name", () => {
  const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: 7 } } });
  expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "bad file name" });
});

test("file_name_escapes_directory: a file name never leaves the directory", () => {
  for (const file of ["../secret.json", "/etc/passwd", "..", ".", "a/b", "", " comments.json", "x".repeat(101)]) {
    const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file, bytes: 2, sha256: sha256("{}") } } });
    expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "bad file name" });
  }
  // A name the S9 pattern accepts is read from inside the directory.
  const ok = writeFixture({
    dir: newDir(),
    manifest: { issue: 42, comments: { file: "comments_v1.json" } },
    blob: blobOf({}),
  });
  expect(readDirComments(ok.dir).ok).toBe(true);
});

test("a blob that is not a regular file is not a file", () => {
  const missing = writeFixture({
    dir: newDir(),
    manifest: { issue: 42, comments: { file: "comments.json", bytes: 2, sha256: sha256("{}") } },
    blob: null,
  });
  expect(readDirComments(missing.dir)).toEqual({ ok: false, reason: "not a file" });

  const blobIsDir = newDir();
  writeFixture({ dir: blobIsDir, manifest: { issue: 42, comments: { file: "comments.json" } }, blob: null });
  mkdirSync(join(blobIsDir, "comments.json"));
  expect(readDirComments(blobIsDir)).toEqual({ ok: false, reason: "not a file" });
});

test("manifest_names_missing_blob_is_not_a_file", () => {
  // The accepted reason order (a coordinator ruling): the blob path is lstat'ed before the
  // manifest's integrity fields are shaped, so a manifest naming a blob that is not there reports
  // the missing file rather than the shape of the fields that could never have been checked.
  const f = writeFixture({
    dir: newDir(),
    manifest: { issue: 42, comments: { file: "comments.json", bytes: "12", sha256: 7 } },
    blob: null,
  });
  expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "not a file" });

  // The same lying fields against a blob that is there are the manifest's own problem.
  const present = writeFixture({
    dir: newDir(),
    manifest: { issue: 42, comments: { file: "comments.json", bytes: "12", sha256: 7 } },
    blobItems: [ONE_ITEM],
  });
  expect(readDirComments(present.dir)).toEqual({ ok: false, reason: "bad manifest" });
});

test("symlink_rejected: the blob path must not be a symlink", () => {
  const linked = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [ONE_ITEM], symlink: true });
  expect(readDirComments(linked.dir)).toEqual({ ok: false, reason: "symlink" });

  const dangling = newDir();
  symlinkSync("gone.json", join(dangling, "comments.json"));
  writeFileSync(
    join(dangling, "manifest.json"),
    JSON.stringify({ issue: 42, comments: { file: "comments.json", bytes: 2, sha256: sha256("{}") } }),
  );
  expect(collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: dangling })).toEqual({ ok: false, reason: "symlink" });
});

test("wrong_size: the manifest's byte count must match the file", () => {
  const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json", bytes: 4 } }, blob: blobOf({}) });
  expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "size mismatch" });
});

test("a digest that does not match the bytes is a sha256 mismatch", () => {
  const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json", sha256: "b3f0" } }, blob: blobOf({}) });
  expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "sha256 mismatch" });
});

test("nul_and_bad_utf8: the bytes must be NUL-free valid UTF-8", () => {
  const nul = new TextEncoder().encode(JSON.stringify(blobOf({})) + "\u0000trailing");
  const withNul = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, raw: nul });
  expect(readDirComments(withNul.dir)).toEqual({ ok: false, reason: "nul byte" });

  const badUtf8 = new Uint8Array([0xff, 0xfe, 0x00]);
  const broken = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, raw: badUtf8 });
  expect(readDirComments(broken.dir)).toEqual({ ok: false, reason: "bad utf8" });
});

test("unparseable bytes are bad json", () => {
  const raw = new TextEncoder().encode("not json at all");
  const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, raw });
  expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "bad json" });

  const scalar = new TextEncoder().encode("7");
  const scalarPair = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, raw: scalar });
  expect(readDirComments(scalarPair.dir)).toEqual({ ok: false, reason: "bad json" });
});

test("version must be 1", () => {
  expect(readDirComments(writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blob: blobOf({ version: 2 }) }).dir)).toEqual({
    ok: false,
    reason: "bad version",
  });
  const missing = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blob: { issue: 42, until: UNTIL, items: [] } });
  expect(readDirComments(missing.dir)).toEqual({ ok: false, reason: "bad version" });
});

test("issue_mismatch: the blob must carry the manifest's issue", () => {
  const other = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blob: blobOf({ issue: 43 }) });
  expect(readDirComments(other.dir)).toEqual({ ok: false, reason: "issue mismatch" });
  const noIssue = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blob: { version: 1, until: UNTIL, items: [] } });
  expect(readDirComments(noIssue.dir)).toEqual({ ok: false, reason: "issue mismatch" });
});

test("bad_until: until is an ISO-8601 timestamp string", () => {
  for (const until of ["2026-11-04", "later", "", "2026-11-04T10:12:00Z extra", 1730722320, null]) {
    const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blob: blobOf({ until }) });
    expect(readDirComments(f.dir)).toEqual({ ok: false, reason: "bad until" });
  }
  for (const until of [UNTIL, "2026-11-04T10:12:00.500Z", "2026-11-04T10:12:00+01:00", "2026-11-04T10:12:00"]) {
    const f = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blob: blobOf({ until }) });
    expect(readDirComments(f.dir).ok).toBe(true);
  }
});

test("no_items: items must be an array", () => {
  const missing = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blob: { version: 1, issue: 42, until: UNTIL } });
  expect(readDirComments(missing.dir)).toEqual({ ok: false, reason: "no items" });
  const object = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blob: { version: 1, issue: 42, until: UNTIL, items: {} } });
  expect(readDirComments(object.dir)).toEqual({ ok: false, reason: "no items" });
  const empty = writeFixture({ dir: newDir(), manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [] });
  expect(empty.dir && readDirComments(empty.dir).ok).toBe(true);
});

test("collectComments with no directories", () => {
  expect(collectComments({})).toEqual({ ok: false, reason: "no dirs", dirs: [] });
  expect(collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: "" })).toEqual({ ok: false, reason: "no dirs", dirs: [] });
});

test("collectComments reads the one matching directory", () => {
  const matching = pair();
  const empty = newDir();
  const outcome = collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: `${empty}:${matching.dir}` });
  expect(outcome.ok).toBe(true);
  if (outcome.ok) expect(outcome.dir).toBe(matching.dir);
});

test("a_candidate_outranks_a_directory_with_nothing_to_read", () => {
  // R1: a manifest that names a comments blob is a candidate, and its failure is the reason the
  // caller is told about wherever that directory sits in the list, so a directory with nothing to
  // read never hides a corrupt comments pair.
  const nothingToRead = writeFixture({ dir: newDir(), manifest: { issue: 42, images: ["shot.png"] }, blob: null });
  const corrupt = writeFixture({
    dir: newDir(),
    manifest: { issue: 42, comments: { file: "comments.json", sha256: "deadbeef" } },
    blob: blobOf({}),
  });

  expect(collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: `${nothingToRead.dir}:${corrupt.dir}` })).toEqual({
    ok: false,
    reason: "sha256 mismatch",
  });
  expect(collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: `${corrupt.dir}:${nothingToRead.dir}` })).toEqual({
    ok: false,
    reason: "sha256 mismatch",
  });
});

test("broken_manifest_is_a_failure_not_nothing_to_read", () => {
  // R2: the host wrote a file that is not a manifest, which is not the ordinary images-only case.
  const broken = newDir();
  writeFixture({ dir: broken, manifest: { issue: 42, comments: { file: "comments.json" } }, blob: null });
  writeFileSync(join(broken, "manifest.json"), "{not json");
  expect(collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: broken })).toEqual({ ok: false, reason: "bad manifest" });

  const nothingToRead = writeFixture({ dir: newDir(), manifest: { issue: 42, images: ["shot.png"] }, blob: null });
  expect(collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: `${nothingToRead.dir}:${broken}` })).toEqual({
    ok: false,
    reason: "bad manifest",
  });
});

test("nothing_to_read_across_directories_reports_a_silent_reason", () => {
  const bare = newDir();
  const imagesOnly = writeFixture({ dir: newDir(), manifest: { issue: 42, images: ["shot.png"] }, blob: null });

  expect(collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: `${bare}:${imagesOnly.dir}` })).toEqual({
    ok: false,
    reason: "no manifest",
  });
  expect(collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: `${imagesOnly.dir}:${bare}` })).toEqual({
    ok: false,
    reason: "no comments entry",
  });
});

test("two_matching_manifests: ambiguous, the directories returned, nothing printed", () => {
  const a = pair();
  const b = pair();
  let outcome: ReturnType<typeof collectComments> | undefined;
  const lines = stderrLines(() => {
    outcome = collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: `${a.dir}:${b.dir}` });
  });
  expect(outcome).toEqual({ ok: false, reason: "ambiguous", dirs: [a.dir, b.dir] });
  // index.ts prints the one failure line from this reason and these dirs (coordinator ruling).
  expect(lines).toEqual([]);
});

test("images_off_still_reads: images and PI_ENSEMBLE_ISSUE_IMAGES do not gate the read", () => {
  const f = writeFixture({ dir: newDir(), manifest: { issue: 42, images: [], comments: { file: "comments.json" } }, blobItems: [ONE_ITEM] });
  const outcome = collectComments({ PI_ENSEMBLE_EXTRA_IMAGE_DIRS: f.dir, PI_ENSEMBLE_ISSUE_IMAGES: "0", PI_ENSEMBLE_IMAGES: "0" });
  expect(outcome.ok).toBe(true);
});
