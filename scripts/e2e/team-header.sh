#!/usr/bin/env bash
# team-header.sh — end-to-end evidence that a deployment's team identifier travels the whole way.
#
# The unit tests prove each hop. They cannot prove the hops CONNECT, and this is where that gap is:
#
#   1. a pasted recipe reaches mode.env on disk carrying the value       (the console, real binary)
#   2. mode.env, as compose's env_file, becomes a variable in the        (the stock platform image)
#      platform container's environment
#   3. that variable becomes a header on the wire — on entitled calls    (the module client, real node)
#      and on no others
#
# Link 2 is the load-bearing one. The module client reads a DEPLOYMENT_* name, which only works because
# the console writes it into a file the platform reads as env_file. Everything else in the design rests
# on that, and reading compose.yaml is not the same as watching it happen.
#
# It runs against a recording stub rather than a real service, so what it proves is that the TRANSPORT is
# correct: the variable becomes a header, on entitled calls and only those. It does not prove the FEATURE
# — the stub answers 200 whatever it is sent, so nothing here shows a real service scoping on the value,
# and nothing here shows what happens to a deployment that names no team, which the content service
# answers transitionally today and refuses once it enforces. Say so when reporting it.
#
# Usage:  bash scripts/e2e/team-header.sh [--skip-container-link]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OSS_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# A team identifier of the shape the issuer mints: an opaque base64url token.
TEAM_ID="9Xk2QpLm4RtZaB7cWvNfEg"
SKIP_CONTAINER=0
[ "${1:-}" = "--skip-container-link" ] && SKIP_CONTAINER=1

WORK="$(mktemp -d)"
STUB_PID=""
DAEMON_PID=""
FAILURES=0

cleanup() {
  # kill AND wait, both silenced: without the wait, bash's job control prints a "Terminated" line after
  # the summary, which reads like a failure in a transcript whose whole job is to be read.
  { [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" && wait "$DAEMON_PID"; } 2>/dev/null || true
  { [ -n "$STUB_PID" ] && kill "$STUB_PID" && wait "$STUB_PID"; } 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
pass() { printf '  \033[0;32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[0;31m✗ %s\033[0m\n' "$*"; FAILURES=$((FAILURES + 1)); }
note() { printf '    \033[0;90m%s\033[0m\n' "$*"; }

# jsonStr renders stdin as a JSON string literal. node is already a hard prerequisite (the console
# embeds a built SPA), so this needs no extra dependency and no quoting guesswork.
jsonStr() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))'; }

# ---------------------------------------------------------------------------------------------------
step "Building the console from this tree"
# The embed tree is gitignored and the Go package does not compile until it is populated.
bash "${OSS_ROOT}/apps/byodt-console/build-assets.sh" >"${WORK}/build-assets.log" 2>&1 \
  || { cat "${WORK}/build-assets.log"; echo "build-assets.sh failed"; exit 1; }
(cd "$OSS_ROOT" && go build -o "${WORK}/byodt-console" ./apps/byodt-console)
pass "console binary built"

step "Building the module client from this tree"
# The probe requires dist/, because dist/ is what ships inside the platform image.
(cd "${OSS_ROOT}/packages/dt-module" && npx tsc -b tsconfig.build.json)
pass "dt-module dist built"

# ---------------------------------------------------------------------------------------------------
step "Starting the recording content stub"
LOG="${WORK}/requests.log"
: >"$LOG"
node "${SCRIPT_DIR}/content-stub.mjs" --log "$LOG" --port 0 >"${WORK}/stub.out" 2>&1 &
STUB_PID=$!
for _ in $(seq 1 50); do
  grep -q '^PORT=' "${WORK}/stub.out" 2>/dev/null && break
  sleep 0.1
done
grep -q '^PORT=' "${WORK}/stub.out" || { cat "${WORK}/stub.out"; echo "stub did not start"; exit 1; }
STUB_PORT="$(sed -n 's/^PORT=//p' "${WORK}/stub.out")"
STUB="http://127.0.0.1:${STUB_PORT}"
pass "stub listening on ${STUB}"

# ---------------------------------------------------------------------------------------------------
step "Link 1 — a pasted recipe reaches the mode layer, and the console's own calls carry the team"
CONSOLE_PORT=$((20000 + RANDOM % 20000))
CONSOLE="http://127.0.0.1:${CONSOLE_PORT}"
MODE="${WORK}/mode.env"
mkdir -p "${WORK}/modules"
# The pure-OSS seed every bundle starts from. The console rewrites it on connect.
printf 'ENABLE_NOAUTH=true\nNODE_ENV=development\n' >"$MODE"

MODE_LAYER_PATH="$MODE" MODULES_DIR="${WORK}/modules" STATE_PATH="${WORK}/state.json" \
  CONSOLE_BIND=127.0.0.1 CONSOLE_PORT="$CONSOLE_PORT" \
  "${WORK}/byodt-console" daemon >"${WORK}/daemon.log" 2>&1 &
DAEMON_PID=$!
for _ in $(seq 1 50); do
  curl -fsS "${CONSOLE}/healthz" >/dev/null 2>&1 && break
  sleep 0.1
done
curl -fsS "${CONSOLE}/healthz" >/dev/null || { cat "${WORK}/daemon.log"; echo "daemon did not start"; exit 1; }
pass "console daemon listening on ${CONSOLE}"

# Local posture mints with no credential. This session is taken BEFORE the apply on purpose: cloudApply
# drops every other session and keeps this one on a grace TTL, which is what lets a script keep working
# across the posture flip without an identity provider.
SID="$(curl -fsS -X POST "${CONSOLE}/api/session" | sed -n 's/.*"session":"\([^"]*\)".*/\1/p')"
[ -n "$SID" ] || { echo "no session minted"; exit 1; }
pass "session minted with no credential (local posture)"

RECIPE="$(cat <<RECIPE_EOF | jsonStr
OIDC_ISSUER=https://issuer.example
OIDC_JWKS_URI=https://issuer.example/.well-known/jwks.json
OIDC_CLIENT_ID=clientid123
OIDC_AUDIENCE=clientid123
OIDC_SCOPE=openid profile email
OIDC_DOMAIN=auth.issuer.example
OIDC_SHARED_POOL=true
PORTAL_ORIGIN=https://portal.example
MODULE_CONTENT_BASE_URL=${STUB}
DEPLOYMENT_ALLOWLIST=sub-a,sub-b
DEPLOYMENT_TEAM_ID=${TEAM_ID}
RECIPE_EOF
)"
APPLY="$(curl -fsS -X POST "${CONSOLE}/api/cloud" \
  -H "X-Console-Session: ${SID}" -H 'Content-Type: application/json' \
  -d "{\"recipe\":${RECIPE},\"redirectUri\":\"${CONSOLE}/auth/callback\"}")" \
  || { echo "the apply was refused: ${APPLY:-}"; cat "${WORK}/daemon.log"; exit 1; }
pass "a recipe carrying DEPLOYMENT_TEAM_ID was accepted (it is refused wholesale without this change)"

if grep -qx "DEPLOYMENT_TEAM_ID=${TEAM_ID}" "$MODE"; then
  pass "the value reached mode.env on disk"
  note "$(grep '^DEPLOYMENT_TEAM_ID=' "$MODE")"
else
  fail "mode.env does not carry the team id"
  note "$(cat "$MODE")"
fi

# /api/packages makes both an entitled call (/v1/entitlements) and public ones (/v1/catalog/*), which is
# exactly the pair the rule is about. The cloud token is any string — the console never validates it, the
# service does.
curl -fsS "${CONSOLE}/api/packages" \
  -H "X-Console-Session: ${SID}" -H 'X-Console-Cloud-Token: an-access-token' >/dev/null \
  || { echo "the packages read failed"; cat "${WORK}/daemon.log"; exit 1; }
sleep 0.3 # the entitlements read runs beside the catalog in its own goroutine
cp "$LOG" "${WORK}/console-requests.log"
: >"$LOG"

printf '\n  what the console put on the wire:\n'
sed 's/^/    /' "${WORK}/console-requests.log"

# ---------------------------------------------------------------------------------------------------
# THE RULE, asserted as the biconditional it is, over every request rather than a chosen pair — so a
# surface nobody enumerated is still covered.
#
# `team=-` means NO HEADER REACHED THE WIRE, and only that. The stub logs a present-but-empty header as
# `(empty)`, which reads here as "sent" and so breaks the biconditional on a credential-free request —
# correctly. It used to log empty and absent identically, so the one defect worth catching on the public
# tier, a console attaching a blank team header to a publicly cacheable route, scored as a pass.
assert_iff() {
  local file="$1" label="$2"
  if awk '
      { auth=""; team=""
        for (i = 1; i <= NF; i++) {
          if ($i ~ /^auth=/) auth = substr($i, 6)
          if ($i ~ /^team=/) team = substr($i, 6)
        }
        if ((auth == "yes") != (team != "-")) { printf "      %s\n", $0; bad = 1 }
      }
      END { exit bad ? 1 : 0 }' "$file"; then
    pass "${label}: the team header was sent if and only if a credential was"
  else
    fail "${label}: a request broke the rule (offending lines above)"
  fi
}

assert_iff "${WORK}/console-requests.log" "console"
grep -qx "GET /v1/entitlements auth=yes team=${TEAM_ID}" "${WORK}/console-requests.log" \
  && pass "the entitled read named the team" \
  || fail "the entitled read did not name the team"
grep -qx 'GET /v1/catalog/packages auth=no team=-' "${WORK}/console-requests.log" \
  && pass "the public catalog read named nothing" \
  || fail "the public catalog read carried something it should not"

# ---------------------------------------------------------------------------------------------------
step "Link 2 — mode.env becomes a variable in the platform container"
if [ "$SKIP_CONTAINER" = "1" ]; then
  fail "SKIPPED BY REQUEST — the link that proves the module client can read the value at all is UNTESTED"
  note "this is a deliberate opt-out, not a pass; re-run without --skip-container-link"
else
  BUNDLE="${WORK}/bundle"
  mkdir -p "${BUNDLE}/mode" "${BUNDLE}/modules" "${BUNDLE}/data/content-cache" "${BUNDLE}/schema"
  # A throwaway bundle. The operator's own deploy/compose/ holds real state and is never touched.
  cp "${OSS_ROOT}/deploy/compose/compose.yaml" "${BUNDLE}/"
  cp "${OSS_ROOT}/deploy/compose/.env.example" "${BUNDLE}/.env"
  : >"${BUNDLE}/schema/schema-noauth.graphql"
  printf 'NEO4J_PASSWORD=not-a-real-password\nCONSOLE_IMAGE=ghcr.io/dether-net/byodt-console:0.6.1\n' >>"${BUNDLE}/.env"
  printf 'ENABLE_NOAUTH=true\nNODE_ENV=development\nDEPLOYMENT_TEAM_ID=%s\n' "$TEAM_ID" >"${BUNDLE}/mode/mode.env"

  ENGINE="docker"
  command -v docker >/dev/null 2>&1 || ENGINE="podman"
  if ! command -v "$ENGINE" >/dev/null 2>&1; then
    fail "no container engine found — link 2 could not run, and this is a FAILURE, not a skip"
  else
    note "engine: ${ENGINE}"
    # --no-deps so the database and the one-shot are not dragged in; the stock image, because this
    # tests compose's plumbing rather than our code.
    if OUT="$(cd "$BUNDLE" && "$ENGINE" compose --env-file .env run --rm --no-deps \
        --entrypoint sh platform -c 'printenv DEPLOYMENT_TEAM_ID' 2>"${WORK}/compose.err")"; then
      OUT="$(printf '%s' "$OUT" | tr -d '\r' | tail -n 1)"
      if [ "$OUT" = "$TEAM_ID" ]; then
        pass "the platform container's environment carries DEPLOYMENT_TEAM_ID=${OUT}"
      else
        fail "the container printed '${OUT}', expected '${TEAM_ID}'"
      fi
    else
      fail "compose could not run the platform service"
      note "$(tail -n 5 "${WORK}/compose.err")"
    fi
  fi
fi

# ---------------------------------------------------------------------------------------------------
step "Link 3 — the module client turns that variable into a header"
# The cache directory is set only to keep an unrelated warning out of the transcript; nothing here
# depends on it surviving.
# GUARDED LIKE LINK 2, and it was not. This is a bare pipeline under `set -euo pipefail`, and the probe
# exits non-zero when the module's dist build is missing — so the script died here, before the assertions
# below, before the failure accounting, and before the $FAILURES summary. A harness that exits 1 with no
# tally is indistinguishable from one that ran and failed, which is the wrong way round for the run whose
# whole job is to say which of three links broke.
if DEPLOYMENT_TEAM_ID="$TEAM_ID" MODULE_CONTENT_BASE_URL="$STUB" \
    MODULE_CONTENT_CACHE_DIR="${WORK}/content-cache" \
    node "${SCRIPT_DIR}/dt-module-probe.cjs" >"${WORK}/probe.out" 2>&1; then
  sed 's/^/  /' "${WORK}/probe.out"
else
  sed 's/^/  /' "${WORK}/probe.out"
  fail "the module client probe did not run — link 3 is unproven, not passed"
fi
sleep 0.2
cp "$LOG" "${WORK}/module-requests.log"

printf '\n  what the module client put on the wire:\n'
sed 's/^/    /' "${WORK}/module-requests.log"

if [ ! -s "${WORK}/module-requests.log" ]; then
  fail "the module client made no requests at all"
else
  assert_iff "${WORK}/module-requests.log" "module client"
  grep -q 'auth=yes team='"${TEAM_ID}" "${WORK}/module-requests.log" \
    && pass "an entitled call named the team" \
    || fail "no entitled call named the team"
  grep -q 'auth=no team=-' "${WORK}/module-requests.log" \
    && pass "a public call named nothing" \
    || fail "no public call was made, so the negative case is unproven"
fi

# ---------------------------------------------------------------------------------------------------
printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[0;32m▸ all three links hold.\033[0m\n'
  printf '  This proves the TRANSPORT, against a stub: the variable becomes a header, on entitled calls\n'
  printf '  only. It does not prove the FEATURE — the stub answers 200 whatever it is sent, so nothing\n'
  printf '  here shows a real service scoping on the value or refusing a call that omits it.\n'
  exit 0
fi
printf '\033[0;31m▸ %d check(s) failed.\033[0m\n' "$FAILURES"
exit 1
