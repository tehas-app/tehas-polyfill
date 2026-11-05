---
record: tehas-stand-ins
canonical: true
snapshot_repo: tehas-app/tehas
snapshot_commit: 62e0321961c2dcce4a05a2e24682c7401490d8df
snapshot_date: 2026-11-04
classifications: [package candidate, tehas-side host workaround, capability guard that waits, not polyfill-style]
statuses: [open, superseded, built, native, declined]
gate: none
---

# tehas stand-ins

The polyfill-style functions tehas carries today for pi-rukas features and defects no pi-rukas
release has yet: each with its tehas ticket, its upstream reference, and whether it is a candidate
for a package in this repository or a tehas-side workaround outside this repository's scope.

**This file is the canonical copy of the register.** tehas-app/tehas-polyfill#3 carries no second
table: it is a pointer to this file, and this file is what to edit.
[CHANGELOG.md](CHANGELOG.md) names #3 as the record of what tehas does instead of a version pin;
that record is here. The Polyfills table in [README.md](README.md) lists only packages that ship
here, and no row of this register is such a package. What tehas keys on instead of a version pin is
its own record: [docs/tehas-pin-reality.md](tehas-pin-reality.md).

## Snapshot

Read from tehas-app/tehas at commit `62e0321961c2dcce4a05a2e24682c7401490d8df` (short `62e03219`)
on 2026-11-04, across `lib/`, `libexec/`, `scripts/`, `install.sh`, `bootstrap.sh`,
`host/sandbox/`, `console/` and `host/docs/`. Every name in this record — a path, an environment
variable, a flag, a file a cycle writes — is a tehas-side name read from that commit, and each row
names the tehas file it lives in. The counts were taken in a clone of tehas at that commit:
`git ls-tree -r --name-only 62e03219 -- console` lists 346 paths under `console/`, 255 of them
`.rs`, and those 255 are every `.rs` path that tree has.

### Staleness

tehas moves. A row true at the snapshot commit is not necessarily true now, and **nothing in this
repository checks it**: `readPackages()` in `scripts/lib/state.ts` enumerates only `packages/`
directories holding a `polyfill.json`, and `.github/workflows/track.yml` feeds those records to
`decide.ts`, so no gate, reminder or expiry reaches a row of this register. Drift here is found by
reading, never by a failure. Before working a row, re-read the tehas side at its current head. The
two anchors worth checking first: that the snapshot commit still resolves in a tehas clone, and
that `host/versions.env` and `scripts/polyfills.sh` still exist.

### Re-snapshotting

This is a mutable register, not a dated artifact; the dated point-in-time artifacts under `docs/`
are `docs/plans/` and `docs/specs/`, and this file is neither. A re-read of tehas replaces the rows
in place, so the evidence base of the content then standing is the pair `snapshot_commit` and
`snapshot_date` in the front matter, and the snapshot it replaces stands in this file's git history
rather than being overwritten silently. A re-snapshot changes the front matter in the same commit
that changes the rows, and names the new snapshot commit in its subject.

## None of these is a registered polyfill

tehas has the mechanism: `scripts/polyfills.sh`, `lib/polyfill-<feature>.sh`,
`test/polyfill_<f>_test.sh`, the `# polyfill <f>` line marker, and `tehas-cycle caps mode` answering
`native | polyfill | off | error`. Nothing uses it. `scripts/polyfills.sh list` prints nothing: no
`lib/polyfill-*.sh` has ever existed in the tree, and `TEHAS_RUKAS_WORKAROUNDS` — the settings key
that would name a registered one, read by `console/core/src/settings/load.rs` — has no live entry.
Every row below is an unregistered stand-in: code that supplies a missing pi-rukas behaviour without
being recorded in tehas's own polyfill register.

## No gate covers this file

Nothing validates the front matter, the row schema, the four classification strings, the five status
strings, or the snapshot anchor. `scripts/test/` covers the tracking tooling for
`packages/*/polyfill.json` only. The schema below is held by hand.

## Classifications

Each row carries exactly one of these four, spelled exactly as written here.

| Classification | Meaning |
| -------------- | ------- |
| package candidate | Could be built as a package here, per PROCESS.md. This is the only classification whose next step is PROCESS.md's **File the upstream issue**: an upstream pi-rukas issue is the specification, so a candidate with no upstream issue yet is a ticket to file one, not a ticket to write code. |
| tehas-side host workaround | Lives out of scope here, in tehas's environment, shims or sandbox image. It cannot be a pi extension, so it is not this repository's work. |
| capability guard that waits | tehas checks for the capability and does not proceed until a pi-rukas release answers it. How the non-proceeding surfaces is named per guard below, because the two shapes differ: **refuses** — an error exit naming the missing capability, in the command's output; **holds** — the work item stays where it was, with at most a log line. A hold is the shape that can hide a stalled cycle. This is the shape the polyfill mechanism exists to avoid, and tehas chose to wait. |
| not polyfill-style | Looks like a stand-in but is not one: the upstream premise is false, the tool is being used as designed, or another ticket already covers it. Recorded so nobody files it again. |

## Statuses

Each row also carries one status, mirroring the `state` vocabulary PROCESS.md gives
`polyfill.json` (`active`, `merged`, `released`, `declined`) and extended for a register that also
records rows that were never candidates. It exists so a row can be retired instead of only added to.

| Status | Meaning |
| ------ | ------- |
| open | Still a stand-in tehas needs. |
| superseded | Something else now does it: a tehas change, another ticket, or a package here. |
| built | Built as a package here; the row then also gains a row in README.md's Polyfills table. |
| native | A pi-rukas release ships it, and the stand-in retires. |
| declined | The upstream premise ended — the upstream issue closed without a merged PR — so waiting will never be answered and something else must be decided. PROCESS.md's **Track upstream** rule 3 is the same disposition for a registered polyfill, but nothing files that decide-what-happens-next issue for a row of this register: the tracking workflow reads `packages/*/polyfill.json` and never a `docs/` row. For `stand-in:lean-driver` the issue is tehas-side work, filed by whoever works the row. |

## Inventory

Each cell is a noun phrase. The explanation of why a row is a stand-in is the note its number
points at, in [Notes](#notes).

| id | Stand-in | Where it lives in tehas | Tehas ticket | Upstream reference | Classification | Status |
| -- | -------- | ----------------------- | ------------ | ------------------ | -------------- | ------ |
| `stand-in:images-md` | `images.md`: model-written image descriptions [^1] | work-directory artefact, gated by `TEHAS_WORK_DESCRIBE` | #125; PR #214, PR #219 | trail-openers/pi-rukas#1239 | package candidate | open |
| `stand-in:work-files` | `TEHAS_WORK_FILES`: issue text files in the manifest `files` list [^2] | manifest `files` list | #127; PR #214, PR #219 | None named | package candidate | open |
| `stand-in:lens-verdict` | `lens-verdict`: review verdict read back out of comment prose [^3] | comment parsing on the `pi-rukas:lens-residuals` marker | #1179 (PR #1181), #1305 | None named | package candidate | open |
| `stand-in:retry-context-md` | `retry-context.md`: review comments written for a retry [^4] | work-directory artefact | #135; PR #219 | trail-openers/pi-rukas#2020 | not polyfill-style | superseded |
| `stand-in:handoff-comment` | `PI_ENSEMBLE_HANDOFF_CHANNEL=host` [^5] | runner environment plus the tehasbot cycle post | #232; PR #266 | None named | tehas-side host workaround | open |
| `stand-in:gate-kind` | `gate-kind`: the gate kind absent from the runner's NDJSON vocabulary [^6] | consumer of the runner's NDJSON | #870; PR #921 | None — the runner's own output | not polyfill-style | open |
| `stand-in:per-role-tokens` | `per-role-tokens`: per-role token usage read from tehas's own `progress.json` [^7] | `console/analytics/src/run.rs` | #323; PR #375 | None — the runner's own output contract | not polyfill-style | open |
| `stand-in:review-wall-clock` | `PI_ENSEMBLE_REVIEW_WALL_CLOCK_MS` raised [^8] | instance env, `instances/tehas-tehas/instance.env` | #479 | None named | tehas-side host workaround | open |
| `stand-in:child-verify-timeouts` | `TEHAS_CHILD_TIMEOUT`, `TEHAS_VERIFY_TIMEOUT`, `PI_ENSEMBLE_VERIFY_CONCURRENCY` passed on [^9] | `console/core/src/sandbox.rs` | #932; PR #939 | None named | tehas-side host workaround | open |
| `stand-in:plan-descriptor` | `plan-descriptor`: the plan descriptor padded and capped [^10] | `console/src/plan/` | #899; PR #915 | None named | tehas-side host workaround | open |
| `stand-in:gh-shim` | `host/sandbox/gh-shim` [^11] | `host/sandbox/gh-shim` | #642 (issue #639), #742 (issue #681) | None named | tehas-side host workaround | open |
| `stand-in:pr-writes-rest` | `pr-writes-rest`: pull request title and label writes through `gh api` REST [^12] | `console/src/pr_title.rs` | #1179 (PR #1181); origin #471 | None named | tehas-side host workaround | open |
| `stand-in:runner-path` | `/opt/pi-rukas/bin/pi-rukas-headless` named by absolute path [^13] | `console/core/src/sandbox.rs`, the `RUNNER` constant | PR #263 | None named | tehas-side host workaround | open |
| `stand-in:wigolo-off-path` | wigolo taken off the image's `PATH` [^14] | `host/sandbox/Dockerfile` | #261, PR #279 (both numbers now 404) | None named | tehas-side host workaround | open |
| `stand-in:cargo-registry-writable` | cargo registry made writable by the cycle's user [^15] | `host/sandbox/Dockerfile` | #735; PR #901 | None named | tehas-side host workaround | open |
| `stand-in:user-remap` | in-container user remapped to the host user's id [^16] | `host/sandbox/Dockerfile`, `ARG TEHAS_UID` | #735; PR #901 | None named | tehas-side host workaround | open |
| `stand-in:toolchain-pins` | Rust, jq and codebase-memory-mcp pinned [^17] | `host/versions.env` | #860 (PR #865), #1390 | None named | tehas-side host workaround | open |
| `stand-in:vipune-model-image` | vipune's embedding model baked into the image [^18] | `host/versions.env`, `host/sandbox/Dockerfile` | #390, PR #426 (both numbers now 404) | None named | tehas-side host workaround | open |
| `stand-in:indexer-tmpfs` | code indexer installed through a tmpfs [^19] | `host/sandbox/Dockerfile` | #376; PR #378 | None named | tehas-side host workaround | open |
| `stand-in:indexer-umask` | the indexer's umask trap for a group-writable `~/.local` [^20] | `bootstrap.sh` | None | DeusData/codebase-memory-mcp#1483, open — a third-party repository, not pi-rukas | tehas-side host workaround | open |
| `stand-in:rukas-tags-force` | pi-rukas's release tags fetched with `--force` [^21] | `bootstrap.sh` | #793; PR #857 | None named | tehas-side host workaround | open |
| `stand-in:rukas-installer-env` | pi-rukas's installer run with `PI_ENSEMBLE_IMAGE` removed [^22] | `bootstrap.sh` | PR #34 | None named | tehas-side host workaround | open |
| `stand-in:refresh-continue-pr` | `--continue-pr` [^23] | `console/dispatch/src/decide/retry.rs` | #329; PR #351 | trail-openers/pi-rukas#1468 | capability guard that waits | open |
| `stand-in:plan-turns` | `features.planTurns` [^24] | `console/src/plan/start.rs` | #283, #485; PR #488 | None named | capability guard that waits | open |
| `stand-in:lens-review-verb` | the `lens-review --since --json` verb [^25] | `console/src/review.rs` | #507 | None named | capability guard that waits | open |
| `stand-in:lean-driver` | `tehas:lean` driver [^26] | `console/cycle/src/start.rs` | #1100; PR #1136 | trail-openers/pi-rukas#1920, closed without a merged PR | capability guard that waits | declined |
| `stand-in:images-held` | issue images held while the image says its pi-rukas does not read the manifest [^27] | `console/attach/src/given.rs` | #123; PR #211 | None named | capability guard that waits | open |
| `stand-in:plan-rs-table-rule` | `console/core/src/plan.rs` stripping a table rule from a pi-spec fence [^28] | `console/core/src/plan.rs`, poll-side pre-check | #1458; PR #1463 | None — pi-rukas writes no such rule | not polyfill-style | open |
| `stand-in:improve-compare-api` | the improvement loop's GitHub compare API call [^29] | the improvement loop | #233; PR #243 | GitHub's own API, used as designed | not polyfill-style | open |

## Notes

[^1]: `images.md` — the description of each image the model writes, for the steps and models
    pi-rukas shows no pixels to. Gated by `TEHAS_WORK_DESCRIBE` (`console/core/src/settings/rules.rs`,
    `console/cycle/src/describe.rs`). Filed here as tehas-app/tehas-polyfill#4.
[^2]: `TEHAS_WORK_FILES` — the text files an issue links, fetched, mounted and listed under `files`
    in the manifest, which no pi-rukas release reads (`console/attach/src/given.rs`,
    `console/core/src/settings/load.rs`). Filed here as tehas-app/tehas-polyfill#5.
[^3]: `lens-verdict` — pi-rukas holds the lens-review verdict as data but publishes no verdict in the
    host's result contract, so tehas matches pi-rukas's own `pi-rukas:lens-residuals` HTML marker in
    a comment body (`console/src/pr_title.rs`, `REVIEW_MARK`). The comment counts only when its
    author is the bot account, and only the severities `MEDIUM` and `LOW` pass: an unknown severity
    blocks, so a new one cannot pass unread. See the trust boundary and the absent-marker branch
    under [The three package candidates](#the-three-package-candidates).
[^4]: `retry-context.md` — superseded by tehas #1492 and this repository's `issue-comments` package,
    which is why its status is `superseded` rather than a live stand-in.
[^5]: `PI_ENSEMBLE_HANDOFF_CHANNEL=host` makes the pi-rukas driver post no handoff comment and apply
    no `needs-human-attention` label — its other cycle comments still post — and the tehasbot cycle
    posts the one park comment (`console/core/src/sandbox.rs`, `console/cycle/src/work.rs`,
    `host/docs/features.md`).
[^6]: `gate-kind` — read from two candidate names, `target.kind` and `tier`.
[^7]: `per-role-tokens` — absent from the v0.12.80 result, so tehas reads its own
    `state/cycles/<n>.progress.json` instead.
[^8]: `PI_ENSEMBLE_REVIEW_WALL_CLOCK_MS` — pi-rukas's default is 90 minutes, which ended most cycles
    after one fix round. The instance sets `10800000`, which is 3 hours.
[^9]: `TEHAS_CHILD_TIMEOUT` and `TEHAS_VERIFY_TIMEOUT` are passed on as `PI_ENSEMBLE_SPAWN_TIMEOUT_MS`
    and the two verify timeout names, so a child is not stopped at pi-rukas's own default while the
    cycle's budget is hours; `PI_ENSEMBLE_VERIFY_CONCURRENCY` is derived from the container's share
    rather than pi-rukas's rule for a host.
[^10]: `plan-descriptor` — padded with the issue number to clear pi-rukas's six-word planning floor,
    and capped at 62 characters because pi-rukas keeps 72 in all.
[^11]: `host/sandbox/gh-shim` is installed earlier on `PATH` than the image's `gh`: every call
    re-reads the GitHub App token the host keeps fresh, and one rate-limited call is tried again.
    That shim is the container's route to the App token, which is what makes the supply-chain note in
    [docs/tehas-pin-reality.md](tehas-pin-reality.md) matter.
[^12]: `pr-writes-rest` — `gh pr edit` asks a GraphQL mutation the App token may not answer.
[^13]: `runner-path` — the `PATH` entry of pi-rukas v0.12.80 does not find its own source.
[^14]: `wigolo-off-path` — the base installs wigolo with npm scripts off, so its native build is
    missing and every call died on a missing bindings file.
[^15]: `cargo-registry-writable` — `CARGO_HOME` under the cycle's user.
[^16]: `user-remap` — `usermod`/`groupmod` on the image's user, from `ARG TEHAS_UID`.
[^17]: `toolchain-pins` — the base pins none of these. How each is checked, and what is not checked
    at all, is [docs/tehas-pin-reality.md](tehas-pin-reality.md).
[^18]: `vipune-model-image` — a cycle has no route to the model's publisher.
[^19]: `indexer-tmpfs` — the indexer's own installer cannot publish onto overlayfs under Docker
    inside an unprivileged Incus container.
[^20]: `indexer-umask` — `bootstrap.sh` says the default umask on Ubuntu leaves those directories
    group-writable.
[^21]: `rukas-tags-force` — `git fetch --tags --force` for the pi-rukas clone, because upstream
    re-points a release tag now and then and git refuses to move a tag backwards. See
    [docs/tehas-pin-reality.md](tehas-pin-reality.md) for what that means for verification.
[^22]: `rukas-installer-env` — a login shell exports `PI_ENSEMBLE_IMAGE` as the tehas sandbox image,
    which the installer would otherwise take as its own image to build.
[^23]: `refresh-continue-pr` — the refresh needs `--continue-pr`: the cycle checks out the issue's
    open pull request instead of starting a new branch.
[^24]: `plan-turns` — planning turns need `features.planTurns` in the image's `--capabilities`.
[^25]: `lens-review-verb` — the weekly review runs `pi-rukas-headless lens-review --since <commit>
    --json`.
[^26]: `lean-driver` — refused outright: tehas names the driver it cannot run and starts no cycle in
    its place. Upstream trail-openers/pi-rukas#1920 is closed without a merged PR, so this wait has
    no release that will answer it; see the `declined` status above.
[^27]: `images-held` — the manifest says the images were fetched and that the pi-rukas in the image
    does not read them, so the cycle is given nothing in their place.
[^28]: `plan-rs-table-rule` — pi-rukas writes no such rule and its reader drops none, so the upstream
    premise is false.
[^29]: `improve-compare-api` — answers "is the upstream fix in the build this cycle ran". The "build
    unknown" branch is uncertainty about tehas's own record, not about GitHub's answer.

## The three package candidates

- **Image descriptions** (`stand-in:images-md`) — upstream trail-openers/pi-rukas#1239 is open with
  no pull request, so the specification exists. Filed here as tehas-app/tehas-polyfill#4.
- **Fetched issue text files** (`stand-in:work-files`) — no upstream issue exists yet. Filed here as
  tehas-app/tehas-polyfill#5.
- **The lens-review verdict in the result contract** (`stand-in:lens-verdict`) — no upstream issue
  exists yet, and the candidate is only real once such an issue asks for the verdict in the contract.
  No ticket is filed for it here; filing one is **File the upstream issue**'s own deliverable, not
  part of this record.

None of the three is built. Building one is PROCESS.md's **Build it**, in its own ticket;
**File the host side** and **Decide whether to polyfill** come before it, and neither is building.

**The trust boundary on `stand-in:lens-verdict`.** The marker sits in a comment body, and anyone who
may comment on a public repository may write one. What tehas does today is not prose matching alone:
it reads the marker only from a comment whose author is the bot account, and it treats a severity it
does not know as blocking (`console/src/pr_title.rs`, `passed_review` and `nothing_blocks`). A future
package here must keep both — author identity, and a severity vocabulary it validates rather than a
pattern it matches — because a fabricated `CRITICAL:` line or a decoy `LOW` under a real residual
would flip the cycle between WIP and STUCK, or suppress a genuine residual. This repository's shipped
package already treats comment-derived fields as injection-capable
(`packages/issue-comments/render.ts`).

**The absent-marker branch of `stand-in:lens-verdict`.** When no comment carries the marker, the
author check fails, or the comment page is full, tehas has no proof either way and takes the
not-proven branch: the pull request stays WIP, and nothing is logged about which of the three
reasons held. An upstream rename of the marker therefore silently disables the verdict check every
cycle with no error, log line or counter. A package here must say which branch it takes, and log it.

## The five capability guards, and how each surfaces

| Guard | Surfaces as | Where that is seen in tehas |
| ----- | ----------- | --------------------------- |
| `stand-in:refresh-continue-pr` | holds — the refresh is dropped, with a log line naming the reason | `console/dispatch/src/decide/retry.rs`, `refresh_held` and `refresh_drop` |
| `stand-in:plan-turns` | refuses — an error naming the missing capability, and no turn starts | `console/src/plan/start.rs` |
| `stand-in:lens-review-verb` | refuses — an error naming the missing verb, and no review starts | `console/src/review.rs` |
| `stand-in:lean-driver` | refuses — runner exit 78, and a park comment saying no cycle started and nothing ran | `console/cycle/src/start.rs`, `console/cycle/src/report.rs` |
| `stand-in:images-held` | holds — the manifest says the images were fetched and the image's pi-rukas does not read them | `console/attach/src/given.rs` |

## Numbers that no longer resolve

Named in rows above: 261, 279, 390 and 426. 404 as well, not cited here: 220, 476 and 538. All
return 404 from tehas-app/tehas today; they predate the repository transfer. A 404 is not evidence
the work did not happen — every row's fact came from the code at the snapshot commit, not from a
ticket page.

## What this record is not

- **Not a package.** `scripts/lib/state.ts`'s `readPackages()` enumerates every directory under
  `packages/` that holds a `polyfill.json`, and `.github/workflows/track.yml` feeds those records to
  `decide.ts`. This file lives under `docs/`, gains no `polyfill.json`, and is not a tracking input.
  Nothing here adds a row to the Polyfills table in README.md, which lists packages that ship.
- **Not a change to tehas.** This record changes no tehas code. It does not touch
  `scripts/polyfills.sh`, `lib/polyfill-<feature>.sh`, `TEHAS_RUKAS_WORKAROUNDS`,
  `host/sandbox/build.sh`, `host/versions.env`, `TEHAS_POLYFILL_VERSION`, or the sandbox image.
  One naming correction belongs to the chore rather than to this file: PROCESS.md's **Use it** and
  this ticket's own scope list call tehas's pin file `host/sandbox/versions.env`, and at the snapshot
  commit tehas has no such path — the file is `host/versions.env`.
- **Not a PROCESS.md change.** PROCESS.md has no category for a host-workaround register, a
  not-polyfill-style register, or a third-party upstream reference, and this record does not invent
  one. Adding those categories, carrying the classification and status vocabularies above, and
  correcting the pin-file path in **Use it** are its own chore (tehas-app/tehas-polyfill#6).
- **Not upstream tickets.** Filing the missing pi-rukas issues is PROCESS.md's **File the upstream
  issue**, a ticket with its own deliverable.
