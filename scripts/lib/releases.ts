import type { PolyfillRecord, ProbeRow } from "./types";

// pi-rukas releases are tagged v<major>.<minor>.<patch>; anything else in the tag
// list (rc suffixes, moving labels) is not a release the probe can speak about.
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

type Version = [number, number, number];

function parseTag(tag: string): Version | undefined {
  const m = TAG.exec(tag);
  if (m === null) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * The releases to probe for one package: the newest `max` tags at or after `from`,
 * newest first. `from` keeps a slot even when it is older than that window, and is
 * never invented when upstream has no such tag.
 */
export function releaseTags(from: string, tags: string[], max: number): string[] {
  const fromV = parseTag(from);
  if (fromV === undefined || max <= 0) return [];

  const candidates: { tag: string; v: Version }[] = [];
  for (const tag of tags) {
    const v = parseTag(tag);
    if (v !== undefined && compare(v, fromV) >= 0) candidates.push({ tag, v });
  }
  candidates.sort((a, b) => compare(b.v, a.v));

  const picked = candidates.slice(0, max);
  const fromTag = candidates.find((c) => compare(c.v, fromV) === 0);
  if (fromTag !== undefined && !picked.some((c) => c.tag === fromTag.tag)) {
    picked.pop();
    picked.push(fromTag);
  }
  return picked.sort((a, b) => compare(b.v, a.v)).map((c) => c.tag);
}

/** Code only: line and block comments carry prose and braces the scans below must not see. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The body of pi-rukas's `HEADLESS_FEATURES` object, where `--capabilities` gets its feature names. */
function headlessFeatures(source: string): string | undefined {
  const code = stripComments(source);
  const declared = /HEADLESS_FEATURES\s*=\s*\{/.exec(code);
  if (declared === null) return undefined;
  const open = declared.index + declared[0].length - 1;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return undefined;
}

const FEATURE_ENTRY = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(true|false)/g;

/** A release lists a feature when `HEADLESS_FEATURES` declares it `: true`; a non-boolean entry is not a listing. */
function listsFeature(source: string, feature: string): boolean {
  const block = headlessFeatures(source);
  if (block === undefined) return false;
  let listed = false;
  for (const entry of block.matchAll(FEATURE_ENTRY)) {
    if (entry[1] === feature) listed = entry[2] === "true";
  }
  return listed;
}

// active and merged both mean the sandbox installs the polyfill, and PROCESS.md step 5
// skips it once the feature is native: a release listing it while the record still
// names it is the mismatch S6 fails CI on. released and declined are already retired.
function installed(state: string): boolean {
  return state === "active" || state === "merged";
}

/**
 * One row per (package, release) pair, in the order the packages and documents are given.
 * `docs[tag]` is the source text of `extension/src/headless/capabilities.ts` at that tag.
 */
export function probeReleases(pkgs: PolyfillRecord[], docs: Record<string, string>): ProbeRow[] {
  const rows: ProbeRow[] = [];
  for (const pkg of pkgs) {
    for (const [tag, doc] of Object.entries(docs)) {
      const lists = listsFeature(doc, pkg.upstreamFeature);
      rows.push({
        tag,
        package: pkg.name,
        state: pkg.state,
        lists,
        fail: lists && installed(pkg.state),
      });
    }
  }
  return rows;
}
