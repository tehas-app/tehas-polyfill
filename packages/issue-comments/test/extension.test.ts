// T4: the extension's own tests. They drive index.ts through a fake ExtensionAPI and real
// fixtures, and check the two lines the polyfill is allowed to write to stderr.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { issueCommentsExtension } from "../index.ts";
import { renderComments } from "../render.ts";
import { writeFixture } from "./helpers.ts";
import type { CommentItem } from "../types.ts";

const DIRS_ENV = "PI_ENSEMBLE_EXTRA_IMAGE_DIRS";
const UNTIL = "2026-11-04T10:12:00Z";

let counter = 0;
function newDir(label: string): string {
  return join(import.meta.dir, "..", "..", "..", ".tmp-fixtures", `ext-${label}-${counter++}`);
}

/** Minimal stand-in for the ExtensionAPI: it only needs to record handlers and fire events. */
class FakePi {
  private handlers = new Map<string, ((event: any) => unknown)[]>();

  on(event: string, handler: (event: any) => unknown): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => {};
  }

  /** Fire one event through every handler and return the last result a handler produced. */
  fire(type: string, fields: Record<string, unknown> = {}): unknown {
    let result: unknown;
    for (const handler of this.handlers.get(type) ?? []) {
      const produced = handler({ type, systemPrompt: "", systemPromptOptions: {}, ...fields });
      if (produced !== undefined) result = produced;
    }
    return result;
  }
}

function userEvent(): Record<string, unknown> {
  return { messageType: "user", prompt: "do the issue" };
}

function customEvent(): Record<string, unknown> {
  return { messageType: "custom", message: { role: "custom", customType: "x", content: "y", display: false, timestamp: 0 } };
}

/** Runs fn with PI_ENSEMBLE_EXTRA_IMAGE_DIRS set to dirs, and returns everything written to stderr. */
function withDirs(dirs: string[], fn: () => void): string[] {
  const saved = process.env[DIRS_ENV];
  if (dirs.length === 0) delete process.env[DIRS_ENV];
  else process.env[DIRS_ENV] = dirs.join(":");

  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    fn();
  } finally {
    console.error = original;
    if (saved === undefined) delete process.env[DIRS_ENV];
    else process.env[DIRS_ENV] = saved;
  }
  return lines;
}

function item(over: Partial<CommentItem>): CommentItem {
  return {
    source: "issue-comment",
    id: 1,
    by: "alice",
    at: "2026-11-03T09:00:00Z",
    url: "https://github.com/trail-openers/pi-rukas/issues/2020",
    text: "please keep it small",
    ...over,
  };
}

/** Installs the extension on a fake pi and returns it. */
function installed(): FakePi {
  const pi = new FakePi();
  issueCommentsExtension(pi as never);
  return pi;
}

describe("issueCommentsExtension", () => {
  test("test_custom_message_gets_nothing", () => {
    const dir = newDir("custom");
    writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [item({})], until: UNTIL });
    const pi = installed();

    const lines = withDirs([dir], () => {
      expect(pi.fire("before_agent_start", customEvent())).toBeUndefined();
    });

    expect(lines).toEqual([]);
  });

  test("test_once_per_session", () => {
    const dir = newDir("once");
    writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [item({})], until: UNTIL });
    const pi = installed();

    const lines = withDirs([dir], () => {
      const first = pi.fire("before_agent_start", userEvent()) as { message?: { customType: string } } | undefined;
      expect(first?.message?.customType).toBe("issue-comments");
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();

      // A new session gets its own message.
      pi.fire("session_start");
      const next = pi.fire("before_agent_start", userEvent()) as { message?: { customType: string } } | undefined;
      expect(next?.message?.customType).toBe("issue-comments");
    });

    // One audit line per session, not per turn.
    expect(lines.length).toBe(2);
  });

  test("test_bad_blob_writes_stderr_and_returns_undefined", () => {
    const dir = newDir("bad-sha");
    // The size is the truth and only the sha256 lies, so the reason is the sha256 one.
    const blobValue = { version: 1 as const, issue: 42, until: UNTIL, items: [item({})] };
    writeFixture({
      dir,
      manifest: {
        issue: 42,
        comments: {
          file: "comments.json",
          bytes: new TextEncoder().encode(JSON.stringify(blobValue)).length,
          sha256: "0".repeat(64),
        },
      },
      blob: blobValue,
    });
    const pi = installed();

    const lines = withDirs([dir], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    expect(lines).toEqual(["issue-comments polyfill: no comments (sha256 mismatch)"]);
  });

  test("test_nothing_to_read_is_silent", () => {
    // S3 rule 6 + S4: a directory with no manifest, or a manifest with no `comments` entry, is
    // nothing to read rather than a failed read — the ordinary case for an attachments directory
    // that carries images only — so it injects nothing and writes nothing.
    const bare = newDir("silent-bare");
    rmSync(bare, { recursive: true, force: true });
    mkdirSync(bare, { recursive: true });
    const imagesOnly = newDir("silent-images");
    writeFixture({ dir: imagesOnly, manifest: { issue: 42, images: ["shot.png"] }, blob: null });
    const pi = installed();

    const lines = withDirs([bare, imagesOnly], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    expect(lines).toEqual([]);
  });

  test("test_corrupt_candidate_writes_one_line", () => {
    // R1: an images-only directory never hides a directory whose comments blob is corrupt, so the
    // one line names the corrupt directory's reason.
    const imagesOnly = newDir("line-images-only");
    writeFixture({ dir: imagesOnly, manifest: { issue: 42, images: ["shot.png"] }, blob: null });
    const corrupt = newDir("line-corrupt");
    writeFixture({
      dir: corrupt,
      manifest: { issue: 42, comments: { file: "comments.json", sha256: "0".repeat(64) } },
      blobItems: [item({})],
    });
    const pi = installed();

    const lines = withDirs([imagesOnly, corrupt], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    expect(lines).toEqual(["issue-comments polyfill: no comments (sha256 mismatch)"]);
  });

  test("test_broken_manifest_writes_one_line", () => {
    // R2: a manifest.json that is there but is not valid JSON is a failure, not nothing to read.
    const dir = newDir("broken-manifest");
    writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [item({})] });
    writeFileSync(join(dir, "manifest.json"), "{not json");
    const pi = installed();

    const lines = withDirs([dir], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    expect(lines).toEqual(["issue-comments polyfill: no comments (bad manifest)"]);
  });

  test("test_corrupt_comments_entry_writes_one_line", () => {
    // A `comments` entry that is there and cannot be used is exactly what the failure line is for.
    const dir = newDir("bad-json");
    writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, raw: new TextEncoder().encode("{not json") });
    const pi = installed();

    const lines = withDirs([dir], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    expect(lines).toEqual(["issue-comments polyfill: no comments (bad json)"]);
  });

  test("test_failed_read_writes_its_line_once_per_session", () => {
    // S4: the once-per-session latch is set before the blob is read, so a blob that never reads
    // costs one line and one attempt for the session, not one for every turn.
    const dir = newDir("latch");
    const blobValue = { version: 1 as const, issue: 42, until: UNTIL, items: [item({})] };
    writeFixture({
      dir,
      manifest: {
        issue: 42,
        comments: {
          file: "comments.json",
          bytes: new TextEncoder().encode(JSON.stringify(blobValue)).length,
          sha256: "0".repeat(64),
        },
      },
      blob: blobValue,
    });
    const pi = installed();

    const lines = withDirs([dir], () => {
      for (let turn = 0; turn < 3; turn += 1) {
        expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
      }

      // A new session is a new session: it gets its own one attempt and its own one line.
      pi.fire("session_start");
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    const failure = "issue-comments polyfill: no comments (sha256 mismatch)";
    expect(lines).toEqual([failure, failure]);
  });

  test("test_stderr_line_shape", () => {
    const dir = newDir("stderr-shape");
    const malformed = item({ id: 99, by: "", url: "http://not-https/x", text: "rejected" });
    const paths = writeFixture({
      dir,
      manifest: { issue: 42, comments: { file: "comments.json" } },
      blobItems: [
        item({ id: 1, at: "2026-11-03T09:00:00Z" }),
        item({ id: 2, source: "pr-comment", pr: 57, at: "2026-11-03T10:00:00Z", text: "on the PR" }),
        item({ id: 3, source: "review", pr: 57, by: "bob", at: "2026-11-03T11:00:00Z", text: "approved" }),
        malformed,
      ],
      until: UNTIL,
    });
    const pi = installed();

    let result: unknown;
    const lines = withDirs([dir], () => {
      result = pi.fire("before_agent_start", userEvent());
    });

    const message = (result as { message?: { customType: string; content: string; display: boolean } }).message;
    expect(message?.customType).toBe("issue-comments");
    expect(message?.display).toBe(true);

    // Three of the four blob items are rendered; the malformed one is counted as dropped.
    const blob = JSON.parse(readFileSync(paths.blobPath, "utf-8"));
    const rendered = renderComments(blob);
    expect(rendered.count).toBe(3);
    expect(rendered.dropped).toBe(1);

    expect(lines.length).toBe(1);
    const match = /^issue-comments polyfill: (\d+) comments, (\d+) bytes, (\d+) dropped$/.exec(lines[0]);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(3);
    expect(Number(match?.[2])).toBe(rendered.bytes);
    expect(Number(match?.[3])).toBe(1);
  });

  test("test_io_error_never_escapes", () => {
    const dir = newDir("manifest-is-dir");
    writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [item({})], until: UNTIL });
    rmSync(join(dir, "manifest.json"), { recursive: true, force: true });
    mkdirSync(join(dir, "manifest.json"));
    const pi = installed();

    const lines = withDirs([dir], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    expect(lines.length).toBe(1);
    expect(/^issue-comments polyfill: no comments \([^)]+\)$/.test(lines[0])).toBe(true);
  });

  test("test_no_dirs_is_silent", () => {
    const pi = installed();
    const lines = withDirs([], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });
    expect(lines).toEqual([]);
  });

  test("test_two_matching_manifests_send_nothing", () => {
    const first = newDir("ambiguous-a");
    const second = newDir("ambiguous-b");
    writeFixture({ dir: first, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [item({})], until: UNTIL });
    writeFixture({ dir: second, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [item({})], until: UNTIL });
    const pi = installed();

    const lines = withDirs([first, second], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    // S3 rule 5: nothing is injected, and this extension is the only line, naming both directories.
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe(`issue-comments polyfill: no comments (ambiguous: ${first}, ${second})`);
  });

  test("test_zero_items_writes_the_audit_line_and_sends_nothing", () => {
    const dir = newDir("zero-items");
    writeFixture({ dir, manifest: { issue: 42, comments: { file: "comments.json" } }, blobItems: [], until: UNTIL });
    const pi = installed();

    const lines = withDirs([dir], () => {
      expect(pi.fire("before_agent_start", userEvent())).toBeUndefined();
    });

    expect(lines).toEqual(["issue-comments polyfill: 0 comments, 0 bytes, 0 dropped"]);
  });
});
