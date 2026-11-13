# AGENTS.md

Rules for agents working in this repository. Read `README.md` for what is
here, `PROCESS.md` for how a polyfill is filed, built, used, tracked and
retired, and `docs/` for the design.

## What this is

tehas-polyfill holds pi extensions that give tehas a pi-rukas feature before a
pi-rukas release ships it. Each one is removed once pi-rukas has the feature
natively. tehas installs none: an image carries one only when its operator
builds it in and names it in the `tehas.rukas.polyfills` label (PROCESS.md, step 5).

| Path | What it is |
| --- | --- |
| `packages/<name>/` | One polyfill per upstream issue, named after its feature |
| `scripts/` | The capability probe, the upstream tracking, and their tests and fixtures |
| `docs/` | Specs, plans, and the register of tehas's stand-ins |
| `.github/workflows/` | CI (`polyfill-tests.yml`) and the upstream tracking (`track.yml`) |

## Hard rules

1. **A polyfill does what its upstream issue specifies and no more.** A new
   need goes upstream first (PROCESS.md, "Rules").
2. **Build only on pi's public hooks.** Patching pi-rukas source is not
   allowed. What an extension cannot match is written down in its README.
3. **A polyfill never quietly becomes permanent.** Its state in the
   package's metadata is `active`, `merged`, `released` or `declined`, kept
   true by the tracking workflow and its pull requests.
4. **Versions are pinned by release tag, never by commit hash.**
5. **Tests first.** Every behaviour change comes with a test. A polyfill's
   tests are its upstream issue's tests, where an extension can meet them.
6. **Do not edit your own gates.** `AGENTS.md`, `.pi/verify-cmd` and the CI
   workflows change only in a pull request a person reviews.
7. **Nothing merges on its own.** Open a pull request and stop.

## The gate

`.pi/verify-cmd` must pass before a pull request is opened. It runs what CI
runs: `bun run test`, `bunx tsc --noEmit` and the capability probe on its
fixtures.

## Style

Plain and direct prose, short sentences. Comments explain why, and only when
the code does not say it.
