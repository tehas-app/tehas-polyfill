# Changelog

Versions are tagged (`v0.1.0`) and carry every package in this repository. tehas keeps no version
pin for this store today; tehas-app/tehas-polyfill#3 records what it does instead.

## v0.1.0

- `packages/issue-comments` — new. A pi extension that injects the issue's and its pull
  requests' comments into each child session, from the host's `comments.json`. Upstream
  `trail-openers/pi-rukas#2020`, feature `issueComments`, state `active`, from `v0.14.0`.
- `scripts/` — new. The tracking tooling behind `.github/workflows/track.yml`: it reads each
  `packages/*/polyfill.json`, opens the state PRs on this repository and the retire / decide /
  reminder issues on tehas, and probes `pi-rukas-headless --capabilities` per release.
