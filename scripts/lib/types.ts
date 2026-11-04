// Every shape shared by the tracking scripts (spec S9).

/** One `packages/<name>/polyfill.json`, flattened: the nested `upstream` fields are split out. */
export interface PolyfillRecord {
  name: string;
  state: string;
  from: string;
  upstreamIssue: string;
  upstreamFeature: string;
  pr: number | null;
  until: string | null;
  /** Repo-relative path to the record, so `git` can be run against it. */
  path: string;
}

/** One (package, pi-rukas release) pair from the capability probe (spec S6). */
export interface ProbeRow {
  tag: string;
  package: string;
  state: string;
  lists: boolean;
  fail: boolean;
}

/** What the upstream issue looks like right now. */
export interface UpstreamState {
  state: "open" | "closed";
  mergedPr: { number: number; mergeCommit: string } | null;
}

/** The titles already open here, so the tracker never files the same thing twice (spec S7). */
export interface OpenTitles {
  prs: string[];
  issues: string[];
}

/** One thing the tracker would do. `patch` is the `polyfill.json` change a PR proposes. */
export interface TrackAction {
  kind: "pr-merged" | "pr-released" | "pr-declined" | "issue-retire" | "issue-decide" | "issue-reminder";
  title: string;
  body: string;
  patch?: Record<string, unknown>;
}

/** How `runTrack` reaches the world. Every seam is injectable so the tracker's tests stay offline. */
export interface TrackOpts {
  dryRun: boolean;
  fetchUpstream?: (issue: string) => UpstreamState;
  listOpen?: (repo: string) => OpenTitles;
  compare?: (tag: string, sha: string) => string;
  now?: Date;
}
