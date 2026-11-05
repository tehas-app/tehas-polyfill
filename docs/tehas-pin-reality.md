---
record: tehas-pin-reality
snapshot_repo: tehas-app/tehas
snapshot_commit: 62e0321961c2dcce4a05a2e24682c7401490d8df
snapshot_date: 2026-11-04
gate: none
---

# What tehas keys on instead of a pin

The detail behind [docs/tehas-stand-ins.md](tehas-stand-ins.md): what tehas pins, how each pin is
checked, and what it follows with no content check at all. Read from tehas-app/tehas at commit
`62e0321961c2dcce4a05a2e24682c7401490d8df` (short `62e03219`) on 2026-11-04, and held by hand — no
gate in this repository checks any of it.

## This repository is not pinned at all

At the snapshot commit, tehas's own head names this repository nowhere: no install of it, no
`TEHAS_POLYFILL_VERSION` (the name PROCESS.md's **Retire** step assumes), no line in
`host/versions.env`. [CHANGELOG.md](../CHANGELOG.md) says tehas keeps no version pin for this store
and points at tehas-app/tehas-polyfill#3 for what it does instead; #3 is a pointer to
[docs/tehas-stand-ins.md](tehas-stand-ins.md), which is the canonical register. Giving tehas a pin
for this store is a change to tehas and to PROCESS.md, not a row of that register.

## What tehas does pin

`host/versions.env` is tehas's only pin file: it names each tool a cycle runs by version, and
`bootstrap.sh` and `host/sandbox/build.sh` read it. Not every entry is checked the same way.

| Tool | Pinned by | Content check | Variable in `host/versions.env` |
| ---- | --------- | ------------- | -------- |
| Rust | `RUST_VERSION`, `RUSTUP_VERSION` | SHA-256 of the `rustup-init` download | `RUSTUP_SHA256` |
| jq | `JQ_VERSION` | SHA-256 of the static binary download | `JQ_SHA256` |
| codebase-memory-mcp | `CBM_VERSION` | SHA-256 of the installer script at that tag | `CBM_INSTALLER_SHA256` |
| shellcheck | `SHELLCHECK_VERSION` | SHA-256 of the release archive | `SHELLCHECK_SHA256` |
| Playwright | `PLAYWRIGHT_VERSION` | SHA-256 of its npm lockfile, not of a download | `PLAYWRIGHT_LOCK_SHA256` |
| vipune | `VIPUNE_VERSION` | its cargo version alone — `bootstrap.sh` runs `cargo install vipune --version "$VIPUNE_VERSION" --locked --quiet`; only the two files of its embedding model carry checksums | `VIPUNE_MODEL_SHA256_ONNX`, `VIPUNE_MODEL_SHA256_TOKENIZER` |

`host/versions.env` says outright that an npm tool is pinned by a lockfile, not by a download, and
`bootstrap.sh` checks both halves before it installs anything: the file's hash, then the version the
lockfile names.

## What tehas follows instead of pinning

pi-rukas is the one dependency a cycle actually executes that this file names with no content check.
`host/versions.env` states it is not pinned and sets `PI_RUKAS_FOLLOW=release:0`, which follows the
newest tag of the major line tehas works with; `lib/rukas.sh` resolves that to a commit. The form
that names one commit exactly, `commit:<40 hex>`, is accepted by `lib/rukas.sh` and by the settings
loader, an instance may set it in its `instance.env`, and nothing tehas itself ships sets it: the
release workflow passes no pin ("a release follows the line its versions.env names"), and only
`scripts/pack-release.sh` given `--rukas-commit` writes one into a packed release. `commit:<40 hex>`
is therefore the mitigation available today, and it is the one tehas never takes.

**A re-pointed tag is adopted silently.** upstream re-points a release tag now and then, and
`bootstrap.sh` fetches the pi-rukas clone with `git fetch --tags --force` precisely so that a moved
tag moves what the host installs. Nothing compares a checksum, signature or tag object for
pi-rukas, and no rollback path is recorded, so the next sandbox build or cycle runs whatever the tag
now names. What would notice: the sandbox build labels each image `tehas.rukas=<the pi-rukas commit
it was built on>`, which the dispatcher and the tehasbot cycle read back, so the commit is recorded
after the fact — nothing rejects a change before it runs. That is the asymmetry worth naming: every
other tool in this section is content-verified, and the one that decides what a cycle does is not.
The container that runs it holds the GitHub App token through `host/sandbox/gh-shim`.

## What decides whether a polyfill is used at all

Not a version number: the runner's `--capabilities` answer. `tehas-cycle caps mode` answers
`native | polyfill | off | error`, `scripts/polyfills.sh expired` and `scripts/polyfills.sh prune`
take a caps file, and `scripts/tag-release.sh` prunes before it tags. So PROCESS.md's **Retire**
step 2, "move tehas's pi-rukas pin", has nothing to move yet.
