#!/usr/bin/env bash
# Pins how byodt moves the Memgraph password to the hash compose.memgraph.yaml names, by running the wrapper itself in
# scratch bundles with a stand-in `docker` on PATH that records every call; no container engine runs.
#
#   - compose.memgraph.yaml names the hash;
#   - after the start, `up` and `update` re-apply the password inside the db container, from the container's own
#     environment: the password is on no command line, on the host or in the container;
#   - only on Memgraph, only for the generated password shape (hex, 32 characters or more) and a plain user name,
#     read as compose reads it, and not when only the console or the database starts;
#   - the re-apply reads nothing from the caller's stdin;
#   - a failed re-apply warns and the command still succeeds;
#   - on Memgraph, a password shorter than 32 characters is warned about.
#
#   bash deploy/tests/byodt-reapply-password.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../compose" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
CALLS="$work/calls"
# The stand-in engine: `compose version` succeeds, no image is pulled, every other call is recorded and succeeds,
# except the re-apply when FAIL_EXEC is set.
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
[ "$1 $2" = "compose version" ] && exit 0
[ "$1 $2" = "image inspect" ] && exit 1
printf '%s\n' "$*" >> "$CALLS"
if [ "$1" = compose ] && [[ " $* " == *" exec -T db sh -c "* ]]; then
  cat >> "$CALLS.stdin"   # the re-apply's stdin, as compose would forward it to the container
  [ -z "${FAIL_EXEC:-}" ] || exit 1
fi
exit 0
SHIM
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS
unset DB_ENGINE CONTAINER_ENGINE NEO4J_IMAGE NEO4J_USERNAME FAIL_EXEC 2>/dev/null || true

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

GENERATED="0123456789abcdef0123456789abcdef0123456789abcdef"

# bundle NAME PASSWORD [ENV LINES...]: a fresh bundle from the shipped files, with an .env of the given lines (a later
# NEO4J_USERNAME line wins over the default one).
bundle() {
  local b="$work/$1" pw="$2"; shift 2
  rm -rf "$b"; mkdir -p "$b"
  cp "$SRC/byodt" "$SRC/compose.yaml" "$SRC/compose.memgraph.yaml" "$SRC/compose.neo4j.yaml" "$b/"
  printf '%s\n' "PLATFORM_VERSION=9.9.9" "CONTAINER_ENGINE=docker" "NEO4J_USERNAME=dethernety" "$@" > "$b/.env"
  printf 'NEO4J_PASSWORD=%s\n' "$pw" > "$b/.env.secrets"; chmod 0600 "$b/.env.secrets"
  : > "$CALLS"
  printf '%s' "$b"
}
run() { ( cd "$B" && ./byodt "$@" ) </dev/null >"$work/out" 2>&1; }
reapply_calls() { grep -c ' exec -T db sh -c ' "$CALLS" || true; }

# --- the flag ---------------------------------------------------------------------------------------------------
if grep -q -- '--password-encryption-algorithm=sha256-multiple' "$SRC/compose.memgraph.yaml"; then
  ok "compose.memgraph.yaml names the sha256-multiple password hash"
else
  bad "compose.memgraph.yaml does not name the sha256-multiple password hash"
fi
if grep -q -- '--password-encryption-algorithm' "$SRC/compose.neo4j.yaml"; then
  bad "compose.neo4j.yaml carries a Memgraph flag"
else
  ok "compose.neo4j.yaml is untouched"
fi

# --- up and update on Memgraph, with the generated password -------------------------------------------------------
B="$(bundle up-generated "$GENERATED")"
if run up; then ok "up succeeds"; else bad "up failed: $(cat "$work/out")"; fi
[ "$(reapply_calls)" = 1 ] && ok "up re-applies the password once" || bad "up re-applied the password $(reapply_calls) times"
line="$(grep -m1 ' exec -T db sh -c ' "$CALLS" || true)"
case "$line" in
  *'SET PASSWORD FOR %s TO'*'"$MEMGRAPH_USER" "$MEMGRAPH_PASSWORD"'*'FLAGS_password="$MEMGRAPH_PASSWORD" mgconsole --username "$MEMGRAPH_USER" --fromenv=password')
    ok "the statement is built inside the container from its own environment" ;;
  *) bad "unexpected re-apply call: $line" ;;
esac
case "$line" in
  *--password*) bad "mgconsole takes the password as an argument inside the container" ;;
  *) ok "mgconsole takes the password from its environment, not an argument" ;;
esac
if grep -q "$GENERATED" "$CALLS"; then bad "the password appears on a host command line"; else ok "the password is on no host command line"; fi
if grep -q "$GENERATED" "$work/out"; then bad "the password is printed"; else ok "the password is not printed"; fi
# The re-apply needs a healthy database, which the start waits for: it must come after `up -d`.
up_at="$(grep -n ' up -d' "$CALLS" | head -1 | cut -d: -f1)"
re_at="$(grep -n ' exec -T db sh -c ' "$CALLS" | head -1 | cut -d: -f1)"
if [ -n "$up_at" ] && [ -n "$re_at" ] && [ "$re_at" -gt "$up_at" ]; then ok "the re-apply runs after the start"; else bad "the re-apply does not run after the start ($up_at, $re_at)"; fi
if grep -q 'shorter than 32 characters' "$work/out"; then bad "the generated password is warned about"; else ok "the generated password is not warned about"; fi
# What follows `up` on its stdin (a pasted line, a script's next command) stays there: the re-apply reads none of it.
: > "$CALLS"; : > "$CALLS.stdin"
if ( cd "$B" && ./byodt up ) <<<"the next command" >"$work/out" 2>&1; then ok "up succeeds with input waiting on stdin"; else bad "up failed with input waiting on stdin: $(cat "$work/out")"; fi
if [ "$(reapply_calls)" = 1 ] && [ ! -s "$CALLS.stdin" ]; then
  ok "the re-apply leaves the caller's stdin alone"
else
  bad "the re-apply took the caller's stdin, or did not run ($(reapply_calls) calls)"
fi

: > "$CALLS"
if run update; then ok "update succeeds"; else bad "update failed: $(cat "$work/out")"; fi
[ "$(reapply_calls)" = 1 ] && ok "update re-applies the password once" || bad "update re-applied the password $(reapply_calls) times"

# --- a failed re-apply is not fatal ------------------------------------------------------------------------------
B="$(bundle up-fails "$GENERATED")"
if FAIL_EXEC=1 run up; then ok "up succeeds when the re-apply fails"; else bad "up failed when the re-apply failed: $(cat "$work/out")"; fi
grep -q 'Could not re-apply the database password' "$work/out" && ok "a failed re-apply is warned about" || bad "a failed re-apply is silent"

# --- only for the generated shape and a plain user ----------------------------------------------------------------
B="$(bundle up-short "0123456789abcdef")"
run up || true
[ "$(reapply_calls)" = 0 ] && ok "a short hex password is left on its old hash" || bad "a short hex password was re-applied"
grep -q 'shorter than 32 characters' "$work/out" && ok "a short password is warned about" || bad "a short password is not warned about"

B="$(bundle up-own "Correct-Horse-Battery-Staple-Long-Enough-123")"
run up || true
[ "$(reapply_calls)" = 0 ] && ok "a password not of the generated shape is left on its old hash" || bad "an operator's own password was re-applied"
if grep -q 'shorter than 32 characters' "$work/out"; then bad "a long operator password is warned about"; else ok "a long operator password is not warned about"; fi

B="$(bundle up-user "$GENERATED" "NEO4J_USERNAME=odd user")"
run up || true
[ "$(reapply_calls)" = 0 ] && ok "a user name that is not plain is left alone" || bad "a user name with a space was used in the statement"

B="$(bundle up-digit "$GENERATED" "NEO4J_USERNAME=1admin")"
run up || true
[ "$(reapply_calls)" = 0 ] && ok "a user name that starts with a digit is left alone" || bad "a user name that starts with a digit was used in the statement"

B="$(bundle up-quoted "$GENERATED" 'NEO4J_USERNAME="dethernety"')"
run up || true
[ "$(reapply_calls)" = 1 ] && ok "a quoted user name in .env is read as compose reads it" || bad "a quoted user name in .env was skipped"

B="$(bundle up-exported "$GENERATED")"
NEO4J_USERNAME="odd user" run up || true
[ "$(reapply_calls)" = 0 ] && ok "an exported user name, which compose prefers, is the one checked" || bad "an exported user name that is not plain was used in the statement"

B="$(bundle up-console "$GENERATED")"
run up console || true
[ "$(reapply_calls)" = 0 ] && ok "a start of the console alone, which does not start the database, skips it" || bad "a start of the console alone re-applied the password"
: > "$CALLS"
run up db || true
[ "$(reapply_calls)" = 0 ] && ok "a start of the database alone, which nothing waits on, skips it" || bad "a start of the database alone re-applied the password"
: > "$CALLS"
run up --force-recreate console || true
[ "$(reapply_calls)" = 0 ] && ok "a compose flag is not taken for a service" || bad "a compose flag was taken for a service that waits for the database"
: > "$CALLS"
run up proxy || true
[ "$(reapply_calls)" = 1 ] && ok "a start of a service that needs the database re-applies it" || bad "a start of the proxy re-applied the password $(reapply_calls) times"

# --- Neo4j ---------------------------------------------------------------------------------------------------------
B="$(bundle up-neo4j "$GENERATED" "DB_ENGINE=neo4j")"
run up || true
[ "$(reapply_calls)" = 0 ] && ok "Neo4j is left alone" || bad "the Memgraph re-apply ran on Neo4j"
B="$(bundle up-neo4j-short "0123456789abcdef" "DB_ENGINE=neo4j")"
run up || true
if grep -q 'shorter than 32 characters' "$work/out"; then bad "a short Neo4j password draws the Memgraph hash warning"; else ok "a short Neo4j password draws no Memgraph hash warning"; fi

exit "$fail"
