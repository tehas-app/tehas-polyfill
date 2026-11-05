import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const PROBE = join(ROOT, "scripts", "capability_probe.ts");
const FIXTURES = "scripts/fixtures/capabilities";
/** The fixture set that declares the polyfilled feature: only the fail-the-probe tests use it. */
const SYNTHETIC = "scripts/fixtures/synthetic";
const SYNTHETIC_TAG = "v0.14.99";

interface Ran {
  code: number;
  out: string;
  err: string;
}

async function runProbe(args: string[], env: Record<string, string> = {}): Promise<Ran> {
  const proc = Bun.spawnSync([process.execPath, "run", PROBE, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? -1,
    out: proc.stdout?.toString() ?? "",
    err: proc.stderr?.toString() ?? "",
  };
}

function failingLines(out: string): string[] {
  return out.split("\n").filter((line) => line.includes("FAIL"));
}

test("test_ci_probe_command_exits_0: the exact per-PR CI command passes on the real snapshots", async () => {
  // This is polyfill-tests.yml's step, byte for byte. It has to pass on every push, including the
  // push that adds it, so nothing in that directory may declare the polyfilled feature.
  const ran = await runProbe(["--fixtures", FIXTURES]);
  expect(ran.out).toContain("v0.14.0");
  expect(ran.out).toContain("v0.14.50");
  expect(failingLines(ran.out)).toEqual([]);
  expect(ran.code).toBe(0);
});

test("test_synthetic_fixture_fails_the_probe", async () => {
  const ran = await runProbe(["--fixtures", SYNTHETIC]);
  const fails = failingLines(ran.out);
  // The line has to name both the release and the package it fails on (S6).
  expect(fails.length).toBe(1);
  expect(fails[0]?.includes(SYNTHETIC_TAG)).toBe(true);
  expect(fails[0]?.includes("issue-comments")).toBe(true);
  expect(ran.code).toBe(1);
});

test("test_from_and_max_narrow_the_probe", async () => {
  const ran = await runProbe(["--fixtures", FIXTURES, "--from", "v0.14.50", "--max", "1"]);
  expect(ran.out).toContain("v0.14.50");
  expect(ran.out).not.toContain("v0.14.0");
  expect(ran.code).toBe(0);
});

test("test_from_tag_is_always_probed", async () => {
  // max 1 keeps from, so the newer release is left out and only the record's own tag is probed.
  const ran = await runProbe(["--fixtures", FIXTURES, "--from", "v0.14.0", "--max", "1"]);
  expect(ran.out).toContain("v0.14.0");
  expect(ran.out).not.toContain("v0.14.50");
  expect(failingLines(ran.out)).toEqual([]);
  expect(ran.code).toBe(0);
});

test("test_nothing_to_probe_is_not_a_failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-empty-"));
  try {
    const ran = await runProbe(["--fixtures", dir]);
    expect(ran.code).toBe(0);
    expect(failingLines(ran.out)).toEqual([]);
    expect(ran.err).toContain("no releases");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("test_gh_failure_exits_2", async () => {
  const empty = mkdtempSync(join(tmpdir(), "probe-nopath-"));
  try {
    const ran = await runProbe([], { PATH: empty, GH_TOKEN: "", UPSTREAM_REPO: "trail-openers/pi-rukas" });
    expect(ran.code).toBe(2);
    expect(ran.err).toContain("gh");
    expect(failingLines(ran.out)).toEqual([]);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("test_bad_flag_exits_2", async () => {
  const ran = await runProbe(["--fixtures", FIXTURES, "--max", "many"]);
  expect(ran.code).toBe(2);
  expect(ran.err).toContain("usage");
});

test("test_unknown_flag_exits_2", async () => {
  const ran = await runProbe(["--wat"]);
  expect(ran.code).toBe(2);
  expect(ran.err).toContain("usage");
});
