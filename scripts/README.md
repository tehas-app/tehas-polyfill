# scripts

Two tools, both run by GitHub Actions and both testable offline through their seams.

## `scripts/capability_probe.ts` (spec S6)

One line per (polyfill, pi-rukas release), from each package's `from` to the newest release. A
release's capabilities are the source of `extension/src/headless/capabilities.ts` at its tag.

```
bun run scripts/capability_probe.ts [--from <tag>] [--max <n>] [--fixtures <dir>]
```

- Exit 0 nothing to report, 1 a release lists a feature a still-installed polyfill provides, 2 the
  probe itself could not run.
- `--fixtures <dir>` reads `<dir>/<tag>.ts` instead of calling `gh`: that is what
  `.github/workflows/polyfill-tests.yml` runs, so the per-PR job is offline and deterministic.
  `scripts/fixtures/capabilities/` holds real upstream snapshots only; the fixture that declares
  the polyfilled feature is `scripts/fixtures/synthetic/v0.14.99.ts` and is used only by tests that
  need the probe to fail.
- The window is at most 12 releases, with the package's own `from` keeping a slot.

## `scripts/track.ts` (spec S7, PROCESS.md step 6)

Reads each tracked `packages/*/polyfill.json`, asks `decide.ts` what to file, and files it through
`forge.ts`: a proposed record change lands on its own `track/<package>-<action>` branch and the PR
that names that branch, never in the checkout the run stands in.

```
bun run scripts/track.ts [--dry-run]
```

- Exit 0 nothing failed (including "nothing to do"), 2 a bad flag or a call that failed. A failed
  run leaves every `polyfill.json` byte-identical.
- The repository it files PRs into comes from `GITHUB_REPOSITORY`, or from the checkout's `origin`
  remote. A run that can name it neither exits 2 naming `GITHUB_REPOSITORY` and files nothing — it
  never files at whatever directory it happens to stand in.
- `--dry-run` prints what it would do and changes nothing. It still makes the read-only `gh` calls:
  a dry run is not offline, it is only non-filing.
- Idempotence reads open titles with `--limit 200`, because `gh pr list` and `gh issue list` stop at
  30 by default and an older proposal would otherwise look unfilable-by-title in name only.
- **An upstream issue that is open and explicitly not taken on is not tracked.** The one `gh api
  repos/<upstream>/issues/<n>` read already carries the issue's `labels`, so the tracker reads them
  beside its state and its pull request. A label in `NOT_TAKEN_ON_LABELS` (`scripts/lib/decide.ts`
  — `frozen`, matched case-insensitively) means the proposal is parked: for such an issue the run
  files **nothing** — no retire issue, no decide issue, and no 60-day reminder — and its line says
  `nothing to do (open and not taken on (frozen))` so a reader can tell that from "open, not
  overdue". The set lives in that one constant, not scattered through the decisions.
  - A missing or empty label list is a **wait**, not a decline. Only a closed-without-a-merge
    becomes `declined`, as PROCESS.md step 6.3 says; an open issue labelled `wontfix` is still
    tracked, because mapping an open refusal to a state is a different rule.
  - The gate sits only on the open branch: a merged pull request is itself proof upstream took the
    work on, so a frozen-labelled issue whose PR merged still goes merged, then released.
  - The reading is recomputed from the labels every run and nothing about them is stored, so both
    directions are free: an issue that gains the label stops being tracked on the next run, and one
    a person un-freezes is tracked again (reminder-eligible at 60 days) with no change to
    `polyfill.json`. A reminder an earlier run filed before the label appeared stays open — the
    tracker opens issues and never closes them.
  - The 60-day reminder in PROCESS.md is written unconditionally, and this is the deliberate
    exception to it: tehas polyfills only work upstream has taken on, so a reminder that reads as
    though a parked proposal had moved would ask a human to wait on nothing.
- The commit step names its own committer identity: `-c user.name=<name> -c user.email=<email>`,
  taken from `TEHAS_TRACKER_GIT_NAME` and `TEHAS_TRACKER_GIT_EMAIL` when they are set, and otherwise
  the defaults `tehas-polyfill-tracker` and `tehas-polyfill-tracker@users.noreply.github.com`. A
  real run must not depend on the runner having a global git config: without an identity, `git
  commit` is where the run dies.
- Only a decision that **files an issue on `TEHAS_REPO`** is a cross-repo call, and only that one
  needs `TEHAS_TRACKING_TOKEN`: a decision that files a PR in this repository runs on the workflow's
  own token. A run that cannot file on tehas exits 2 naming that variable and files **nothing**, not
  even the PR it decided to open first — a run files everything or nothing. It never falls back to
  the workflow token for tehas, and it never quietly skips.

## Release lists: what counts, and the page limit

- A record's `from` has to be a release tag, `v<major>.<minor>.<patch>`. It is the floor of the
  containment scan, so an unparseable one matches no release at all: the tracker writes a stderr
  line naming it instead of deciding from an empty list.

- A **draft** release is not a release nobody can install, so it is never listed — not as a probe
  row and not as a candidate for a record's `until`. A **prerelease** is a release and is listed;
  the PR and issue body name the tag the tracker chose, so a prerelease `until` is visible to the
  human who reviews the PR.
- The containment scan (`until`: the first release that carries the merge commit) walks **every**
  release at or after the record's `from`, oldest first, with no cap, and stops at the first hit.
  The 12-release window is the probe's, not the tracker's.
- `gh api repos/<upstream>/releases?per_page=100` returns one page of at most 100 releases. If that
  call comes back with 100 or more, upstream has more releases than this tool fetched and an older
  one could carry the merge commit, so both tools **exit 2 naming the limit** rather than silently
  scanning a shorter list. When upstream passes 100 releases, the call has to paginate.
