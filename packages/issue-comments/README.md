# issue-comments

A pi extension that gives tehas pi-rukas' `issueComments` feature before the pi-rukas release
that ships it. Upstream: [trail-openers/pi-rukas#2020](https://github.com/trail-openers/pi-rukas/issues/2020).

## What it does

The host puts the issue's comments and its pull requests' comments into the sandbox image: a
`manifest.json` and the blob it names (`comments.json`) in a directory listed in
`PI_ENSEMBLE_EXTRA_IMAGE_DIRS`. On `before_agent_start`, when the run starts from a user prompt,
this extension reads that pair, checks it against the integrity fields the manifest claims, and
injects one message (`customType: "issue-comments"`, `display: true`) holding every comment,
oldest first. Once per session.

A directory with no `manifest.json`, or a manifest with no `comments` entry, is nothing to read
rather than a failed read: the session is left as it was found and nothing is written. A manifest
that is there but cannot be parsed is a failure — the host wrote a broken file — and so is a
`comments` entry whose blob fails the checks: either one is not used, and the extension writes its
one line for the session (the latch is set once at least one attachment directory is named, so a
session with nothing configured does not burn its attempt while a named directory with no comments
entry still spends it, and a blob that never reads is not retried on every turn). A directory with
nothing to read never hides a corrupt pair: the reason the
extension reports is the one from a directory that named a comments blob. It is the only writer of
these lines, so the two-manifests case names the directories itself:

```
issue-comments polyfill: no comments (<reason>)
issue-comments polyfill: no comments (ambiguous: <dir>, <dir>)
```

Whenever it reads a valid blob it also writes what that blob gave it, even when nothing is
injected:

```
issue-comments polyfill: <count> comments, <bytes> bytes, <dropped> dropped
```

`count` is the comments in the message, `bytes` the bytes they render to, and `dropped` every
comment in the blob that is not in the message — malformed ones and ones cut by the 64 KB cap.
Nothing is written to stderr when `PI_ENSEMBLE_EXTRA_IMAGE_DIRS` is unset or empty.

## How tehas uses it

PROCESS.md step 5. tehas does not install this package and keeps no pin for this repository. An
image carries it only when its operator installs it into `~/.pi/agent/extensions/issue-comments`
and adds `issue-comments@<version>` to the image label `tehas.rukas.polyfills`, and only while the
image's `pi-rukas-headless --capabilities` does not list `issueComments`: the native feature and
the polyfill are never both active. tehas reads that label (since v0.25.0) and then offers the
comments retry, run with `PI_ENSEMBLE_REPEAT_PARK=0` (`host/docs/operating.md`).

## What it cannot match

- Every child session pi-rukas spawns gets the comments, not only the explore and plan children.
- The repeat-park guard does not see them: tehas sets `PI_ENSEMBLE_REPEAT_PARK=0` for polyfilled
  runs.
- There is no `comments` field in the runner's result, because the extension runs in the child,
  not in the runner process.
- A resumed or forked session is a new session to this polyfill: `session_start` resets the latch,
  so the comments are injected once more, and anything the earlier session already saw is injected
  again. pi-rukas' native feature keeps one comment set for the whole lineage; this package cannot
  see the lineage at all.
