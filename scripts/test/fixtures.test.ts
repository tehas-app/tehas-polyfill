import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The capability probe reads the HEADLESS_FEATURES block of
// extension/src/headless/capabilities.ts at each release tag (coordinator ruling), so
// its offline fixtures come in two sets: scripts/fixtures/capabilities holds real
// upstream snapshots and nothing else, and scripts/fixtures/synthetic holds the one
// hand-written file that declares the polyfilled feature. Only the first set is what
// the per-PR CI probe reads, so it must never declare that feature.

const ROOT = join(import.meta.dir, "..", "..");
/** Real upstream snapshots only: this is the directory polyfill-tests.yml probes. */
const CAPABILITY_DIR = join(ROOT, "scripts", "fixtures", "capabilities");
/** Hand-written, never probed against upstream: the release that must make the probe fail. */
const SYNTHETIC_DIR = join(ROOT, "scripts", "fixtures", "synthetic");
const UPSTREAM_REPO = "trail-openers/pi-rukas";
const CAPABILITIES_FILE = "extension/src/headless/capabilities.ts";
// pi-rukas#2020 has not landed in any release, so no real tag declares this feature.
const SYNTHETIC_FEATURE = "issueComments";
const SYNTHETIC_TAG = "v0.14.99";
/** This test file, so the two modes below can be run as the jobs run them. */
const SELF = join(import.meta.dir, "fixtures.test.ts");

/**
 * Whether the job running this file declares it has network. track.yml sets it; the per-PR job
 * does not. A check that can never fail where the job says it can reach upstream is not a check.
 */
function upstreamRequired(): boolean {
  return process.env.TEHAS_REQUIRE_UPSTREAM === "1";
}

function sourcesIn(dir: string): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".ts")) continue;
    sources[file.slice(0, -".ts".length)] = readFileSync(join(dir, file), "utf8");
  }
  return sources;
}

/**
 * The upstream snapshots as the probe wants them: tag -> the source text of capabilities.ts at
 * that tag. `fixtureSources()["v0.14.0"]` is the text of
 * `scripts/fixtures/capabilities/v0.14.0.ts`, which declares no `issueComments`.
 */
export function fixtureSources(): Record<string, string> {
  return sourcesIn(CAPABILITY_DIR);
}

/** The hand-written set: the declaring release the probe has to fail on. */
export function syntheticSources(): Record<string, string> {
  return sourcesIn(SYNTHETIC_DIR);
}

/** Code only: line and block comments carry prose and braces the scans below must not see. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The body of a `HEADLESS_FEATURES` object, comments included, or undefined when absent. */
function featuresBlock(source: string, keepComments: boolean): string | undefined {
  const text = keepComments ? source : stripComments(source);
  const declared = /HEADLESS_FEATURES\s*=\s*\{/.exec(text);
  if (declared === null) return undefined;
  const open = declared.index + declared[0].length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return undefined;
}

const FEATURE_ENTRY = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(true|false)/g;

/** Every boolean entry in the block, in source order. A non-boolean entry is not a feature. */
function featureEntries(source: string): Map<string, boolean> {
  const block = featuresBlock(source, false);
  const entries = new Map<string, boolean>();
  if (block === undefined) return entries;
  for (const entry of block.matchAll(FEATURE_ENTRY)) entries.set(entry[1], entry[2] === "true");
  return entries;
}

/**
 * The comment that introduces one entry: everything between the previous entry's value
 * and the entry itself. Only the last `true,` / `false,` before the entry is a value
 * boundary, because entry comments are prose and may repeat those words.
 */
function entryComment(source: string, feature: string): string {
  const block = featuresBlock(source, true);
  if (block === undefined) return "";
  const entry = new RegExp(`\\b${feature}\\s*:\\s*(?:true|false)`).exec(block);
  if (entry === null) return "";
  const head = block.slice(0, entry.index);
  const previous = [...head.matchAll(/\b(?:true|false)\s*,/g)].pop();
  return head.slice(previous === undefined ? 0 : previous.index + previous[0].length);
}

/** The real capabilities.ts at a tag, or undefined when gh cannot answer (no gh, no auth, no network). */
function upstreamSource(tag: string): string | undefined {
  if (Bun.which("gh") === null) return undefined;
  const args = ["api", `repos/${UPSTREAM_REPO}/contents/${CAPABILITIES_FILE}?ref=${tag}`];
  try {
    const out = execFileSync("gh", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    const entry = JSON.parse(out) as { content?: unknown };
    if (typeof entry.content !== "string" || entry.content === "") return undefined;
    return Buffer.from(entry.content, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

test("test_fixture_sources_reads_every_fixture", () => {
  const sources = fixtureSources();
  expect(Object.keys(sources).sort()).toEqual(["v0.14.0", "v0.14.50"]);
  for (const [tag, source] of Object.entries(sources)) {
    expect(featuresBlock(source, false), `${tag} has no HEADLESS_FEATURES block`).toBeDefined();
    expect(featureEntries(source).size).toBeGreaterThan(0);
  }
  expect(Object.keys(syntheticSources())).toEqual([SYNTHETIC_TAG]);
});

test("test_only_the_synthetic_fixture_says_lists", () => {
  // The directory CI probes may not name the polyfilled feature at all: a snapshot that declared
  // it would fail the per-PR job on every push.
  const capabilities = fixtureSources();
  expect(Object.keys(capabilities).filter((tag) => featureEntries(capabilities[tag] ?? "").has(SYNTHETIC_FEATURE))).toEqual([]);

  const synthetic = syntheticSources();
  expect(featureEntries(synthetic[SYNTHETIC_TAG] ?? "").get(SYNTHETIC_FEATURE)).toBe(true);

  // The hand-written file has to say it is hand-written, or a reader takes it for an upstream tag.
  const marker = entryComment(synthetic[SYNTHETIC_TAG] ?? "", SYNTHETIC_FEATURE);
  expect(marker.length).toBeGreaterThan(0);
  expect(/synthetic/i.test(marker), `${SYNTHETIC_TAG}.ts lists ${SYNTHETIC_FEATURE} without a synthetic marker`).toBe(true);
});

// The drift check is the one check that can reach upstream, so the mode is decided from
// TEHAS_REQUIRE_UPSTREAM before any call: offline, no gh is invoked at all. track.yml - the job
// with the schedule and the token - sets it, and there the check has to answer.
test("test_fixtures_match_upstream", () => {
  // Only the snapshots are checked against upstream; the synthetic file is not a tag.
  const sources = fixtureSources();
  if (!upstreamRequired()) {
    console.log(`fixtures.test: TEHAS_REQUIRE_UPSTREAM is not set, skipping the upstream check for ${Object.keys(sources).length} fixtures`);
    return;
  }
  let checked = 0;
  for (const [tag, source] of Object.entries(sources)) {
    const upstream = upstreamSource(tag);
    if (upstream === undefined) {
      throw new Error(`TEHAS_REQUIRE_UPSTREAM=1 but gh cannot read ${CAPABILITIES_FILE} at ${tag}: a job that declares network does not get to skip the drift check`);
    }
    checked++;
    const upEntries = featureEntries(upstream);
    expect(upEntries.size, `${CAPABILITIES_FILE} at ${tag} declares no features`).toBeGreaterThan(0);

    for (const [key, value] of featureEntries(source)) {
      if (key === SYNTHETIC_FEATURE) {
        // The fixture's synthetic entry is only honest while no release declares it.
        expect(upEntries.has(key), `${tag} really declares ${key}: the fixture is no longer synthetic`).toBe(false);
        continue;
      }
      // An excerpt may drop keys; it may not invent one, nor restate one with another value.
      expect(upEntries.has(key), `${tag}.ts invents ${key}, which ${tag} does not declare`).toBe(true);
      expect(upEntries.get(key), `${tag}.ts says ${key}: ${value}, upstream says ${upEntries.get(key)}`).toBe(value);
    }
  }
  // The job said it has network: every fixture has to have been checked against it.
  expect(checked, `TEHAS_REQUIRE_UPSTREAM=1 but only ${checked} of ${Object.keys(sources).length} fixtures were checked`).toBe(Object.keys(sources).length);
}, 30_000);

interface RanTest {
  code: number;
  out: string;
  err: string;
}

/**
 * Whether this file is the child of one of the two meta-tests below. The child must not spawn the
 * check again, or the runs multiply.
 */
const IS_CHILD = process.env.TEHAS_FIXTURES_CHILD === "1";
/** The meta-tests run this file as a job would; a child run registers them as skipped. */
const jobTest = IS_CHILD ? test.skip : test;

/** This file as a job runs it, so both modes of the drift check are actually tested. */
async function runFixturesTest(env: Record<string, string>): Promise<RanTest> {
  const proc = Bun.spawnSync([process.execPath, "test", SELF], {
    cwd: ROOT,
    env: { ...process.env, ...env, TEHAS_FIXTURES_CHILD: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode ?? -1, out: proc.stdout?.toString() ?? "", err: proc.stderr?.toString() ?? "" };
}

jobTest("test_declared_network_that_cannot_answer_is_a_failure", async () => {
  // track.yml's mode: TEHAS_REQUIRE_UPSTREAM=1 with no gh on PATH.
  const empty = mkdtempSync(join(tmpdir(), "fixtures-required-"));
  try {
    const ran = await runFixturesTest({ TEHAS_REQUIRE_UPSTREAM: "1", PATH: empty });
    expect(ran.code).not.toBe(0);
    expect(`${ran.out}\n${ran.err}`).toContain("TEHAS_REQUIRE_UPSTREAM");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}, 60_000);

jobTest("test_offline_drift_check_says_it_skipped", async () => {
  // The per-PR job's mode, with gh on the PATH: the mode is decided first, so gh is never invoked
  // and the run says what it did not check.
  const ran = await runFixturesTest({ TEHAS_REQUIRE_UPSTREAM: "" });
  expect(ran.code).toBe(0);
  expect(ran.out).toContain("skipping the upstream check");
}, 60_000);
