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

Its capability check accepts **either** the upstream feature in `--capabilities` **or** the polyfill's image label (`tehas.rukas.polyfills`). tehas code never checks for the polyfill alone, so retiring it needs no change in tehas.

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

- tehas pins `TEHAS_POLYFILL_VERSION=vX.Y.Z` in `host/sandbox/versions.env`.
- `host/sandbox/build.sh` reads the base image's `--capabilities` and, for each polyfill whose state is `active` or `merged`:
  - if the upstream feature is **not** listed, installs the package into `~/.pi/agent/extensions/<name>` and adds `<name>@<version>` to the image label `tehas.rukas.polyfills`;
  - if the feature **is** listed, skips it and says so in the build output. The native feature takes over, and the two are never both active.
- `tehas status` shows the active polyfills. A log or bug report from a polyfilled image names them, so upstream bugs are filed against what actually ran.

## 6. Track upstream

A scheduled workflow (`.github/workflows/track.yml`, daily) reads each polyfill's upstream issue:

1. **Closed by a merged PR.** It opens a PR on this repository that sets `state: "merged"` and `pr`.
2. **A pi-rukas release contains that PR's merge commit.** It opens a PR setting `state: "released"` and `until` to the first such release. It also files a tehas issue, "Retire polyfill `<name>`: pi-rukas `<until>` ships `<upstream issue>`", linked to the tehas issue from step 2.
3. **Closed without a merge.** It opens a PR setting `state: "declined"` and files a tehas issue to decide what happens next: move the behaviour into tehas properly, or drop it. A polyfill never quietly becomes permanent.

The workflow only opens PRs and issues. It never merges, and it never applies `tehas:*` labels.

## 7. Retire

The retirement issue is worked like any other:

1. **Check that upstream behaves the same.** Run the polyfill's tests against the native feature on the `until` release. If they differ, fix pi-rukas or change tehas, and retirement waits.
2. **Move tehas's pi-rukas pin to `until` or later.** The sandbox build now skips the polyfill by itself (step 5).
3. **Remove it from tehas.** A tehas test fails while the pinned polyfill release still carries a package whose `until` is at or below the pinned pi-rukas, and names it. Because of step 2's either/or check, tehas code needs no change.
4. **Remove it here.** Delete `packages/<name>/` and record it in the CHANGELOG. Release, and move tehas's `TEHAS_POLYFILL_VERSION` to that release.

## Rules

- One polyfill per upstream issue, named after its feature.
- A polyfill does what the upstream issue specifies and no more. A new need goes upstream first.
- A polyfill still `active` 60 days after it was added gets a reminder issue on tehas from the tracking workflow.
- Versions are pinned by release tag, never by commit hash.
