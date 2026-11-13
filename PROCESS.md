# Polyfill process

Use this when tehas needs a pi-rukas feature before a pi-rukas release ships it. A polyfill is a pi extension that gives a cycle the feature in a sandbox image that carries it, until pi-rukas has it natively. It is then removed.

pi-rukas is ours, so the first answer to a missing feature is the upstream change in pi-rukas. A polyfill is for the gap until that release, not a second home for the feature.

## 1. File the upstream issue

Open the pi-rukas issue first. It is the specification, and the polyfill is built to match it. It names:

- the behaviour;
- the **feature flag** that `pi-rukas-headless --capabilities` will list under `features` (for example `issueComments`);
- the tests.

Label it `tehas-polyfill`.

## 2. File the host side

Open the tehas issue. It depends on the upstream issue.

Its capability check accepts **either** the upstream feature in `--capabilities` **or** the polyfill's entry in the image label `tehas.rukas.polyfills` (`<name>@<version>`). tehas code never checks for the polyfill alone, so retiring it needs no change in tehas.

tehas has built this check for `issue-comments` since v0.25.0 (`console/cycle/src/gives.rs`, `polyfill_label`; `host/docs/operating.md`). tehas only reads the label. It does not write it (step 5).

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

- `state` is `active`, `merged` (the upstream PR is merged but not yet released), `released` (a pi-rukas release ships it; `until` is set), or `declined`.
- The tests are the upstream issue's tests, where an extension can meet them. CI runs them against every pi-rukas release from `from` to the newest.
- Releases of this repository are tagged by version (`v0.1.0`) and carry all packages.

## 5. Use it

tehas does not install polyfills. It keeps no version pin for this repository: there is no `TEHAS_POLYFILL_VERSION`, and its only pin file, `host/versions.env`, follows pi-rukas by its newest tag (`PI_RUKAS_FOLLOW=release:0`) and names this repository nowhere. `host/sandbox/build.sh` installs no package from here and writes no `tehas.rukas.polyfills` label. See [docs/tehas-pin-reality.md](docs/tehas-pin-reality.md).

A polyfill reaches a cycle only through a sandbox image built to carry it, by the operator of that host:

- Install the package from a release tag of this repository into `~/.pi/agent/extensions/<name>` in the image.
- Add `<name>@<version>` to the image label `tehas.rukas.polyfills`. Without the label, tehas does not know the image carries the polyfill and does not offer the feature.
- Install it only while the image's `pi-rukas-headless --capabilities` does **not** list the upstream feature. The native feature and the polyfill are never both active.

The image's label names what ran, so a log or bug report from a polyfilled image is filed against the polyfill, not against pi-rukas.

Making tehas's own sandbox build install polyfills is not planned. If that changes, it is tehas-side work in tehas-app/tehas, and this step changes with it.

## 6. Track upstream

A scheduled workflow (`.github/workflows/track.yml`, daily) reads each polyfill's upstream issue:

1. **Closed by a merged PR.** It opens a PR on this repository that sets `state: "merged"` and `pr`.
2. **A pi-rukas release contains that PR's merge commit.** It opens a PR setting `state: "released"` and `until` to the first such release. It also files a tehas issue, "Retire polyfill `<name>`: pi-rukas `<until>` ships `<upstream issue>`", linked to the tehas issue from step 2.
3. **Closed without a merge.** It opens a PR setting `state: "declined"` and files a tehas issue to decide what happens next: move the behaviour into tehas properly, or drop it. A polyfill never quietly becomes permanent.

The workflow only opens PRs and issues. It never merges, and it never applies `tehas:*` labels.

## 7. Retire

A polyfill is retired when a pi-rukas release ships its feature. No pin needs to move. Images built after that release list the feature in `--capabilities`, because tehas follows the newest pi-rukas tag.

The retirement issue is worked like any other:

1. **Check that upstream behaves the same.** Run the polyfill's tests against the native feature on the `until` release. If they differ, fix pi-rukas or change tehas, and retirement waits.
2. **Drop it from the images that carry it.** Any image that installs the package and lists the feature rebuilds without the package and without its label entry. tehas then answers from the native feature alone, so tehas code needs no change (step 2).
3. **Remove it here.** Delete `packages/<name>/`, record it in the CHANGELOG and release.

## Rules

- One polyfill per upstream issue, named after its feature.
- A polyfill does what the upstream issue specifies and no more. A new need goes upstream first.
- A polyfill still `active` 60 days after it was added gets a reminder issue on tehas from the tracking workflow.
- A release of this repository is named by its tag, never by a commit hash.
- tehas's own stand-ins (`lib/polyfill-<feature>.sh`, `scripts/polyfills.sh`) are a different mechanism and live in tehas. A tehas change that adds a stand-in for something pi, pi-rukas or gh does not provide is recorded in [docs/tehas-stand-ins.md](docs/tehas-stand-ins.md), with its tehas ticket and upstream reference, as a package candidate here or as out of scope here with the reason. A package is made only by steps 1 to 4. The four states above stay the only states.
