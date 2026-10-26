#!/usr/bin/env bash
# The log gate of the Neo4j test leg: a package's suites pass only if they ran and no statement failed with a
# `Neo.ClientError.Statement.*`, `Neo.ClientError.Procedure.*` or `Neo.ClientError.Schema.*` code.
#
#   neo4j-log-gate.sh [--allow FILE] LOG...
#
# Each LOG is one package's whole test run (stdout and stderr), named <suite>.log. The gate fails when:
#   - a log is missing or empty: the suites did not run;
#   - a log reports no passed test: suites that skipped (no Docker, an unset URI) must not pass as suites that ran;
#   - a log holds a Statement, Procedure or Schema error code that the allowlist does not cover. A green test run
#     proves little here, because code under test often catches a query error and goes on. What the logs carry: the
#     server failures the harness drivers write (marked `[test-db server failure]`, code included, swallowed or not),
#     the platform's own failed-query logs (with their code), and every error a test reports. A Memgraph-only
#     statement or procedure on Neo4j shows as a Statement or Procedure error; a writer that lost its lock and met a
#     uniqueness constraint shows as a Schema error (ConstraintValidationFailed), which the driver does not retry.
#
# Colour codes are stripped before reading: test runners colour their output in CI.
#
# The allowlist holds lines `<suite|*> <extended regex>`; a hit in that suite's log matching the regex is expected
# (a code the code under test answers on purpose). Blank lines and `#` comments are skipped; a line with no pattern,
# or a pattern grep cannot compile, fails the gate rather than let every hit through.
set -euo pipefail

allow=""
if [ "${1:-}" = --allow ]; then
  allow="${2:?--allow needs a file}"
  shift 2
  [ -f "$allow" ] || { echo "::error::allowlist $allow not found"; exit 2; }
  # Every line is checked up front, so a broken one fails the gate even on a run with no hits.
  while read -r scope pattern; do
    case "$scope" in ''|'#'*) continue ;; esac
    if [ -z "$pattern" ]; then echo "::error::allowlist line '$scope' has no pattern"; exit 2; fi
    rc=0
    grep -Eq -- "$pattern" <<<'' || rc=$?
    if [ "$rc" -gt 1 ]; then echo "::error::allowlist pattern '$pattern' is not a valid extended regex"; exit 2; fi
  done < "$allow"
fi
[ "$#" -gt 0 ] || { echo "usage: $0 [--allow FILE] LOG..." >&2; exit 2; }

fail=0
for log in "$@"; do
  suite="$(basename "$log" .log)"
  if [ ! -s "$log" ]; then
    echo "::error::$suite: no output at $log — the suites did not run"
    fail=1
    continue
  fi
  text="$(perl -pe 's/\e\[[0-9;]*[A-Za-z]//g' "$log")"
  suite_fail=0
  # jest: "Tests:       1 skipped, 10 passed, 11 total"; vitest: "      Tests  1 failed | 10 passed (11)".
  # Here-strings, not pipes: under pipefail a `grep -q` or `head` that stops reading early would kill the writer and
  # turn a match into a failure.
  if ! grep -Eq '^[[:space:]]*Tests:?[[:space:]]+([^,|]*[,|][[:space:]]*)*[1-9][0-9]* passed' <<<"$text"; then
    echo "::error::$suite: no test passed — suites that skipped or failed to start do not pass the gate"
    suite_fail=1
  fi
  hits="$(grep -nE 'Neo\.ClientError\.(Statement|Procedure|Schema)\.' <<<"$text" || true)"
  if [ -n "$hits" ] && [ -n "$allow" ]; then
    while read -r scope pattern; do
      case "$scope" in ''|'#'*) continue ;; esac
      [ "$scope" = '*' ] || [ "$scope" = "$suite" ] || continue
      hits="$(grep -Ev -- "$pattern" <<<"$hits" || true)"
    done < "$allow"
  fi
  if [ -n "$hits" ]; then
    echo "::error::$suite: statements failed in the database ($(wc -l <<<"$hits" | tr -d ' ') lines):"
    head -50 <<<"$hits"
    suite_fail=1
  fi
  if [ "$suite_fail" -eq 0 ]; then echo "ok   $suite"; else fail=1; fi
done
exit "$fail"
