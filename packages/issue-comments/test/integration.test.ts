// The seam test for the issue-comments polyfill: the real reader, the real renderer and
// the real extension, over fixtures written by the real fixture helper. No fakes of our
// own modules; the only stand-in is pi itself.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectComments } from "../read.ts";
import { renderComments } from "../render.ts";
import issueCommentsExtension from "../index.ts";
import { writeFixture } from "./helpers.ts";
import type { CommentItem, FixturePaths } from "../types.ts";

type PiApi = Parameters<typeof issueCommentsExtension>[0];
type Injected = { message?: { customType?: string; content?: string; display?: boolean } };
type Ran = { injected: Injected | undefined; err: string };

const ROOT = mkdtempSync(join(tmpdir(), "issue-comments-integration-"));
const DIRS_ENV = "PI_ENSEMBLE_EXTRA_IMAGE_DIRS";

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function dirFor(name: string): string {
  return join(ROOT, name);
}

function envFor(dirs: string[]): NodeJS.ProcessEnv {
  return { [DIRS_ENV]: dirs.join(":") };
}

function fixture(name: string, items: CommentItem[], manifest?: Record<string, unknown>) {
  return writeFixture({
    dir: dirFor(name),
    manifest: { issue: 42, images: [], comments: { file: "comments.json" }, ...manifest },
    blobItems: items,
  });
}

/** pi's extension host, as little of it as the polyfill touches. */
class FakePi {
  private readonly handlers = new Map<string, ((event: never) => unknown)[]>();

  on(event: string, handler: (event: never) => unknown): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  async fire(event: string, payload: Record<string, unknown>): Promise<unknown> {
    let last: unknown;
    for (const handler of this.handlers.get(event) ?? []) {
      last = await handler(payload as never);
    }
    return last;
  }
}

/** One session: build the extension, point the host at `dirs`, fire the hook once. */
async function runExtension(dirs: string[], event: Record<string, unknown> = { messageType: "user" }): Promise<Ran> {
  const chunks: string[] = [];
  const undo: (() => void)[] = [];

  const writeOrig = process.stderr.write;
  process.stderr.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  undo.push(() => {
    process.stderr.write = writeOrig;
  });

  const errorOrig = console.error;
  console.error = (...args: unknown[]) => {
    chunks.push(`${args.map((a) => String(a)).join(" ")}\n`);
  };
  undo.push(() => {
    console.error = errorOrig;
  });

  const saved = process.env[DIRS_ENV];
  process.env[DIRS_ENV] = dirs.join(":");
  undo.push(() => {
    if (saved === undefined) delete process.env[DIRS_ENV];
    else process.env[DIRS_ENV] = saved;
  });

  try {
    const pi = new FakePi();
    issueCommentsExtension(pi as unknown as PiApi);
    const injected = (await pi.fire("before_agent_start", event)) as Injected | undefined;
    return { injected, err: chunks.join("") };
  } finally {
    for (const f of undo.reverse()) f();
  }
}

/** Keeps the manifest's `bytes` true and lies only about `sha256`. */
function corruptSha(f: FixturePaths): FixturePaths {
  const manifest = JSON.parse(readFileSync(f.manifestPath, "utf8")) as { comments?: { sha256?: string } };
  if (manifest.comments !== undefined) manifest.comments.sha256 = "0".repeat(64);
  writeFileSync(f.manifestPath, JSON.stringify(manifest));
  return f;
}

function blocks(content: string): string[] {
  return content.split("\n").filter((line) => line.startsWith("### "));
}

const SIX: CommentItem[] = [
  { source: "review", id: 125, pr: 57, by: "bob", at: "2026-11-03T10:00:00Z", url: "https://x.io/3", text: "blocked on the migration" },
  { source: "issue-comment", id: 123, by: "alice", at: "2026-11-03T09:00:00Z", url: "https://x.io/1", text: "the parser drops trailing newlines" },
  { source: "refresh", id: 128, by: "tehas-app-millwright[bot]", at: "2026-11-03T13:00:00Z", url: "https://x.io/6", text: "refreshed from upstream" },
  { source: "pr-comment", id: 124, pr: 57, by: "alice", at: "2026-11-03T09:05:00Z", url: "https://x.io/2", text: "ready for review" },
  { source: "review-comment", id: 126, pr: 57, path: "src/x.rs", line: 88, by: "bob", at: "2026-11-03T11:00:00Z", url: "https://x.io/4", text: "this line needs the guard" },
  { source: "fixer", id: 127, by: "tehas-app-millwright[bot]", at: "2026-11-03T12:00:00Z", url: "https://x.io/5", text: "applied the suggested fix" },
];

const ONE: CommentItem = {
  source: "issue-comment",
  id: 200,
  by: "carol",
  at: "2026-11-03T15:00:00Z",
  url: "https://x.io/9",
  text: "one comment in this fixture",
};

test("test_end_to_end_six_sources", async () => {
  const f = fixture("six", SIX);
  const ran = await runExtension([f.dir]);
  const content = ran.injected?.message?.content ?? "";

  expect(ran.injected?.message?.customType).toBe("issue-comments");
  expect(ran.injected?.message?.display).toBe(true);
  expect(content.startsWith("## Comments on this issue and its pull requests")).toBe(true);

  // The injected content is exactly what the real reader and renderer produce.
  const collected = collectComments(envFor([f.dir]));
  if (!collected.ok) throw new Error(`collectComments failed: ${collected.reason}`);
  const rendered = renderComments(collected.blob);
  expect(content).toBe(rendered.text);
  expect(rendered.count).toBe(6);
  expect(rendered.dropped).toBe(0);

  // One block per source, oldest first by `at`.
  expect(blocks(content)).toEqual([
    "### Issue comment by alice, 2026-11-03T09:00:00Z (https://x.io/1)",
    "### Comment on pull request #57 by alice, 2026-11-03T09:05:00Z (https://x.io/2)",
    "### Review on #57 by bob, 2026-11-03T10:00:00Z (https://x.io/3)",
    "### Review comment on #57 `src/x.rs:88` by bob, 2026-11-03T11:00:00Z (https://x.io/4)",
    "### Fixer note by tehas-app-millwright[bot], 2026-11-03T12:00:00Z (https://x.io/5)",
    "### Refresh note by tehas-app-millwright[bot], 2026-11-03T13:00:00Z (https://x.io/6)",
  ]);

  expect(ran.err).toContain("6 comments");
});

test("test_two_dirs_one_matching", async () => {
  const good = fixture("two-good", [ONE]);
  const lying = corruptSha(fixture("two-lying", [ONE]));

  const collected = collectComments(envFor([good.dir, lying.dir]));
  if (!collected.ok) throw new Error(`collectComments failed: ${collected.reason}`);
  expect(collected.dir).toBe(good.dir);

  const ran = await runExtension([good.dir, lying.dir]);
  expect(blocks(ran.injected?.message?.content ?? "")).toEqual([
    "### Issue comment by carol, 2026-11-03T15:00:00Z (https://x.io/9)",
  ]);
});

test("test_dir_without_manifest_is_skipped", async () => {
  const bare = dirFor("bare");
  rmSync(bare, { recursive: true, force: true });
  mkdirSync(bare, { recursive: true });
  const good = fixture("bare-good", [ONE]);

  const collected = collectComments(envFor([bare, good.dir]));
  if (!collected.ok) throw new Error(`collectComments failed: ${collected.reason}`);
  expect(collected.dir).toBe(good.dir);

  const ran = await runExtension([bare, good.dir]);
  expect(blocks(ran.injected?.message?.content ?? "")).toEqual([
    "### Issue comment by carol, 2026-11-03T15:00:00Z (https://x.io/9)",
  ]);
});

test("test_bad_sha_end_to_end_is_no_message", async () => {
  const lying = corruptSha(fixture("bad-sha", [ONE]));
  const collected = collectComments(envFor([lying.dir]));
  expect(collected).toEqual({ ok: false, reason: "sha256 mismatch" });

  const ran = await runExtension([lying.dir]);
  expect(ran.injected).toBeUndefined();
  expect(ran.err).toContain("issue-comments polyfill: no comments (sha256 mismatch)");
});
