# Changelog

Versions are tagged (`v0.1.0`) and carry every package in this repository. tehas keeps no version
pin for this store today; tehas-app/tehas-polyfill#3 records what it does instead.

## Unreleased

- `scripts/` - the tracker reads every page of pi-rukas releases (`gh api --paginate --slurp`).
  pi-rukas passed 100 releases in 2026-11 and the single-page call made the daily run exit 2.
- `scripts/` - an upstream issue closed by a pull request's merge commit (`Closes #n`) counts as
  merged: its last `closed` event names the commit, and the commit's pulls name the merged pull
  request. Before, only an upstream issue that was itself a pull request could count as merged, so
  pi-rukas#2020, shipped in v0.14.100, read as closed without a merge.
- `track.yml` - the tracker runs before the live probe. The probe fails by design when a release
  lists a feature whose record still says active, and that failure stopped the tracker from
  proposing the record's update.
- `packages/project-knowledge`: new. A pi extension that asks a project knowledge source the host
  names for a short block of hypotheses, once per child session, and injects it as one message.
  One try within a time limit; any failure gives no block and one line. Upstream pending (the
  pi-rukas issue is not filed yet), feature `projectKnowledge`, state `active`, from `v0.14.78`.
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
