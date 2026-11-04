#!/usr/bin/env bun
// Capability probe (spec S6): one line per (polyfill, pi-rukas release), from each
// package's `from` to the newest release. A release's capabilities are the source of
// extension/src/headless/capabilities.ts at its tag, read through gh or from a fixture.
//
// Exit codes: 0 nothing to report, 1 a release lists a feature a still-installed
// polyfill provides, 2 the probe itself could not run (bad flag, gh failure,
// missing capabilities source).

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeReleases, releaseTags } from "./lib/releases";
import { readPackages } from "./lib/state";
import type { PolyfillRecord, ProbeRow } from "./lib/types";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DEFAULT_UPSTREAM_REPO = "trail-openers/pi-rukas";
// The file pi-rukas-headless builds --capabilities from (coordinator ruling).
const CAPABILITIES_FILE = "extension/src/headless/capabilities.ts";
// S9: the probe covers the newest 12 releases plus the package's own `from`.
const MAX_RELEASES = 12;
const USAGE = "usage: bun run scripts/capability_probe.ts [--from <tag>] [--max <n>] [--fixtures <dir>]";

interface Options {
  from: string | null;
  max: number;
  fixtures: string | null;
  upstreamRepo: string;
}

function die(message: string): never {
  process.stderr.write(`capability probe: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    from: null,
    max: MAX_RELEASES,
    fixtures: null,
    upstreamRepo: process.env.UPSTREAM_REPO ?? DEFAULT_UPSTREAM_REPO,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (flag === "--from") {
      if (value === undefined) die("--from needs a tag");
      o.from = value;
      i++;
    } else if (flag === "--max") {
      if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) {
        die("--max needs a positive whole number");
      }
      o.max = Number(value);
      i++;
    } else if (flag === "--fixtures") {
      if (value === undefined) die("--fixtures needs a directory");
      o.fixtures = resolve(process.cwd(), value);
      i++;
    } else {
      die(`unknown argument ${flag}`);
    }
  }
  return o;
}

function gh(args: string[]): string {
  try {
    return execFileSync("gh", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message.split("\n")[0] : String(e);
    die(`gh ${args.join(" ")} failed: ${detail}`);
  }
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    die(`${what} is not JSON`);
  }
}

function tagNames(releases: unknown): string[] {
  if (!Array.isArray(releases)) return [];
  const tags: string[] = [];
  for (const release of releases) {
    const tag = typeof release === "object" && release !== null ? (release as { tag_name?: unknown }).tag_name : undefined;
    if (typeof tag === "string") tags.push(tag);
  }
  return tags;
}

/** The release list: fixture file names offline, `gh` otherwise. */
function listTags(o: Options): string[] {
  if (o.fixtures !== null) {
    return readdirSync(o.fixtures)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.slice(0, -".ts".length));
  }
  return tagNames(parseJson(gh(["api", `repos/${o.upstreamRepo}/releases?per_page=100`]), "gh release list"));
}

/**
 * The capabilities source for one release: `<fixtures>/<tag>.ts` offline, the file at
 * that tag through gh otherwise (the contents API returns it base64).
 */
function readDoc(o: Options, tag: string): string {
  if (o.fixtures !== null) {
    const file = join(o.fixtures, `${tag}.ts`);
    try {
      return readFileSync(file, "utf8");
    } catch {
      die(`missing capabilities source ${file}`);
    }
  }
  const args = ["api", `repos/${o.upstreamRepo}/contents/${CAPABILITIES_FILE}?ref=${tag}`];
  const entry = parseJson(gh(args), `gh ${args[1]}`) as { content?: unknown };
  if (typeof entry.content !== "string" || entry.content === "") {
    die(`${CAPABILITIES_FILE} at ${tag} carries no content`);
  }
  return Buffer.from(entry.content, "base64").toString("utf8");
}

function line(row: ProbeRow, feature: string): string {
  if (row.fail) {
    return `FAIL ${row.tag} ${row.package}: pi-rukas ${row.tag} lists ${feature} while ${row.package} polyfill.json says ${row.state}`;
  }
  return `ok   ${row.tag} ${row.package}: ${feature} not listed (${row.state})`;
}

function main(): void {
  const o = parseArgs(process.argv.slice(2));
  const pkgs: PolyfillRecord[] = readPackages(ROOT);
  const allTags = listTags(o);

  let failed = false;
  for (const pkg of pkgs) {
    const from = o.from ?? pkg.from;
    const tags = releaseTags(from, allTags, o.max);
    if (tags.length === 0) {
      process.stderr.write(`capability probe: ${pkg.name}: no releases at or after ${from}\n`);
      continue;
    }
    const docs: Record<string, string> = {};
    for (const tag of tags) docs[tag] = readDoc(o, tag);
    for (const row of probeReleases([pkg], docs)) {
      if (row.fail) failed = true;
      process.stdout.write(`${line(row, pkg.upstreamFeature)}\n`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
