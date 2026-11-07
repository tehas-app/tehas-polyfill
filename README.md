# tehas-polyfill

pi extensions that give tehas a pi-rukas feature before a pi-rukas release ships it. Each one is removed once pi-rukas has the feature natively.

[PROCESS.md](PROCESS.md) covers how a polyfill is filed, built, used, tracked and retired.

## Polyfills

| Name | Upstream | Feature | State |
| ---- | -------- | ------- | ----- |
| issue-comments | trail-openers/pi-rukas#2020 | `issueComments` | active |

This table lists packages that ship in this repository. The stand-ins tehas carries for features no
pi-rukas release has yet are inventoried in the canonical register,
[docs/tehas-stand-ins.md](docs/tehas-stand-ins.md), which defines its own classifications. A
package candidate there has no row above until PROCESS.md's **Build it** builds it.

## License

Apache-2.0. See [LICENSE](LICENSE).
