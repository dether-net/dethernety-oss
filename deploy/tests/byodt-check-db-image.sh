#!/usr/bin/env bash
# Pins byodt's check_db_image: when it warns that DB_IMAGE differs from the image the bundle was tested
# with, and that it only ever warns. The function and the tested image are lifted out of the wrapper
# itself, so this tests the shipped code; env_value and warn are stubbed, so nothing reads a .env and
# no container engine is needed.
#
#   bash deploy/tests/byodt-check-db-image.sh
set -euo pipefail

BYODT="$(cd "$(dirname "$0")/../compose" && pwd)/byodt"

tested_line="$(grep -E '^readonly TESTED_DB_IMAGE=' "$BYODT")"
fn="$(sed -n '/^check_db_image() {$/,/^}$/p' "$BYODT")"
[ -n "$tested_line" ] || { echo "FAIL: no TESTED_DB_IMAGE in $BYODT"; exit 1; }
[ -n "$fn" ] || { echo "FAIL: no check_db_image in $BYODT"; exit 1; }
eval "$tested_line"
eval "$fn"

BOLD="" RST="" SELF="byodt"
STUB_DB_IMAGE=""
env_value() { [ "$1" = DB_IMAGE ] && printf '%s' "${STUB_DB_IMAGE:-$2}"; }
warn() { printf '%s\n' "$*"; }

name_tag="${TESTED_DB_IMAGE##*/}"
repo="${TESTED_DB_IMAGE%:*}"

fail=0
# expect CASE DB_IMAGE quiet|warns
expect() {
  local case="$1" want="$3" out rc
  STUB_DB_IMAGE="$2"
  set +e
  out="$(check_db_image)"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FAIL $case: exited $rc — the check must never block"
    fail=1
  elif [ "$want" = quiet ] && [ -n "$out" ]; then
    echo "FAIL $case: warned for '$2'"
    fail=1
  elif [ "$want" = warns ] && ! printf '%s' "$out" | grep -qF "$2"; then
    echo "FAIL $case: no warning naming '$2'"
    fail=1
  else
    echo "ok   $case"
  fi
}

expect "tested image" "$TESTED_DB_IMAGE" quiet
expect "tested image, no registry" "memgraph/${name_tag}" quiet
expect "tested image through a mirror" "mirror.example.internal:5000/dockerhub/memgraph/${name_tag}" quiet
expect "unset" "" quiet
expect "another tag" "${repo}:3.8.1" warns
expect "another image" "docker.io/memgraph/memgraph-mage:${TESTED_DB_IMAGE##*:}" warns
expect "digest-pinned" "${repo}@sha256:0000000000000000000000000000000000000000000000000000000000000000" warns
exit "$fail"
