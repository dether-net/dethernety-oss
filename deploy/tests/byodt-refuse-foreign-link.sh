#!/usr/bin/env bash
# Pins byodt's refuse_foreign_entry and the ownership test behind it: a runtime directory under data/, a symbolic link
# or not, is used only when the operator made it (the operator running byodt, the one who ran it through sudo, or
# root). data/ is writable by every local account, so a link planted there before the run that creates the directory
# would otherwise have its target made world-writable, and the owner of a directory planted there could swap it for a
# link after any check, or rename what is in it. The operator's own directory and link (a cache moved to another disk)
# pass. The functions are lifted out of the wrapper itself; ownership is stubbed, since a test cannot make an entry
# another user owns.
#
#   bash deploy/tests/byodt-refuse-foreign-link.sh
set -euo pipefail

BYODT="$(cd "$(dirname "$0")/../compose" && pwd)/byodt"
for f in path_owner owned_by_operator refuse_foreign_entry; do
  fn="$(sed -n "/^$f() {\$/,/^}\$/p" "$BYODT")"
  [ -n "$fn" ] || { echo "FAIL: no $f in $BYODT"; exit 1; }
  eval "$fn"
done
die() { printf 'die: %s\n' "$*"; exit 3; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
mkdir -p data/plain elsewhere
ln -s "$work/elsewhere" data/linked
fail=0
ME="$(id -u)"
OWNER=""   # empty: the real owner; else the uid path_owner reports (for OWNER_PATH only, when that is set)
OWNER_PATH=""
eval "$(sed -n '/^path_owner() {$/,/^}$/p' "$BYODT" | sed '1s/^path_owner() {$/real_path_owner() {/')"
path_owner() { if [ -n "$OWNER" ] && { [ -z "$OWNER_PATH" ] || [ "$1" = "$OWNER_PATH" ]; }; then echo "$OWNER"; else real_path_owner "$1"; fi; }

check() { # CASE PATH WANT(pass|refuse) [SUDO_UID]
  local out rc=0
  out="$(SUDO_UID="${4:-}" refuse_foreign_entry "$2" 2>&1)" || rc=$?
  case "$3" in
    pass) if [ "$rc" -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1: refused: $out"; fail=1; fi ;;
    refuse)
      if [ "$rc" -eq 3 ] && grep -q "die: $2 is a symbolic link owned by uid $OWNER, not by you: byodt will not follow it" <<<"$out"; then echo "ok   $1"
      else echo "FAIL $1: rc $rc: $out"; fail=1; fi ;;
    refuse-dir)
      if [ "$rc" -eq 3 ] && grep -q "die: $2 is owned by uid $OWNER, not by you: another account could replace it" <<<"$out"; then echo "ok   $1"
      else echo "FAIL $1: rc $rc: $out"; fail=1; fi ;;
  esac
}

[ "$(real_path_owner data/linked)" = "$ME" ] || { echo "FAIL: the link's own owner reads $(real_path_owner data/linked), not $ME"; fail=1; }
check 'a plain directory passes' data/plain pass
check 'an absent path passes' data/absent pass
check "the operator's own link passes (a cache moved to another disk)" data/linked pass
OWNER=4242
check "a link another local account made is refused" data/linked refuse
check "a link the operator made, byodt run through sudo, passes" data/linked pass 4242
OWNER=0
check 'a link root made passes' data/linked pass
OWNER=4242
check 'a plain directory another account made is refused: its owner could swap it for a link after the check' data/plain refuse-dir
check "a directory another account made, byodt run through sudo by that account, passes" data/plain pass 4242

# ensure_layout itself, run in a scratch bundle with the engine and the .env lookups stubbed: every chmod it makes lands
# inside the scratch directory. A link planted at a child of data/ is refused before anything is widened, whether it is
# there before the run or appears between the check and the mkdir; data/ and data/models end sticky.
eval "$(sed -n '/^ensure_layout() {$/,/^}$/p' "$BYODT")"
ensure_engine() { :; }
ensure_db_engine() { :; }
check_engine_switch() { :; }
DBE=memgraph
info() { :; }
ENV_FILE=.env
MODE_FILE=mode/mode.env
SELF=byodt
BIND=1
db_is_bind() { [ "$BIND" -eq 1 ]; }
mode_of() { perl -e 'printf "%o\n", (lstat $ARGV[0])[2] & 07777' "$1"; }

layout_run() { # DIR: a fresh scratch bundle; runs ensure_layout there in a subshell, prints rc
  local rc=0
  rm -rf "$1" && mkdir -p "$1/target" && chmod 0700 "$1/target" && : > "$1/.env"
  ( cd "$1" && ensure_layout ) >"$1.out" 2>&1 || rc=$?
  echo "$rc"
}

OWNER=""
rc="$(layout_run "$work/b1")"
if [ "$rc" -eq 0 ] && [ "$(mode_of "$work/b1/data")" = 1777 ] && [ "$(mode_of "$work/b1/data/models")" = 1777 ] \
  && [ "$(mode_of "$work/b1/data/content-cache")" = 777 ] && [ "$(mode_of "$work/b1/data/memgraph")" = 777 ] \
  && [ "$(mode_of "$work/b1/tls")" = 700 ]; then echo "ok   ensure_layout: data/ and data/models sticky, the other runtime dirs 0777, tls 0700"
else echo "FAIL ensure_layout modes (rc $rc): data $(mode_of "$work/b1/data") models $(mode_of "$work/b1/data/models") cache $(mode_of "$work/b1/data/content-cache") $(cat "$work/b1.out")"; fail=1; fi

# Memgraph's layout makes no Neo4j directories.
if [ ! -e "$work/b1/data/neo4j" ] && [ ! -e "$work/b1/data/neo4j-logs" ]; then
  echo "ok   ensure_layout (memgraph): no Neo4j directories"
else echo "FAIL ensure_layout (memgraph) made a Neo4j directory: $(ls "$work/b1/data")"; fail=1; fi

# Neo4j's layout: its log and data directories 0777, no dumps directory (a dump never passes through data/), and no
# Memgraph directories.
DBE=neo4j
rc="$(layout_run "$work/n1")"
if [ "$rc" -eq 0 ] && [ "$(mode_of "$work/n1/data/neo4j")" = 777 ] && [ "$(mode_of "$work/n1/data/neo4j-logs")" = 777 ] \
  && [ ! -e "$work/n1/data/neo4j-dumps" ] && [ "$(mode_of "$work/n1/data/models")" = 1777 ] \
  && [ ! -e "$work/n1/data/memgraph" ] && [ ! -e "$work/n1/data/memgraph-log" ]; then
  echo "ok   ensure_layout (neo4j): data/neo4j and data/neo4j-logs 0777, no dumps directory, no Memgraph directories"
else echo "FAIL ensure_layout (neo4j) (rc $rc): $(cd "$work/n1/data" 2>/dev/null && for x in *; do printf '%s=%s ' "$x" "$(mode_of "$x")"; done) $(cat "$work/n1.out")"; fail=1; fi
BIND=0
rc="$(layout_run "$work/n2")"
if [ "$rc" -eq 0 ] && [ ! -e "$work/n2/data/neo4j" ] && [ "$(mode_of "$work/n2/data/neo4j-logs")" = 777 ]; then
  echo "ok   ensure_layout (neo4j, named volume): no data/neo4j, the log directory still made"
else echo "FAIL ensure_layout (neo4j, named volume) (rc $rc): $(ls "$work/n2/data" 2>/dev/null) $(cat "$work/n2.out")"; fail=1; fi
BIND=1
DBE=memgraph

# The upgrade that first creates data/models: a link another account planted there beforehand is refused, and its
# target is not widened.
mkdir -p "$work/b2"; rc=0
for case in memgraph:data/models memgraph:data/content-cache memgraph:data/memgraph-log memgraph:data/memgraph \
            neo4j:data/neo4j-logs neo4j:data/neo4j; do
  DBE="${case%%:*}"; d="${case#*:}"
  rm -rf "$work/b2"; mkdir -p "$work/b2/target" "$work/b2/data"; chmod 0700 "$work/b2/target"; : > "$work/b2/.env"
  ln -s "$work/b2/target" "$work/b2/$d"
  OWNER=4242; OWNER_PATH="$d"
  rc=0; ( cd "$work/b2" && ensure_layout ) >"$work/b2.out" 2>&1 || rc=$?
  OWNER=""; OWNER_PATH=""
  if [ "$rc" -eq 3 ] && grep -q "die: $d is a symbolic link owned by uid 4242" "$work/b2.out" && [ "$(mode_of "$work/b2/target")" = 700 ]; then
    echo "ok   ensure_layout ($DBE) refuses a foreign link planted at $d before the run, and widens nothing behind it"
  else echo "FAIL ensure_layout ($DBE) with a link at $d: rc $rc, target $(mode_of "$work/b2/target"): $(cat "$work/b2.out")"; fail=1; fi
done
DBE=memgraph

# A plain directory another account made at data/models before the run (the upgrade that first creates it): refused,
# and nothing is widened.
rm -rf "$work/b4"; mkdir -p "$work/b4/data/models"; : > "$work/b4/.env"; chmod 0700 "$work/b4/data/models"
OWNER=4242; OWNER_PATH=data/models; rc=0; ( cd "$work/b4" && ensure_layout ) >"$work/b4.out" 2>&1 || rc=$?; OWNER=""; OWNER_PATH=""
if [ "$rc" -eq 3 ] && grep -q "die: data/models is owned by uid 4242, not by you" "$work/b4.out" && [ "$(mode_of "$work/b4/data/models")" = 700 ]; then
  echo "ok   ensure_layout refuses a directory another account made at data/models, and widens nothing"
else echo "FAIL ensure_layout with a foreign directory at data/models: rc $rc, mode $(mode_of "$work/b4/data/models"): $(cat "$work/b4.out")"; fail=1; fi

# The race: the link appears after the first check, before the mkdir. mkdir is wrapped to plant it just before the
# real one runs; the check after the mkdir must refuse it before the chmod.
real_mkdir="$(command -v mkdir)"
RACE=""
mkdir() {
  if [ -n "$RACE" ] && [ "$*" != "-p data" ] && [ ! -e "$RACE" ]; then ln -s "$PWD/target" "$RACE"; fi
  "$real_mkdir" "$@"
}
for case in memgraph:data/models memgraph:data/content-cache memgraph:data/memgraph-log memgraph:data/memgraph \
            neo4j:data/neo4j-logs neo4j:data/neo4j; do
  DBE="${case%%:*}"; d="${case#*:}"
  rm -rf "$work/b3"; "$real_mkdir" -p "$work/b3/target"; chmod 0700 "$work/b3/target"; : > "$work/b3/.env"
  RACE="$d"; OWNER=4242; OWNER_PATH="$d"
  rc=0; ( cd "$work/b3" && ensure_layout ) >"$work/b3.out" 2>&1 || rc=$?
  RACE=""; OWNER=""; OWNER_PATH=""
  if [ "$rc" -eq 3 ] && grep -q "die: $d is a symbolic link owned by uid 4242" "$work/b3.out" && [ "$(mode_of "$work/b3/target")" = 700 ]; then
    echo "ok   ensure_layout ($DBE) refuses a foreign link at $d that appears between the check and the mkdir, before any chmod"
  else echo "FAIL ensure_layout ($DBE) race at $d: rc $rc, target $(mode_of "$work/b3/target"): $(cat "$work/b3.out")"; fail=1; fi
done
unset -f mkdir
DBE=memgraph

if [ "$fail" -ne 0 ]; then echo "refuse_foreign_entry: FAILED"; exit 1; fi
echo "refuse_foreign_entry: all cases pass"
