# tehas stand-ins

The polyfill-style functions tehas carries today for pi-rukas features and defects no pi-rukas
release has yet, each with its tehas ticket, and for each whether it is a candidate for a package
in this repository or a tehas-side workaround outside this repository's scope.

tehas-app/tehas-polyfill#3 carries the same table.

## Snapshot

Read from tehas-app/tehas at commit `62e03219`, on 2026-11-04, across `lib/`, `libexec/`,
`scripts/`, `install.sh`, `bootstrap.sh`, `host/sandbox/`, `console/` and `host/docs/`. The counts
there: `git ls-tree -r --name-only 62e03219 -- console` lists 346 files under `console/`, 255 of
them `.rs`, and `console/` holds every `.rs` file that tree has at that commit. tehas moves. A row
that was true at that commit is not necessarily true now, and this document carries no mechanism to
notice. When a row is worked, re-read the tehas side before acting on it.

## None of these is a registered polyfill

tehas has the mechanism: `scripts/polyfills.sh`, `lib/polyfill-<feature>.sh`,
`test/polyfill_<f>_test.sh`, the `# polyfill <f>` line marker, and `tehas-cycle caps mode`
answering `native | polyfill | off | error`. Nothing uses it. `scripts/polyfills.sh list` prints
nothing: no `lib/polyfill-*.sh` has ever existed in the tree, and `TEHAS_RUKAS_WORKAROUNDS` has no
live entry. Every row below is an unregistered stand-in — code that supplies a missing pi-rukas
behaviour without being recorded in tehas's own polyfill register.

## What tehas keys on instead of a pin

CHANGELOG.md says tehas keeps no version pin for this repository and points here for what it does
instead. At `62e03219`, tehas's own head, it names this repository nowhere: no install of it, no
`TEHAS_POLYFILL_VERSION` (the name PROCESS.md step 7 assumes), no line in `host/versions.env`. What
tehas pins is the tooling a cycle runs, each named by version in `host/versions.env`, though not
every one checked the same way: Rust, jq, codebase-memory-mcp and shellcheck by the SHA-256 of what
is downloaded (`RUSTUP_SHA256`, `JQ_SHA256`, `CBM_INSTALLER_SHA256`, `SHELLCHECK_SHA256`); Playwright
by the hash of its npm lockfile (`PLAYWRIGHT_LOCK_SHA256`) — that file says outright that an npm
tool is pinned by a lockfile, not by a download; and vipune by its cargo version alone, installed by
`bootstrap.sh` with `cargo install vipune --version`, where only the two files of its embedding
model carry checksums (`VIPUNE_MODEL_SHA256_ONNX`, `VIPUNE_MODEL_SHA256_TOKENIZER`). For pi-rukas
that same file says outright it is not pinned: `PI_RUKAS_FOLLOW=release:0` follows the newest tag of
the major line tehas works with, `lib/rukas.sh` resolves that to a commit. The form that names one
commit exactly, `commit:<40 hex>`, is accepted by `lib/rukas.sh` and by the settings loader, an
instance may set it in its `instance.env`, and nothing tehas itself ships sets it: the release workflow
passes no pin ("a release follows the line its versions.env names"), and only
`scripts/pack-release.sh` given `--rukas-commit` writes it into a packed release. The sandbox build
labels each image `tehas.rukas=<the pi-rukas commit it was built on>`, which the dispatcher and the
tehasbot cycle read back. Whether a polyfill is used at all turns on the runner's `--capabilities`
answer, not on a version number: `tehas-cycle caps mode` answers `native | polyfill | off | error`,
`polyfills.sh expired` and `polyfills.sh prune` take a caps file, and `scripts/tag-release.sh`
prunes before it tags. So PROCESS.md step 7's "move tehas's pi-rukas pin" has nothing to move yet:
giving tehas a pin for this store is a change to tehas and to PROCESS.md, not a row of this record.

## Classifications

Each row carries exactly one of these four.

| Classification | Meaning |
| -------------- | ------- |
| package candidate | Could be built as a package here, per PROCESS.md. PROCESS.md step 1 comes first: an upstream pi-rukas issue is the specification, so a candidate with no upstream issue yet is a ticket to file one, not a ticket to write code. |
| tehas-side host workaround | Lives out of scope here, in tehas's environment, shims or sandbox image. It cannot be a pi extension, so it is not this repository's work. |
| capability guard that waits | tehas checks for the capability and refuses or holds until a pi-rukas release answers it. This is the shape the polyfill mechanism exists to avoid, and tehas chose to wait. |
| not polyfill-style | Looks like a stand-in but is not one: the upstream premise is false, the tool is being used as designed, or another ticket already covers it. Recorded so nobody files it again. |

## Inventory

| Stand-in | Where it lives in tehas | Tehas ticket | Upstream reference | Classification |
| -------- | ----------------------- | ------------ | ------------------ | -------------- |
| `images.md`: the model-written description of each image, for the steps and models pi-rukas shows no pixels to (`TEHAS_WORK_DESCRIBE`), filed here as tehas-app/tehas-polyfill#4 | Behaviour stand-in: work-directory artefact gated by `TEHAS_WORK_DESCRIBE` | #125; PR #214, PR #219 | trail-openers/pi-rukas#1239, open, no pull request | package candidate |
| The text files an issue links, fetched, mounted and listed under `files` in the manifest, which no pi-rukas release reads (`TEHAS_WORK_FILES`), filed here as tehas-app/tehas-polyfill#5 | Behaviour stand-in: manifest `files` list gated by `TEHAS_WORK_FILES` | #127; PR #214, PR #219 | None named. PROCESS.md step 1 has to happen first. | package candidate |
| The review verdict read back out of comment prose: pi-rukas holds the lens-review verdict as data but publishes no verdict in the host's result contract, so tehas matches pi-rukas's own `<!-- pi-rukas:lens-residuals` marker and each severity line to decide WIP, STUCK or nothing | Behaviour stand-in: comment parsing on the marker | #1179 (PR #1181), #1305 | None yet — PROCESS.md step 1 has to happen first, asking for the verdict in the result contract. | package candidate |
| `retry-context.md`: the pull request review comments written for a retry, which nothing upstream reads — superseded by tehas #1492 and this repository's `issue-comments` package | Behaviour stand-in: work-directory artefact | #135; PR #219 | trail-openers/pi-rukas#2020 | not polyfill-style |
| The handoff comment and its label: `PI_ENSEMBLE_HANDOFF_CHANNEL=host`, which makes the pi-rukas driver post no handoff comment and apply no `needs-human-attention` label — its other cycle comments still post — and the tehasbot cycle posts the one park comment | Behaviour stand-in: runner environment plus the tehasbot cycle post | #232; PR #266 | None named | tehas-side host workaround |
| The gate kind absent from the runner's stable NDJSON vocabulary, read from two candidate names `target.kind` and `tier` | Behaviour stand-in: consumer of the runner's NDJSON | #870; PR #921 | None — the runner's own output | not polyfill-style |
| Per-role token usage absent from the v0.12.80 result, read from tehas's own `progress.json` instead | Behaviour stand-in: tehas's own `progress.json` | #323; PR #375 | None — the runner's own output contract | not polyfill-style |
| `PI_ENSEMBLE_REVIEW_WALL_CLOCK_MS` raised to 3 hours, because pi-rukas's 90-minute review cap ended most cycles after one fix round | Setting workaround for an upstream default: runner environment | #479 | None named | tehas-side host workaround |
| `TEHAS_CHILD_TIMEOUT` and `TEHAS_VERIFY_TIMEOUT` passed on as `PI_ENSEMBLE_SPAWN_TIMEOUT_MS` and the two verify timeout names, so a child is not stopped at pi-rukas's own default while the cycle's budget is hours; `PI_ENSEMBLE_VERIFY_CONCURRENCY` derived from the container's share rather than pi-rukas's rule for a host | Setting workaround for an upstream default: runner environment | #932; PR #939 | None named | tehas-side host workaround |
| The plan descriptor padded with the issue number to clear pi-rukas's six-word planning floor, and capped at 62 characters because pi-rukas keeps 72 in all | Setting workaround for an upstream default: plan descriptor construction | #899; PR #915 | None named | tehas-side host workaround |
| `host/sandbox/gh-shim`, installed earlier on `PATH` than the image's `gh`: every call re-reads the GitHub App token the host keeps fresh, and one rate-limited call is tried again | Shim installed by tehas: `host/sandbox/gh-shim` | #642 (issue #639), #742 (issue #681) | None named | tehas-side host workaround |
| Pull request title and label writes made through `gh api` REST, because `gh pr edit` asks a GraphQL mutation the App token may not answer | Shim installed by tehas: PR write calls | #1179 (PR #1181); origin #471 | None named | tehas-side host workaround |
| The runner named by its absolute path `/opt/pi-rukas/bin/pi-rukas-headless`, because the `PATH` entry of pi-rukas v0.12.80 does not find its own source | Shim installed by tehas: runner invocation | PR #263 | None named | tehas-side host workaround |
| wigolo taken off the image's `PATH`, because the base installs it with npm scripts off and its native build is missing | Sandbox image and host workaround | #261, PR #279 (both numbers now 404) | None named | tehas-side host workaround |
| The cargo registry made writable by the cycle's user | Sandbox image and host workaround | #735; PR #901 | None named | tehas-side host workaround |
| The in-container user remapped to the host user's id | Sandbox image and host workaround | #735; PR #901 | None named | tehas-side host workaround |
| Rust, jq and codebase-memory-mcp pinned, because the base pins none | Sandbox image and host workaround: version pins | #860 (PR #865), #1390 | None named | tehas-side host workaround |
| vipune's embedding model baked into the image, because a cycle has no route to its publisher | Sandbox image and host workaround | #390, PR #426 (both numbers now 404) | None named | tehas-side host workaround |
| The code indexer installed through a tmpfs, because its own installer cannot publish onto overlayfs under Docker inside an unprivileged Incus container | Sandbox image and host workaround | #376; PR #378 | None named | tehas-side host workaround |
| The indexer's umask trap for a group-writable `~/.local` | Sandbox image and host workaround | None | DeusData/codebase-memory-mcp#1483, open — a third-party repository, not pi-rukas | tehas-side host workaround |
| pi-rukas's release tags fetched with `--force`, because upstream re-points them | Sandbox image and host workaround: tehas's update path | #793; PR #857 | None named | tehas-side host workaround |
| pi-rukas's installer run with `PI_ENSEMBLE_IMAGE` removed from the environment | Sandbox image and host workaround: install path | PR #34 | None named | tehas-side host workaround |
| The refresh needs `--continue-pr` | Capability guard that waits | #329; PR #351 | trail-openers/pi-rukas#1468 | capability guard that waits |
| Planning turns need `features.planTurns` | Capability guard that waits | #283, #485; PR #488 | None named | capability guard that waits |
| The weekly review needs the lens-review verb | Capability guard that waits | #507 | None named | capability guard that waits |
| The lean driver is refused outright | Capability guard that waits | #1100; PR #1136 | trail-openers/pi-rukas#1920, closed without a merged PR | capability guard that waits |
| Images of an issue are held while the image says its pi-rukas does not read the manifest | Capability guard that waits | #123; PR #211 | None named | capability guard that waits |
| `console/core/src/plan.rs` stripping a table rule from a pi-spec fence | Not polyfill-style: tehas's own poll-side pre-check | #1458; PR #1463 | None — pi-rukas writes no such rule and its reader drops none, so the upstream premise is false | not polyfill-style |
| The improvement loop answering "is the upstream fix in the build this cycle ran" through GitHub's compare API | Not polyfill-style: the improvement loop | #233; PR #243 | GitHub's own API, used as designed; the "build unknown" branch is uncertainty about tehas's own record | not polyfill-style |

## The three package candidates

- **Image descriptions** (`images.md`) — upstream trail-openers/pi-rukas#1239 is open with no pull
  request, so the specification exists. Filed here as tehas-app/tehas-polyfill#4.
- **Fetched issue text files** (`TEHAS_WORK_FILES`) — no upstream issue exists yet. PROCESS.md step 1
  has to happen first: file the pi-rukas issue, then build. Filed here as tehas-app/tehas-polyfill#5.
- **The lens-review verdict in the result contract** — no upstream issue exists yet, so PROCESS.md
  step 1 has to happen first, and the candidate is only real once that issue asks for the verdict in
  the contract. No ticket is filed for it here; filing one is PROCESS.md step 1's own deliverable,
  not part of this record.

None of the three is built. Building one is PROCESS.md step 4, in its own ticket; step 2 files the
host side and step 3 decides whether to polyfill at all, and neither of those is building.

## Numbers that no longer resolve

tehas numbers 220, 261, 279, 390, 426, 476 and 538 return 404 from tehas-app/tehas today; they
predate the repository transfer. Where this record names one it says so inline. A 404 is not
evidence the work did not happen — the row's fact came from the code at `62e03219`, not from the
ticket page. Number 426 appears once here, as the vipune embedding-model pull request, and it is
also in this list.

## What this record is not

- **Not a package.** `scripts/lib/state.ts`'s `readPackages()` enumerates every directory under
  `packages/` that holds a `polyfill.json`, and `.github/workflows/track.yml` feeds those records to
  `decide.ts`. This file lives under `docs/`, gains no `polyfill.json`, and is not a tracking input.
  Nothing here adds a row to the Polyfills table in README.md, which lists packages that ship.
- **Not a change to tehas.** This record changes no tehas code. It does not touch
  `scripts/polyfills.sh`, `lib/polyfill-<feature>.sh`, `TEHAS_RUKAS_WORKAROUNDS`,
  `host/sandbox/build.sh`, `host/versions.env` — tehas's only pin file, which PROCESS.md step 5 and
  this ticket's own scope list call `host/sandbox/versions.env`, a path tehas does not have —
  `TEHAS_POLYFILL_VERSION`, or the sandbox image.
- **Not a PROCESS.md change.** PROCESS.md has no category for a host-workaround register, a
  not-polyfill-style register, or a third-party upstream reference, and this record does not invent
  one. Adding those categories is its own chore (tehas-app/tehas-polyfill#6).
- **Not upstream tickets.** Filing the missing pi-rukas issues is PROCESS.md step 1, a ticket with
  its own deliverable.
