#!/usr/bin/env bash
# Pins byodt's check_db_image: when it warns that the database image differs from the image the bundle
# was tested with (DB_IMAGE for Memgraph, NEO4J_IMAGE for Neo4j), and that it only ever warns. The
# function and the tested images are lifted out of the wrapper itself, so this tests the shipped code;
# env_value and warn are stubbed, DBE set, so nothing reads a .env and no container engine is needed.
#
#   bash deploy/tests/byodt-check-db-image.sh
set -euo pipefail

BYODT="$(cd "$(dirname "$0")/../compose" && pwd)/byodt"

tested_line="$(grep -E '^readonly TESTED_DB_IMAGE=' "$BYODT")"
tested_neo4j_line="$(grep -E '^readonly TESTED_NEO4J_IMAGE=' "$BYODT")"
fn="$(sed -n '/^check_db_image() {$/,/^}$/p' "$BYODT")"
[ -n "$tested_line" ] || { echo "FAIL: no TESTED_DB_IMAGE in $BYODT"; exit 1; }
[ -n "$tested_neo4j_line" ] || { echo "FAIL: no TESTED_NEO4J_IMAGE in $BYODT"; exit 1; }
[ -n "$fn" ] || { echo "FAIL: no check_db_image in $BYODT"; exit 1; }
eval "$tested_line"
eval "$tested_neo4j_line"
eval "$fn"

BOLD="" RST="" SELF="byodt"
STUB_DB_IMAGE=""
DBE=memgraph
# The image key of the engine under test answers STUB_DB_IMAGE; any other key its default.
env_value() {
  case "$DBE:$1" in
    memgraph:DB_IMAGE|neo4j:NEO4J_IMAGE) printf '%s' "${STUB_DB_IMAGE:-$2}" ;;
    *) printf '%s' "$2" ;;
  esac
}
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

# Neo4j: NEO4J_IMAGE against the tested Neo4j image, and the Memgraph image is not consulted.
DBE=neo4j
neo4j_name_tag="${TESTED_NEO4J_IMAGE##*/}"
neo4j_repo="${TESTED_NEO4J_IMAGE%:*}"
expect "neo4j: tested image" "$TESTED_NEO4J_IMAGE" quiet
expect "neo4j: tested image through a mirror" "mirror.example.internal:5000/dockerhub/library/${neo4j_name_tag}" quiet
expect "neo4j: unset" "" quiet
expect "neo4j: another tag" "${neo4j_repo}:5.20-community" warns
expect "neo4j: the enterprise image" "${neo4j_repo}:5.26-enterprise" warns
expect "neo4j: the tested Memgraph image is not a tested Neo4j image" "$TESTED_DB_IMAGE" warns
out="$(STUB_DB_IMAGE="${neo4j_repo}:5.20-community" check_db_image)"
if printf '%s' "$out" | grep -q 'NEO4J_IMAGE in .env'; then echo "ok   neo4j: the warning names NEO4J_IMAGE"
else echo "FAIL neo4j: the warning does not name NEO4J_IMAGE: $out"; fail=1; fi
# An exported NEO4J_IMAGE is the image that runs, so it is the one compared.
out="$(NEO4J_IMAGE="${neo4j_repo}:5.20-community" check_db_image)"
if printf '%s' "$out" | grep -qF "${neo4j_repo}:5.20-community"; then echo "ok   neo4j: an exported NEO4J_IMAGE is checked"
else echo "FAIL neo4j: an exported NEO4J_IMAGE is not checked: $out"; fail=1; fi
exit "$fail"
