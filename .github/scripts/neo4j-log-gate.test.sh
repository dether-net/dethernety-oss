#!/usr/bin/env bash
# Pins neo4j-log-gate.sh on fixture logs: what passes, what fails, and what the allowlist lets through.
#
#   bash .github/scripts/neo4j-log-gate.test.sh
set -euo pipefail

GATE="$(cd "$(dirname "$0")" && pwd)/neo4j-log-gate.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0
# expect NAME pass|fail [GATE ARGS...]
expect() {
  local name="$1" want="$2" rc=0; shift 2
  bash "$GATE" "$@" >"$work/out" 2>&1 || rc=$?
  if { [ "$want" = pass ] && [ "$rc" -eq 0 ]; } || { [ "$want" = fail ] && [ "$rc" -ne 0 ]; }; then echo "ok   $name"
  else echo "FAIL $name (rc $rc): $(cat "$work/out")"; fail=1; fi
}

esc=$'\e'
printf 'PASS test/a.e2e-spec.ts\nTests:       1 skipped, 10 passed, 11 total\n' > "$work/jest.log"
printf ' ✓ test/b.e2e.spec.ts (4 tests)\n      Tests  4 passed (4)\n' > "$work/vitest.log"
# vitest in CI: the summary title dimmed, the count bold and green.
printf '%s[2m      Tests %s[22m %s[1m%s[32m4 passed%s[39m%s[22m%s[90m (4)%s[39m\n' "$esc" "$esc" "$esc" "$esc" "$esc" "$esc" "$esc" "$esc" > "$work/coloured.log"
printf 'Tests:       3 skipped, 3 total\n' > "$work/skipped.log"
printf '      Tests  2 failed | 0 passed (2)\n' > "$work/failed.log"
printf '      Tests  1 failed | 3 passed (4)\n' > "$work/partial.log"
: > "$work/empty.log"
{ cat "$work/jest.log"; printf '[test-db server failure] Connection [1] S: FAILURE {"code":"Neo.ClientError.Statement.SyntaxError"}\n'; } > "$work/syntax.log"
{ cat "$work/vitest.log"; printf 'S: FAILURE {"code":"Neo.ClientError.Procedure.ProcedureNotFound"}\n'; } > "$work/procedure.log"
{ cat "$work/vitest.log"; printf 'Write query failed {"code":"Neo.ClientError.Statement.ParameterMissing"}\n'; } > "$work/allowed-suite.log"
{ cat "$work/vitest.log"; printf 'S: FAILURE {"code":"Neo.ClientError.Statement.ParameterMissing"}\n'; } > "$work/other.log"
{ cat "$work/vitest.log"; printf 'S: FAILURE {"code":"Neo.ClientError.Schema.ConstraintValidationFailed"}\n'; } > "$work/schema.log"
{ cat "$work/vitest.log"; printf 'S: FAILURE {"code":"Neo.TransientError.Transaction.DeadlockDetected"}\n'; } > "$work/transient.log"
printf '# expected\n\nallowed-suite Neo\\.ClientError\\.Statement\\.ParameterMissing\n' > "$work/allow.txt"
printf 'allowed-suite\n' > "$work/no-pattern.txt"
printf 'allowed-suite Neo\\.(Foo\n' > "$work/bad-pattern.txt"

expect "a jest run that ran clean passes" pass "$work/jest.log"
expect "a vitest run that ran clean passes" pass "$work/vitest.log"
expect "a vitest run with a coloured summary passes" pass "$work/coloured.log"
expect "several clean runs pass" pass "$work/jest.log" "$work/vitest.log"
expect "a missing log fails" fail "$work/jest.log" "$work/absent.log"
expect "an empty log fails" fail "$work/empty.log"
expect "a run whose tests all skipped fails" fail "$work/skipped.log"
expect "a run with no passed test fails" fail "$work/failed.log"
expect "a vitest summary with a failure still counts its passes (the suite's own step fails it)" pass "$work/partial.log"
expect "a Statement error fails" fail "$work/syntax.log"
expect "a Procedure error fails" fail "$work/procedure.log"
expect "an error the allowlist names for its suite passes" pass --allow "$work/allow.txt" "$work/allowed-suite.log"
expect "the same error in another suite still fails" fail --allow "$work/allow.txt" "$work/other.log"
expect "a Schema error fails (a writer that lost its lock and met a uniqueness constraint)" fail "$work/schema.log"
expect "a transient code, which the driver retries, does not trip the gate" pass "$work/transient.log"
expect "an allowlist that is missing is refused" fail --allow "$work/nope.txt" "$work/vitest.log"
expect "an allowlist line with no pattern is refused" fail --allow "$work/no-pattern.txt" "$work/allowed-suite.log"
expect "an allowlist pattern grep cannot compile is refused" fail --allow "$work/bad-pattern.txt" "$work/allowed-suite.log"
expect "a broken allowlist is refused even on a run with no hits" fail --allow "$work/no-pattern.txt" "$work/vitest.log"
# A long log after the summary, and many hits: the gate reads it whole and reports, rather than dying on a closed pipe.
{ cat "$work/vitest.log"; for i in $(seq 1 20000); do printf 'trailing output line %06d after the summary\n' "$i"; done; } > "$work/long.log"
expect "a long log with its summary near the top passes" pass "$work/long.log"
{ cat "$work/vitest.log"; for i in $(seq 1 5000); do printf 'S: FAILURE {"code":"Neo.ClientError.Statement.SyntaxError","n":%d}\n' "$i"; done; } > "$work/many.log"
rc=0; bash "$GATE" "$work/many.log" "$work/vitest.log" >"$work/out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q '5000 lines' "$work/out" && grep -q '^ok   vitest$' "$work/out"; then echo "ok   many hits are counted, cut to 50, and the next log is still read"
else echo "FAIL many hits (rc $rc): $(tail -3 "$work/out")"; fail=1; fi
bash "$GATE" "$work/syntax.log" >"$work/out" 2>&1 || true
grep -q 'Neo.ClientError.Statement.SyntaxError' "$work/out" && echo "ok   the failing lines are printed" || { echo "FAIL the failing lines are not printed: $(cat "$work/out")"; fail=1; }
bash "$GATE" "$work/skipped.log" >"$work/out" 2>&1 || true
grep -q '^ok ' "$work/out" && { echo "FAIL a failed run is also reported ok: $(cat "$work/out")"; fail=1; } || echo "ok   a failed run is not also reported ok"

if [ "$fail" -ne 0 ]; then echo "neo4j-log-gate: FAILED"; exit 1; fi
echo "neo4j-log-gate: all cases pass"
