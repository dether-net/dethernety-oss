#!/usr/bin/env bash
# Pins byodt's check_embedding_env and the env_setting it reads .env with: the old embedding server's model refuses
# however the line is written, every other embedding line is a notice and never a refusal, and data/ollama is reported
# (a directory or a link) and never removed. The functions are lifted out of the wrapper itself, so this tests the
# shipped code, against real .env files in a scratch directory; only the output helpers are stubbed, and no container
# engine is needed.
#
#   bash deploy/tests/byodt-check-embedding-env.sh [<.env file that must pass>]
#
# With a file, it also checks that one (CI: the shipped .env.example, the .env a first run starts from): the check must
# neither refuse it nor print anything, since every notice would reach each fresh install. The file must exist, and a
# relative path is taken from the caller's directory: the check runs in a scratch directory, where the wrapper's readers
# would find no file and report nothing, so a refused file would pass.
set -euo pipefail

THIS_TEST="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

BYODT="$(cd "$(dirname "$0")/../compose" && pwd)/byodt"
for f in env_setting check_embedding_env path_owner owned_by_operator; do
  fn="$(sed -n "/^$f() {\$/,/^}\$/p" "$BYODT")"
  [ -n "$fn" ] || { echo "FAIL: no $f in $BYODT"; exit 1; }
  eval "$fn"
done

BOLD="" RST="" SELF="byodt"
unset EMBEDDING_MODEL   # the shell's own would override every case's .env
info() { printf 'info: %s\n' "$*"; }
warn() { printf 'warn: %s\n' "$*"; }
die() { printf 'die: %s\n' "$*"; exit 3; }

if [ "$#" -eq 1 ]; then
  [ -f "$1" ] || { echo "FAIL: no file $1"; exit 1; }
  ENV_FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  scratch="$(mktemp -d)"
  trap 'rm -rf "$scratch"' EXIT
  set +e
  out="$(cd "$scratch" && check_embedding_env 2>&1)"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FAIL: $1 trips the pre-flight check: $out"
    exit 1
  fi
  if [ -n "$out" ]; then
    echo "FAIL: $1 makes the pre-flight check print (every fresh install would): $out"
    exit 1
  fi
  echo "ok   $1 passes the pre-flight check"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
ENV_FILE=".env"
fail=0

# run CASE ENV-CONTENT — runs the check in a subshell; sets OUT and RC.
run() {
  printf '%s\n' "$2" > .env
  set +e
  OUT="$(check_embedding_env 2>&1)"
  RC=$?
  set -e
}
expect_refused() {
  run "$1" "$2"
  if [ "$RC" -ne 3 ] || ! grep -q 'die: EMBEDDING_MODEL=embeddinggemma in .env names the old embedding server' <<<"$OUT"; then
    echo "FAIL $1: not refused (rc $RC): $OUT"; fail=1
  else echo "ok   $1 refused"; fi
}
expect_passes() {  # CASE CONTENT [EXPECTED-LINE...]
  local case="$1" content="$2"; shift 2
  run "$case" "$content"
  if [ "$RC" -ne 0 ]; then echo "FAIL $case: refused or failed (rc $RC): $OUT"; fail=1; return; fi
  local want
  for want in "$@"; do
    if [ "$(grep -cF -- "$want" <<<"$OUT")" -ne 1 ]; then echo "FAIL $case: want exactly one line with '$want', got: $OUT"; fail=1; return; fi
  done
  echo "ok   $case passes"
}

expect_refused 'the old model' 'EMBEDDING_MODEL=embeddinggemma'
expect_refused 'double-quoted' 'EMBEDDING_MODEL="embeddinggemma"'
expect_refused 'single-quoted' "EMBEDDING_MODEL='embeddinggemma'"
expect_refused 'with an inline comment' 'EMBEDDING_MODEL=embeddinggemma # the old default'
expect_refused 'with an export prefix and spaces' '  export EMBEDDING_MODEL = embeddinggemma  '
expect_refused 'the last assignment wins' $'EMBEDDING_MODEL=other\nEMBEDDING_MODEL=embeddinggemma'

expect_passes 'a clean .env' 'PLATFORM_VERSION=1.0.0'
[ -z "$OUT" ] || { echo "FAIL a clean .env: said something: $OUT"; fail=1; }
expect_passes 'a commented old model' '# EMBEDDING_MODEL=embeddinggemma'
[ -z "$OUT" ] || { echo "FAIL a commented old model: said something: $OUT"; fail=1; }
expect_passes 'the old model overridden by a later line' $'EMBEDDING_MODEL=embeddinggemma\nEMBEDDING_MODEL=embeddinggemma-300m-retrieval-v1' \
  'info: EMBEDDING_MODEL in .env is embeddinggemma-300m-retrieval-v1'
expect_passes 'another model is a notice' 'EMBEDDING_MODEL=nomic-embed-text' 'info: EMBEDDING_MODEL in .env is nomic-embed-text'
expect_passes 'an empty value is unset' 'EMBEDDING_MODEL='
[ -z "$OUT" ] || { echo "FAIL an empty value: said something: $OUT"; fail=1; }
expect_passes 'stale lines are notices, once each' \
  $'EMBEDDING_URL=http://ollama:11434/api/embed\nEMBEDDING_SIMILARITY_THRESHOLD=0.40\nOLLAMA_IMAGE=docker.io/ollama/ollama:0.32.6\nOLLAMA_IMAGE=x\nexport OLLAMA_KEEP_ALIVE=-1' \
  'info: EMBEDDING_URL in .env is no longer used' 'info: EMBEDDING_SIMILARITY_THRESHOLD in .env is no longer used' \
  'info: OLLAMA_IMAGE in .env is no longer used' 'info: OLLAMA_KEEP_ALIVE in .env is no longer used'
expect_passes 'stale lines beside a new model are notices, never a refusal' \
  $'EMBEDDING_MODEL=embeddinggemma-300m-retrieval-v1\nOLLAMA_IMAGE=docker.io/ollama/ollama:0.32.6' 'info: OLLAMA_IMAGE in .env is no longer used'

mkdir -p data/ollama/models && head -c 4096 /dev/zero > data/ollama/models/blob
expect_passes 'data/ollama as a directory is reported, not removed' 'PLATFORM_VERSION=1.0.0' \
  'holds the old embedding server' 'sudo rm -rf data/ollama'
[ -f data/ollama/models/blob ] || { echo "FAIL: data/ollama was touched"; fail=1; }
rm -rf data/ollama
mkdir -p bulk/ollama && head -c 4096 /dev/zero > bulk/ollama/blob && ln -s "$work/bulk/ollama" data/ollama
expect_passes 'a data/ollama link is reported as a link, neither followed nor named' 'PLATFORM_VERSION=1.0.0' \
  'info: data/ollama is a symbolic link' 'check where it points (ls -l data/ollama)'
if grep -qF "$work/bulk" <<<"$OUT" || grep -q 'sudo' <<<"$OUT"; then echo "FAIL: the notice names the link's target or advises sudo: $OUT"; fail=1; fi
[ -L data/ollama ] && [ -f bulk/ollama/blob ] || { echo "FAIL: the link or its target was touched"; fail=1; }
rm data/ollama

# A data/ollama directory another local account made is left alone: no size, no removal advice.
mkdir -p data/ollama
path_owner() { echo 4242; }
expect_passes 'a data/ollama directory someone else owns is left alone' 'PLATFORM_VERSION=1.0.0' \
  'info: data/ollama is owned by uid 4242, not by you or root; byodt leaves it alone.'
grep -q 'sudo\|holds the old' <<<"$OUT" && { echo "FAIL: advice for a foreign data/ollama: $OUT"; fail=1; }
eval "$(sed -n '/^path_owner() {$/,/^}$/p' "$BYODT")"
rm -rf data/ollama

# Compose takes EMBEDDING_MODEL from the shell's environment before .env.
printf '%s\n' 'PLATFORM_VERSION=1.0.0' > .env
set +e; OUT="$(EMBEDDING_MODEL=embeddinggemma check_embedding_env 2>&1)"; RC=$?; set -e
if [ "$RC" -eq 3 ] && grep -q "die: EMBEDDING_MODEL=embeddinggemma in your shell's environment" <<<"$OUT" && grep -q 'Unset EMBEDDING_MODEL in your shell' <<<"$OUT"; then
  echo "ok   the old model exported in the shell is refused, and the shell named"
else echo "FAIL the old model exported in the shell: rc $RC: $OUT"; fail=1; fi
set +e; OUT="$(EMBEDDING_MODEL= check_embedding_env 2>&1)"; RC=$?; set -e
[ "$RC" -eq 0 ] && [ -z "$OUT" ] && echo "ok   an empty exported EMBEDDING_MODEL is the default" || { echo "FAIL an empty exported EMBEDDING_MODEL: rc $RC: $OUT"; fail=1; }

# The file mode, as CI calls it: a path relative to the caller's directory, the check in a scratch directory.
mkdir -p given
printf '%s\n' 'PLATFORM_VERSION=1.0.0' 'EMBEDDING_MODEL=embeddinggemma' > given/refused.env
printf '%s\n' 'PLATFORM_VERSION=1.0.0' '# EMBEDDING_THREADS=4' > given/clean.env
file_mode() {  # CASE WANT-RC WANT-LINE PATH
  local got rc=0
  got="$(bash "$THIS_TEST" "$4" 2>&1)" || rc=$?
  if [ "$rc" -eq "$2" ] && grep -qF -- "$3" <<<"$got"; then echo "ok   $1"
  else echo "FAIL $1: rc $rc: $got"; fail=1; fi
}
file_mode 'a refused file given by a relative path fails' 1 'trips the pre-flight check' given/refused.env
file_mode 'a clean file given by a relative path passes' 0 'passes the pre-flight check' given/clean.env
file_mode 'a missing file fails, never passes' 1 'FAIL: no file given/absent.env' given/absent.env
printf '%s\n' 'PLATFORM_VERSION=1.0.0' 'OLLAMA_IMAGE=docker.io/ollama/ollama:0.32.6' > given/noisy.env
file_mode 'a file with a stale line fails: every fresh install would print its notice' 1 'makes the pre-flight check print' given/noisy.env

if [ "$fail" -ne 0 ]; then echo "check_embedding_env: FAILED"; exit 1; fi
echo "check_embedding_env: all cases pass"
