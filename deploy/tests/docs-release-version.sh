#!/usr/bin/env bash
# The install docs name the platform release in their copy-paste commands, so a reader can paste them as they are.
# Every version these files show in a version-bearing place (an npx package spec, VERSION=, a bundle name, a release
# download URL, a signing tag, an image tag, the /health sample) must be the release in package.json, and each file
# must name that release at least once. A release that bumps package.json and leaves the docs behind fails here.
# Placeholders such as X.Y.Z, kept where a text describes syntax or any release's behaviour, never match.
#
# Usage: bash deploy/tests/docs-release-version.sh [root]   (default: the tree this script is in)
set -euo pipefail

root=${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"}
files=(
  README.md
  docs/user/byodt/INSTALLATION.md
  docs/user/byodt/README.md
  deploy/installer/npm/README.md
)

# A prerelease's dot-separated parts after the first are numeric (rc.1), so the .tar.gz after a version in a bundle
# name is never read as part of it.
semver='[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9]+)*)?'
context='(@dether\.net/byodt@|PKG@|(^|[[:space:]])VERSION=|byodt-|releases/download/v|releases/tag/v|refs/tags/v|ghcr\.io/dether-net/[a-z0-9-]+:|"version": ")'
exact="^${semver}\$"
trailing="(${semver})\$"

release=$(jq -r '.version // empty' "$root/package.json")
if ! [[ $release =~ $exact ]]; then
  echo "::error::$root/package.json has no release version (found '${release}')" >&2
  exit 1
fi

failed=0
for f in "${files[@]}"; do
  path="$root/$f"
  if [ ! -f "$path" ]; then
    echo "::error::$f is missing" >&2
    failed=1
    continue
  fi
  named=0
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    line=${hit%%:*}
    [[ ${hit#*:} =~ $trailing ]]
    found=${BASH_REMATCH[1]}
    if [ "$found" = "$release" ]; then
      named=1
    else
      echo "::error::$f:$line shows version $found; the release in package.json is $release" >&2
      failed=1
    fi
  done < <(grep -noE "${context}${semver}" "$path" || true)
  if [ "$named" -eq 0 ]; then
    echo "::error::$f names no release in its install commands; they should show $release" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "A release PR updates these files together with the version bump in package.json." >&2
  exit 1
fi
echo "The install docs name release $release."
