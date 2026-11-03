# Dethernety BYODt installer for npm

Installs Dethernety's self-hosted deployment, or upgrades an existing one, by running the release's own installer
(`get-byodt.sh`), which this package carries. Each package version is the platform release of the same version. It
is the recommended way to install when Node.js is already there, or you are happy to install it. Node.js runs this
installer only: the deployment never needs it, since its services run in containers. Without Node.js, run the same
`get-byodt.sh` straight from the release. A release reaches npm in a separate step after it is published on GitHub;
for a version that is not here yet, use `get-byodt.sh` from the release.

```sh
PKG=@dether.net/byodt                            # this package's name
npx "$PKG@0.14.0"                                # install this release into ./byodt
npx "$PKG@0.14.0" --dir ~/dethernety --yes       # into a folder of your choice, asking nothing
npx "$PKG@0.14.0" --upgrade --dir ~/dethernety   # upgrade an existing deployment to this release
npx "$PKG" --help
```

These commands use the current release; newer releases are listed on the
[releases page](https://github.com/dether-net/dethernety-oss/releases).

Name the version: without one, `npx` runs the latest release.

The package runs its `get-byodt.sh` with `/bin/sh` and nothing else, so it takes the same options as the installer
downloaded from the release, and asks its questions at the terminal the same way. Before it starts the installer, it
takes npm's `node_modules/.bin` folders out of `PATH`, so `curl`, `cosign`, `tar` and the container engine are always
the system's.

The installer verifies the release's bundle by the SHA-256 written into it, and, with
[cosign](https://github.com/sigstore/cosign) installed, by the release workflow's signature. Before it downloads
anything, it shows a short notice about the third-party software the deployment runs, for you to confirm. It needs
`sh`, `curl` (or `wget`), `tar`, and `sha256sum` or `shasum`, and runs on Linux and macOS. On Windows it stops: run
it inside WSL. The package has no dependencies and no install scripts, and needs Node.js 18 or later.

The installation guide is at https://github.com/dether-net/dethernety-oss.
