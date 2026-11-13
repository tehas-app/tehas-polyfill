# Changelog

Versions are tagged (`v0.1.0`) and carry every package in this repository. tehas keeps no version
pin for this store today; tehas-app/tehas-polyfill#3 records what it does instead.

## Unreleased

- `PROCESS.md` — steps 2, 5 and 7 and the Rules describe tehas as it is. tehas installs no polyfill and
  keeps no pin for this repository; an image carries a polyfill only when its operator builds it
  in and names it in the `tehas.rukas.polyfills` label, which tehas reads (since v0.25.0).
  Retirement follows the pi-rukas release that ships the feature, with no pin to move (#6).

## v0.1.0

- `packages/issue-comments` — new. A pi extension that injects the issue's and its pull
  requests' comments into each child session, from the host's `comments.json`. Upstream
  `trail-openers/pi-rukas#2020`, feature `issueComments`, state `active`, from `v0.14.0`.
- `scripts/` — new. The tracking tooling behind `.github/workflows/track.yml`: it reads each
  `packages/*/polyfill.json`, opens the state PRs on this repository and the retire / decide /
  reminder issues on tehas, and probes `pi-rukas-headless --capabilities` per release.
- `scripts/` — the tracker reads the upstream issue's **labels** beside its state and its pull
  request, and files nothing for an upstream issue that is open and explicitly not taken on (a
  parked proposal such as `trail-openers/pi-rukas#1239`, labelled `frozen`): no retire issue, no
  decide issue, no 60-day reminder. The label set is one constant, `NOT_TAKEN_ON_LABELS`, matched
  case-insensitively; a missing label list is a wait, not a decline, and the reading is recomputed
  every run, so an un-frozen issue is tracked again with no change to `polyfill.json`.
