# Polyfill process

Use this when tehas needs a pi-rukas feature before a pi-rukas release ships it. A polyfill is a pi extension that gives tehas the feature in the sandbox image until pi-rukas has it natively. It is then removed.

## 1. File the upstream issue

Open the pi-rukas issue first. It is the specification, and the polyfill is built to match it. It names:

- the behaviour;
- the **feature flag** that `pi-rukas-headless --capabilities` will list under `features` (for example `issueComments`);
- the tests.

Label it `tehas-polyfill`.

## 2. File the host side

Open the tehas issue. It depends on the upstream issue.

Its capability check accepts **either** the upstream feature in `--capabilities` **or** the polyfill's entry in the image label `tehas.rukas.polyfills`, which step 5 writes. tehas code never checks for the polyfill alone, so retiring it needs no change in tehas. **Neither half exists in tehas today**: `host/sandbox/build.sh` writes no such label and the tehas capability check knows no polyfill entry (see step 5). Building them is tehas-side work, filed separately, and no wording of this document delivers it.

## 3. Decide whether to polyfill

Write a polyfill only when all of these hold:

- It can be built as a pi extension using pi's public hooks (`before_agent_start`, `tool_call`, `session_start` and so on). Patching pi-rukas source is not allowed.
- What it cannot match is written down in its README. For example, an extension loads into the child sessions pi-rukas spawns and cannot reach the driver, which runs in the runner process.
- The upstream change will not land in the next pi-rukas release anyway.

If any of these fails, do not polyfill. tehas waits for the paired release.

## 4. Build it

Each polyfill is a package in `packages/<name>/`:

```
packages/<name>/
  package.json     # "pi": {"extensions": ["./index.ts"]}, so pi-rukas forwards it to its children
  index.ts
  polyfill.json
  README.md        # what it does, what it cannot match, how tehas uses it
  test/
```

`polyfill.json`:

```json
{"name": "issue-comments",
 "upstream": {"issue": "trail-openers/pi-rukas#2020", "feature": "issueComments"},
 "from": "v0.14.0",
 "state": "active",
 "pr": null,
 "until": null}
```

- `state` is `active`, `merged` (the upstream PR is merged but not yet released), `released` (a pi-rukas release ships it; `until` is set), or `declined`. Those four are the only states; a stand-in that is not yet a package is recorded in [docs/tehas-stand-ins.md](docs/tehas-stand-ins.md) and gets no state here.
- The tests are the upstream issue's tests, where an extension can meet them. CI runs them against every pi-rukas release from `from` to the newest.
- Releases of this repository are tagged by version (`v0.1.0`) and carry all packages. A release is named by its tag, never by a commit hash.

## 5. Use it

Two facts decide whether an image carries a polyfill: what the base image's `--capabilities` answer says about the feature, and what the image label `tehas.rukas.polyfills` says about the package. No version pin is one of them, and tehas keeps none for this repository.

- `host/sandbox/build.sh` reads the base image's `pi-rukas-headless --capabilities` and, for each package here whose state is `active` or `merged`:
  - if the upstream feature is **not** listed, installs the package into `~/.pi/agent/extensions/<name>` and adds `<name>@<version>` to the image label `tehas.rukas.polyfills`;
  - if the feature **is** listed, skips it and says so in the build output. The native feature takes over, and the two are never both active.
- `tehas status` shows the polyfills the label names, so a log or bug report from a polyfilled image
  names them and upstream bugs are filed against what actually ran. This bullet is part of the
  specification below, not a report: no such command is recorded in tehas today.

**This is a specification, not a description of the host.** At the tehas commit the register in
[docs/tehas-stand-ins.md](docs/tehas-stand-ins.md) was read from, `host/sandbox/build.sh` neither
reads `--capabilities` for a polyfill nor writes `tehas.rukas.polyfills`, and nothing that snapshot
records names a polyfill label at all. Making the build do the two things above is tehas-side work in
tehas-app/tehas, not work this document performs by describing it.

**What tehas answers today is its own polyfill question, not this one.** `tehas-cycle caps mode`
answers `native | polyfill | off | error`, and `polyfill` is true only when tehas's `lib/` holds
`polyfill-<feature>.sh` ([docs/tehas-pin-reality.md](docs/tehas-pin-reality.md)). That is tehas's own
register — a different mechanism from a package here — so the one command that does exist says
nothing about a package from this repository. The label, and the `tehas status` that reads it, are
tehas-side work in tehas-app/tehas.

**The pin file people expect does not exist.** There is no `TEHAS_POLYFILL_VERSION` anywhere in the
tehas tree, and no `host/sandbox/versions.env`. tehas's only pin file is `host/versions.env`, whose
tools and content checks are the table in
[docs/tehas-pin-reality.md](docs/tehas-pin-reality.md) rather than a list repeated here, and which
states outright that pi-rukas is *not* pinned: it follows the newest tag of its major line. So no step
here moves a pin, and nothing in this repository is held to a version tehas declares.

## 6. Track upstream

A scheduled workflow (`.github/workflows/track.yml`, daily) reads each polyfill's upstream issue:

1. **Closed by a merged PR.** It opens a PR on this repository that sets `state: "merged"` and `pr`.
2. **A pi-rukas release contains that PR's merge commit.** It opens a PR setting `state: "released"` and `until` to the first such release. It also files a tehas issue, "Retire polyfill `<name>`: pi-rukas `<until>` ships `<upstream issue>`", linked to the tehas issue from step 2.
3. **Closed without a merge.** It opens a PR setting `state: "declined"` and files a tehas issue to decide what happens next: move the behaviour into tehas properly, or drop it. A polyfill never quietly becomes permanent.

The workflow only opens PRs and issues. It never merges, and it never applies `tehas:*` labels.

## 7. Retire

Retirement reads the same two facts step 5 installs on: the feature appears in the `--capabilities` answer of the image the host builds, and the label no longer names the package. Neither is a version number, and there is no pin to move.

1. **Check that upstream behaves the same.** Run the polyfill's tests against the native feature on the `until` release. If they differ, fix pi-rukas or change tehas, and retirement waits.
2. **Check the image the host builds.** Its `--capabilities` answer lists the upstream feature, so the sandbox build skips the polyfill by itself (step 5) and the `tehas.rukas.polyfills` label it writes no longer names the package. Until both hold, retirement waits: an image that still installs the package is not a retired image, whatever its pi-rukas is.
3. **Remove it from tehas.** The tehas capability check then answers from the native feature alone, and its own polyfill register (`scripts/polyfills.sh`, `lib/polyfill-<feature>.sh`) has no entry for the name. tehas code needs no change, because step 2's check is the one tehas asks.
4. **Remove it here.** Delete `packages/<name>/` and record it in the CHANGELOG. Release; tehas follows that release by tag, because tehas keeps no pin for this repository for anyone to move.

**Today none of this can be observed in tehas.** Nothing writes the label and nothing registers the
package, so step 2 has no image to check. The tehas-side work named in step 5 is a precondition of
retirement, not a consequence of this wording.

## Rules

- One polyfill per upstream issue, named after its feature.
- A polyfill does what the upstream issue specifies and no more. A new need goes upstream first.
- A polyfill still `active` 60 days after it was added gets a reminder issue on tehas from the tracking workflow.
- This repository's releases are named by release tag, never by commit hash. tehas keeps no pin for them: its `host/versions.env` follows pi-rukas by line (`PI_RUKAS_FOLLOW=release:0`) and names this repository nowhere.
- A tehas change that adds a stand-in for something pi, pi-rukas or gh does not provide files it in this repository as a candidate, naming its tehas ticket and its upstream reference, or says why it is out of scope here. [docs/tehas-stand-ins.md](docs/tehas-stand-ins.md) is that record, and its four classifications say which kind of stand-in belongs to a package here: **package candidate** for one PROCESS.md can build, **tehas-side host workaround** for one that cannot be a pi extension, and **capability guard that waits** and **not polyfill-style** for two that are out of scope here by definition — each of those three says why, and none of the four is a state. `state` in `polyfill.json` stays `active`, `merged`, `released` or `declined`, and only a built package gains a row in README.md's Polyfills table.
