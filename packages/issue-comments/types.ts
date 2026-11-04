// Every shape shared by the issue-comments package (spec S9).

/** Where a comment came from upstream. Exactly the six names in spec S2. */
export type CommentSource =
  | "issue-comment"
  | "pr-comment"
  | "review"
  | "review-comment"
  | "fixer"
  | "refresh";

/** One comment, as it appears in `comments.json`. `pr`, `path` and `line` are present only where they apply. */
export interface CommentItem {
  source: CommentSource;
  id: number;
  by: string;
  at: string;
  url: string;
  text: string;
  pr?: number;
  path?: string;
  line?: number;
}

/** The parsed `comments.json`. `items` stays unknown until `validItem` has checked each one. */
export interface CommentsBlob {
  version: 1;
  issue: number;
  until: string;
  items: unknown[];
}

/** Test fixture: `blob` or `raw` override the default `{version, issue, until, items}` blob; `blob: null` writes no blob file. */
export interface FixtureOpts {
  dir: string;
  manifest: Record<string, unknown>;
  blob?: Record<string, unknown> | null;
  raw?: Uint8Array;
  symlink?: boolean;
  blobItems?: CommentItem[];
  until?: string;
}

/** Where the fixture put its files. `blobPath` is "" when no blob was written. */
export interface FixturePaths {
  dir: string;
  manifestPath: string;
  blobPath: string;
}

/** One directory scanned for a manifest + blob pair. */
export type ReadOutcome = { ok: true; dir: string; blob: CommentsBlob } | { ok: false; reason: string };

/** All directories scanned. `no dirs` and `ambiguous` carry the directories they were given. */
export type CollectOutcome =
  | ReadOutcome
  | { ok: false; reason: "no dirs" | "ambiguous"; dirs: string[] };

/** The rendered message body plus the counts for the stderr line. */
export interface Rendered {
  text: string;
  count: number;
  bytes: number;
  dropped: number;
}
