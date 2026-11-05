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
- `--dry-run` prints what it would do and changes nothing.
- Filing an issue on `TEHAS_REPO` is a cross-repo call and needs `TEHAS_TRACKING_TOKEN`. Without it
  a real run exits 2 naming that variable and files nothing; it never falls back to the workflow's
  own token, and it never quietly skips.

## Release lists: what counts, and the page limit

- A **draft** release is not a release nobody can install, so it is never listed — not as a probe
  row and not as a candidate for a record's `until`. A **prerelease** is a release and is listed;
  the PR and issue body name the tag the tracker chose, so a prerelease `until` is visible to the
  human who reviews the PR.
- The containment scan (`until`: the first release that carries the merge commit) walks **every**
  release at or after the record's `from`, oldest first, with no cap, and stops at the first hit.
  The 12-release window is the probe's, not the tracker's.
- `gh api repos/<upstream>/releases?per_page=100` returns one page of at most 100 releases. If that
  call comes back with exactly 100, upstream has more releases than this tool fetched and an older
  one could carry the merge commit, so both tools **exit 2 naming the limit** rather than silently
  scanning a shorter list. When upstream passes 100 releases, the call has to paginate.
