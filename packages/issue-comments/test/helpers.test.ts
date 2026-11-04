import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeFixture } from "./helpers.ts";
import type { CommentItem } from "../types.ts";

function dirFor(name: string): string {
  return join(import.meta.dir, "..", "..", "..", ".tmp-fixtures", name);
}

const oneItem: CommentItem = {
  source: "issue-comment",
  id: 123,
  by: "alice",
  at: "2026-11-03T09:00:00Z",
  url: "https://github.com/trail-openers/pi-rukas/issues/2020",
  text: "hello",
};

describe("writeFixture", () => {
  test("test_fixture_sha_matches_bytes", () => {
    const dir = dirFor("sha-matches");
    const paths = writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [oneItem] });

    expect(paths.dir).toBe(dir);
    expect(paths.manifestPath).toBe(join(dir, "manifest.json"));
    expect(paths.blobPath).toBe(join(dir, "comments.json"));

    const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf-8"));
    expect(manifest.issue).toBe(42);
    const blobBytes = readFileSync(paths.blobPath);
    // The helper fills in what the reader will verify: the blob's real size and sha256.
    expect(manifest.comments.bytes).toBe(blobBytes.length);
    expect(manifest.comments.sha256).toBe(createHash("sha256").update(blobBytes).digest("hex"));

    // The default blob is the shape the reader expects.
    const blob = JSON.parse(blobBytes.toString("utf-8"));
    expect(blob.version).toBe(1);
    expect(blob.issue).toBe(42);
    expect(typeof blob.until).toBe("string");
    expect(blob.items).toEqual([oneItem]);
  });

  test("test_explicit_bytes_and_sha_are_kept", () => {
    const dir = dirFor("sha-explicit");
    const paths = writeFixture({
      dir,
      manifest: { issue: 42, comments: { file: "comments.json", bytes: 4, sha256: "b3f0" } },
      blobItems: [oneItem],
    });

    const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf-8"));
    // A test that wants a size or sha lie must get exactly the lie it wrote.
    expect(manifest.comments.bytes).toBe(4);
    expect(manifest.comments.sha256).toBe("b3f0");
  });

  test("test_symlink_option", () => {
    const dir = dirFor("symlink");
    const paths = writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [oneItem], symlink: true });

    expect(paths.blobPath).toBe(join(dir, "comments.json"));
    expect(lstatSync(paths.blobPath).isSymbolicLink()).toBe(true);
    // The bytes are still there, reachable only through the link.
    expect(readFileSync(paths.blobPath).toString("utf-8")).toContain("alice");
    const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf-8"));
    const target = readFileSync(join(dir, ".blob-target"));
    expect(manifest.comments.bytes).toBe(target.length);
    expect(manifest.comments.sha256).toBe(createHash("sha256").update(target).digest("hex"));
  });

  test("test_raw_bytes", () => {
    const dir = dirFor("raw-bytes");
    const raw = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x00, 0x7d]); // {"a":1, then a NUL
    const paths = writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, raw });

    const written = readFileSync(paths.blobPath);
    expect(Array.from(written)).toEqual(Array.from(raw));

    const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf-8"));
    expect(manifest.comments.bytes).toBe(raw.length);
    expect(manifest.comments.sha256).toBe(createHash("sha256").update(raw).digest("hex"));
    // `raw` is written verbatim: no JSON re-encoding, no added newline.
    expect(existsSync(paths.blobPath)).toBe(true);
  });

  test("test_blob_null_writes_no_blob", () => {
    const dir = dirFor("no-blob");
    const paths = writeFixture({ dir, manifest: { issue: 42 }, blob: null });

    expect(paths.blobPath).toBe("");
    expect(existsSync(join(dir, "comments.json"))).toBe(false);
    expect(JSON.parse(readFileSync(paths.manifestPath, "utf-8")).issue).toBe(42);
  });

  test("test_named_blob_file_and_custom_blob", () => {
    const dir = dirFor("named-blob");
    const paths = writeFixture({
      dir,
      manifest: { issue: 42, comments: { file: "other.json" } },
      blob: { version: 1, issue: 7, until: "2026-11-04T10:12:00Z", items: [] },
    });

    expect(paths.blobPath).toBe(join(dir, "other.json"));
    expect(JSON.parse(readFileSync(paths.blobPath, "utf-8")).issue).toBe(7);
  });

  test("test_file_name_escaping_the_dir_writes_no_blob", () => {
    const dir = dirFor("escaping-name");
    const paths = writeFixture({ dir, manifest: { issue: 42, comments: { file: "../secret.json" } }, blobItems: [oneItem] });

    // The helper never writes outside the fixture directory; the reader must reject the name.
    expect(paths.blobPath).toBe("");
    expect(existsSync(join(dir, "secret.json"))).toBe(false);
    expect(existsSync(join(dir, "..", "secret.json"))).toBe(false);
    expect(JSON.parse(readFileSync(paths.manifestPath, "utf-8")).comments.file).toBe("../secret.json");
  });

  test("test_until_option_and_manifest_without_comments", () => {
    const dir = dirFor("until-option");
    const paths = writeFixture({ dir, manifest: { issue: 42 }, blobItems: [], until: "2026-11-04T10:12:00Z" });

    expect(paths.blobPath).toBe(join(dir, "comments.json"));
    const blob = JSON.parse(readFileSync(paths.blobPath, "utf-8"));
    expect(blob.until).toBe("2026-11-04T10:12:00Z");
    expect(blob.items).toEqual([]);
    const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf-8"));
    expect(manifest.comments).toBeUndefined();
  });
});
