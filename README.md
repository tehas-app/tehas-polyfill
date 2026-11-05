# tehas-polyfill

pi extensions that give tehas a pi-rukas feature before a pi-rukas release ships it. Each one is removed once pi-rukas has the feature natively.

[PROCESS.md](PROCESS.md) covers how a polyfill is filed, built, used, tracked and retired.

## Polyfills

| Name | Upstream | Feature | State |
| ---- | -------- | ------- | ----- |
| issue-comments | trail-openers/pi-rukas#2020 | `issueComments` | active |

This table lists packages that ship in this repository. The polyfill-style functions tehas carries
today for pi-rukas features no release has yet — the stand-ins that are not packages here — are
inventoried in [docs/tehas-stand-ins.md](docs/tehas-stand-ins.md), each classified as a package
candidate, a tehas-side host workaround, a capability guard that waits, or not polyfill-style. A
package candidate is a candidate only: it has no row above until PROCESS.md step 4 builds it, and
step 2 (filing the host side) and step 3 (deciding whether to polyfill at all) come before that
build.

## License

Apache-2.0. See [LICENSE](LICENSE).
