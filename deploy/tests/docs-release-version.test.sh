#!/usr/bin/env bash
# Tests docs-release-version.sh against the committed install docs, and against scratch copies of them changed one
# way at a time. Offline: it reads and copies files, and starts nothing.
#
# Usage: bash deploy/tests/docs-release-version.test.sh
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../.." && pwd)
check="$here/docs-release-version.sh"
files=(
  package.json
  README.md
  docs/user/QUICK_START.md
  docs/user/byodt/INSTALLATION.md
  docs/user/byodt/README.md
  deploy/installer/npm/README.md
)
release=$(jq -r .version "$root/package.json")
work=$(mktemp -d "${TMPDIR:-/tmp}/docs-release-version.XXXXXX")
trap 'rm -rf "${work:?}"' EXIT
passed=0

# A scratch copy of the six files, at $work/<name>.
fresh() {
  local t="$work/$1" f
  for f in "${files[@]}"; do
    mkdir -p "$t/$(dirname "$f")"
    cp "$root/$f" "$t/$f"
  done
  printf '%s\n' "$t"
}

# Replaces every occurrence of one literal string with another in a file.
swap() {
  FROM=$2 TO=$3 perl -pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/g' "$1"
}

expect_ok() {
  local name=$1 out
  if out=$(bash "$check" "$2" 2>&1); then
    passed=$((passed + 1))
  else
    printf 'FAIL %s: expected the check to pass, it said:\n%s\n' "$name" "$out"
    exit 1
  fi
}

# Every argument after the tree is a string the check's output must contain.
expect_fail() {
  local name=$1 t=$2 out want
  shift 2
  if out=$(bash "$check" "$t" 2>&1); then
    printf 'FAIL %s: expected the check to fail, it said:\n%s\n' "$name" "$out"
    exit 1
  fi
  for want in "$@"; do
    case $out in
      *"$want"*) ;;
      *)
        printf 'FAIL %s: expected "%s" in:\n%s\n' "$name" "$want" "$out"
        exit 1
        ;;
    esac
  done
  passed=$((passed + 1))
}

expect_ok "the committed docs name the release" "$root"

t=$(fresh behind)
swap "$t/docs/user/byodt/README.md" "$release" 0.0.1
expect_fail "a file left on another version is named, with the line" "$t" \
  "::error::docs/user/byodt/README.md:" "shows version 0.0.1; the release in package.json is $release"

t=$(fresh bump-only)
jq '.version = "99.0.0"' "$root/package.json" >"$t/package.json"
expect_fail "a bump of package.json alone" "$t" "the release in package.json is 99.0.0"

t=$(fresh placeholders)
swap "$t/deploy/installer/npm/README.md" "$release" X.Y.Z
expect_fail "a file with placeholders only" "$t" "deploy/installer/npm/README.md names no release"

t=$(fresh image-tag)
printf 'docker pull ghcr.io/dether-net/byodt-platform:0.0.9\n' >>"$t/docs/user/byodt/INSTALLATION.md"
expect_fail "an image tag of another release" "$t" "shows version 0.0.9"

t=$(fresh release-page)
printf 'See https://github.com/dether-net/dethernety-oss/releases/tag/v0.0.8.\n' >>"$t/README.md"
expect_fail "a release page link of another release" "$t" "::error::README.md:" "shows version 0.0.8"

# One line per version-bearing context, each naming another release: every one is reported, at its own line.
t=$(fresh contexts)
doc="$t/docs/user/byodt/INSTALLATION.md"
base=$(wc -l <"$doc")
contexts=(
  'npx @dether.net/byodt@0.0.7'
  'npx "$PKG@0.0.7" --yes'
  '   VERSION=0.0.7'
  'Download `byodt-0.0.7.tar.gz` from the release.'
  'curl -fsSLO "https://github.com/dether-net/dethernety-oss/releases/download/v0.0.7/get-byodt.sh"'
  'See https://github.com/dether-net/dethernety-oss/releases/tag/v0.0.7.'
  '  --certificate-identity "https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v0.0.7" \'
  'docker pull ghcr.io/dether-net/byodt-console:0.0.7'
  '  "version": "0.0.7",'
  '   ==> Unpacked release 0.0.7 into ./byodt.'
  '==> Signature verified: the release workflow of dether-net/dethernety-oss at v0.0.7 signed it.'
)
printf '%s\n' "${contexts[@]}" >>"$doc"
wants=()
for i in "${!contexts[@]}"; do
  wants+=("::error::docs/user/byodt/INSTALLATION.md:$((base + i + 1)) shows version 0.0.7")
done
expect_fail "every version-bearing context is checked" "$t" "${wants[@]}"

t=$(fresh ignored)
printf '%s\n' 'docker pull docker.io/nginx:1.27-alpine' 'VERSION=X.Y.Z' 'npx "$PKG@X.Y.Z"' \
  'An upgrade from 0.13.0 or 0.12.x needs one step by hand.' 'Image: docker.io/memgraph/memgraph:3.13.2' 'NODE_VERSION=22.1.0' \
  >>"$t/docs/user/byodt/INSTALLATION.md"
expect_ok "placeholders, other images and versions in prose are not checked" "$t"

t=$(fresh prerelease)
for f in "${files[@]}"; do swap "$t/$f" "$release" 1.2.3-rc.1; done
printf '%s\n' 'curl -fsSLO "https://github.com/dether-net/dethernety-oss/releases/download/v1.2.3-rc.1/byodt-1.2.3-rc.1.tar.gz"' \
  'curl -fsSLO "https://github.com/dether-net/dethernety-oss/releases/download/v1.2.3-rc.1/byodt-1.2.3-rc.1.tar.gz.bundle"' \
  >>"$t/docs/user/byodt/INSTALLATION.md"
expect_ok "a prerelease version, beside .tar.gz" "$t"

t=$(fresh no-version)
jq 'del(.version)' "$root/package.json" >"$t/package.json"
expect_fail "package.json without a version" "$t" "has no release version"

t=$(fresh missing)
rm -f "${t:?}/docs/user/byodt/README.md"
expect_fail "a missing file" "$t" "docs/user/byodt/README.md is missing"

echo "docs-release-version: $passed passed"
