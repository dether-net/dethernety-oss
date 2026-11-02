#!/usr/bin/env bash
# Pins byodt's .env writer: the one place byodt changes .env or .env.secrets.
#
#   - env_write replaces the last active assignment (an `export ` prefix, spaces around the name and an inline comment
#     included), else uncomments the first `# KEY=` template line in place, else appends;
#   - documentation lines (`#   KEY=…`) are never taken for a template line;
#   - a value outside the allowlist (a space, a quote, #, $, a backslash, a newline, a control character) and a key
#     that is not a variable name are refused, with nothing written;
#   - env_comment_out and env_insert_block, and the block's own rule (no control character, exactly one key);
#   - a symbolic link and a leftover FILE.tmp are refused; the file's mode is kept, and .env.secrets stays 0600;
#   - with the shipped .env.example, every key setup writes lands where a hand edit would put it.
#
# The functions are loaded from the wrapper itself, everything above its dispatch, so no command runs.
#
#   bash deploy/tests/byodt-env-write.sh
set -euo pipefail

# No test may reach the network: stand-ins for curl, wget and cosign that fail loudly come before the system's.
export PATH="$(cd "$(dirname "$0")" && pwd)/no-network:$PATH"

SRC="$(cd "$(dirname "$0")/../compose" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
sed '/^# --- dispatch/,$d' "$SRC/byodt" > "$work/byodt-functions"

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

# run DIR SNIPPET [ARG]: runs SNIPPET in DIR with the wrapper's functions loaded, under a watchdog, with ARG as $2;
# prints its output.
run() {
  local dir="$1" snippet="$2"
  ( cd "$dir" && perl -e 'alarm(20); exec(@ARGV)' bash -c '. "$1"; '"$snippet" _ "$work/byodt-functions" "${3-}" ) 2>&1
}

# fresh NAME LINES...: a scratch directory holding a .env of the given lines; prints its path.
fresh() {
  local d="$work/$1"; shift
  mkdir -p "$d"
  printf '%s\n' "$@" > "$d/.env"
  chmod 0640 "$d/.env"
  printf '%s' "$d"
}

expect_env() { # expect_env DIR NAME EXPECTED-LINES...
  local d="$1" name="$2"; shift 2
  if [ "$(cat "$d/.env")" = "$(printf '%s\n' "$@")" ]; then ok "$name"; else bad "$name"; diff <(printf '%s\n' "$@") "$d/.env" || true; fi
}

# --- env_write ------------------------------------------------------------------------------------------------------
d="$(fresh replace-last 'A=1' 'FRONT_DOOR_PORT=3000' 'B=2' '  export FRONT_DOOR_PORT = 8080   # old' 'C=3')"
run "$d" 'env_write .env FRONT_DOOR_PORT 4000' >/dev/null
expect_env "$d" "the last active assignment is replaced, keeping its prefix and dropping the inline comment" \
  'A=1' 'FRONT_DOOR_PORT=3000' 'B=2' '  export FRONT_DOOR_PORT =4000' 'C=3'

d="$(fresh uncomment '# Which engine' '#   DB_ENGINE=neo4j' '# DB_ENGINE=memgraph' 'X=1' '# DB_ENGINE=other')"
run "$d" 'env_write .env DB_ENGINE neo4j' >/dev/null
expect_env "$d" "the first '# KEY=' template line is uncommented in place; '#   KEY=' documentation is left alone" \
  '# Which engine' '#   DB_ENGINE=neo4j' 'DB_ENGINE=neo4j' 'X=1' '# DB_ENGINE=other'

d="$(fresh active-beats-template '# HTTPS_PROXY=http://proxy.example.internal:3128' 'HTTPS_PROXY=http://a.example:1')"
run "$d" 'env_write .env HTTPS_PROXY http://b.example:3128' >/dev/null
expect_env "$d" "an active line wins over a template line" \
  '# HTTPS_PROXY=http://proxy.example.internal:3128' 'HTTPS_PROXY=http://b.example:3128'

d="$(fresh append 'A=1')"
run "$d" "env_write .env NEW_KEY 'v:1/2@x' 'Added by setup.'" >/dev/null
expect_env "$d" "a missing key is appended after its comment" 'A=1' '' '# Added by setup.' 'NEW_KEY=v:1/2@x'

d="$(fresh empty-value 'NO_PROXY=a.example')"
run "$d" 'env_write .env NO_PROXY ""' >/dev/null
expect_env "$d" "an empty value is written" 'NO_PROXY='

d="$(fresh similar-names 'FRONT_DOOR_PORT_X=1' 'XFRONT_DOOR_PORT=2' 'FRONT_DOOR_PORT=3')"
run "$d" 'env_write .env FRONT_DOOR_PORT 9' >/dev/null
expect_env "$d" "only the exact key is matched" 'FRONT_DOOR_PORT_X=1' 'XFRONT_DOOR_PORT=2' 'FRONT_DOOR_PORT=9'

d="$(fresh amp 'A=1')"
run "$d" "env_write .env A 'u%40x&y'" >/dev/null
expect_env "$d" "an & and a percent-encoding survive as written" 'A=u%40x&y'

n=0; refused=1
for v in 'a b' 'a"b' 'a#b' 'a$b' 'a\b' $'a\nB=2' $'a\tb' $'a\033[2Jb' $'a\rb'; do
  n=$((n + 1)); d="$(fresh "refuse-$n" 'A=1')"
  out="$(run "$d" 'env_write .env A "$2"' "$v" || true)"
  if [ "$(cat "$d/.env")" = "A=1" ] && [ ! -e "$d/.env.tmp" ] && printf '%s' "$out" | grep -q 'cannot be written'; then :
  else bad "refuses the value $(printf '%q' "$v")"; refused=0; fi
done
[ "$refused" = 1 ] && ok "a space, a double quote, #, \$, a backslash, a newline, a tab, ESC and CR are each refused, nothing written"
# The single quote is in the allowlist: the proxy login's grammar allows it, so a percent-encoded login may hold one.
d="$(fresh quote 'A=1')"
run "$d" 'env_write .env A "$2"' "a'b" >/dev/null || true
[ "$(cat "$d/.env")" = "A=a'b" ] && ok "a single quote, which the login grammar allows, is written" || bad "single quote"

refused=1
for k in 'a' '1A' 'A-B' 'A B' ''; do
  n=$((n + 1)); d="$(fresh "key-$n" 'A=1')"
  out="$(run "$d" 'env_write .env "$2" v' "$k" || true)"
  if [ "$(cat "$d/.env")" = "A=1" ] && printf '%s' "$out" | grep -q 'not a variable name'; then :; else bad "refuses the key '$k'"; refused=0; fi
done
[ "$refused" = 1 ] && ok "a key that is not an upper-case variable name is refused"

# --- files, links and modes ------------------------------------------------------------------------------------------
d="$(fresh mode 'A=1')"
run "$d" 'env_write .env A 2' >/dev/null
[ "$(stat -c %a "$d/.env" 2>/dev/null || stat -f %Lp "$d/.env")" = 640 ] && ok "the file's mode is kept" || bad "mode kept"

d="$(fresh secrets 'A=1')"
run "$d" 'env_write .env.secrets HTTPS_PROXY_USERINFO u:p%23w' >/dev/null
[ "$(stat -c %a "$d/.env.secrets" 2>/dev/null || stat -f %Lp "$d/.env.secrets")" = 600 ] && grep -qx 'HTTPS_PROXY_USERINFO=u:p%23w' "$d/.env.secrets" \
  && ok "a new .env.secrets is created 0600" || bad "new .env.secrets 0600"
chmod 0644 "$d/.env.secrets"
run "$d" 'env_write .env.secrets NEO4J_PASSWORD abc' >/dev/null
[ "$(stat -c %a "$d/.env.secrets" 2>/dev/null || stat -f %Lp "$d/.env.secrets")" = 600 ] && ok ".env.secrets is rewritten 0600 whatever its mode was" || bad ".env.secrets 0600"

d="$(fresh link 'A=1')"
mv "$d/.env" "$d/real.env"; ln -s real.env "$d/.env"
out="$(run "$d" 'env_write .env A 2' || true)"
[ "$(cat "$d/real.env")" = "A=1" ] && [ -L "$d/.env" ] && printf '%s' "$out" | grep -q 'symbolic link' \
  && ok "a symbolic link .env is refused, its target untouched" || bad "symlink refused"

d="$(fresh leftover 'A=1')"
echo junk > "$d/.env.tmp"
out="$(run "$d" 'env_write .env A 2' || true)"
[ "$(cat "$d/.env")" = "A=1" ] && [ "$(cat "$d/.env.tmp")" = junk ] && printf '%s' "$out" | grep -q 'exists, left by an earlier run' \
  && ok "a leftover .env.tmp is refused and left for the operator" || bad "leftover tmp"

d="$(fresh tmplink 'A=1')"
ln -s /nonexistent-target "$d/.env.tmp"
out="$(run "$d" 'env_write .env A 2' || true)"
[ "$(cat "$d/.env")" = "A=1" ] && printf '%s' "$out" | grep -q 'exists, left by an earlier run' \
  && ok "a dangling .env.tmp link is refused" || bad "tmp link"

d="$(fresh stop-on-refusal 'A=1')"
out="$(run "$d" 'env_write .env A "a b"; echo REACHED' || true)"
printf '%s' "$out" | grep -q REACHED && bad "a refusal stops the command" || ok "a refusal stops the command"

# --- env_comment_out and env_insert_block ---------------------------------------------------------------------------
d="$(fresh comment 'OLD=1' 'KEEP=2' '  export OLD = 3')"
run "$d" "env_comment_out .env OLD 'no longer used since 9.9.9'" >/dev/null
expect_env "$d" "every active assignment is commented out, with the note" \
  '# OLD=1  # no longer used since 9.9.9' 'KEEP=2' '#   export OLD = 3  # no longer used since 9.9.9'
before="$(cat "$d/.env")"
run "$d" "env_comment_out .env ABSENT note" >/dev/null
[ "$(cat "$d/.env")" = "$before" ] && ok "commenting out an absent key changes nothing" || bad "absent comment-out"

d="$(fresh block 'A=1')"
run "$d" 'env_insert_block .env "# A new setting, with \${PLATFORM_VERSION} in its template.
# NEW_IMAGE=ghcr.io/example/new:\${PLATFORM_VERSION}"' >/dev/null
expect_env "$d" "a template block is appended verbatim, \${…} included" \
  'A=1' '' '# A new setting, with ${PLATFORM_VERSION} in its template.' '# NEW_IMAGE=ghcr.io/example/new:${PLATFORM_VERSION}'
refused=1
for blk in $'# two\nA2=1\nB2=2' $'# none, only prose' $'# esc \033[2J\nX=1'; do
  n=$((n + 1)); d="$(fresh "block-$n" 'A=1')"
  run "$d" 'env_insert_block .env "$2"' "$blk" >/dev/null || true
  [ "$(cat "$d/.env")" = "A=1" ] || { bad "refuses the block $(printf '%q' "$blk")"; refused=0; }
done
[ "$refused" = 1 ] && ok "a block with two keys, no key or a control character is refused"

# --- with the shipped .env.example ----------------------------------------------------------------------------------
d="$work/shipped"; mkdir -p "$d"; cp "$SRC/.env.example" "$d/.env"
run "$d" 'env_write .env DB_ENGINE neo4j; env_write .env FRONT_DOOR_BIND 0.0.0.0; env_write .env FRONT_DOOR_PORT 3443
          env_write .env NEO4J_DATA neo4j-data; env_write .env HTTPS_PROXY http://proxy.corp.example:3128
          env_write .env NO_PROXY langgraph.corp.example; env_write .env PLATFORM_VERSION 9.9.9' >/dev/null
diff "$SRC/.env.example" "$d/.env" > "$work/shipped.diff" || true
# Each change is one line replaced in place: no line added, removed or moved, so the seven keys make seven old and
# seven new lines in the diff.
if [ "$(wc -l < "$SRC/.env.example")" = "$(wc -l < "$d/.env")" ] && [ "$(grep -c '^[<>]' "$work/shipped.diff")" = $((2 * 7)) ]; then
  ok "on .env.example, each key setup writes replaces its own line, in place"
else bad "in-place writes on .env.example"; cat "$work/shipped.diff"; fi
for want in 'DB_ENGINE=neo4j' 'FRONT_DOOR_BIND=0.0.0.0' 'FRONT_DOOR_PORT=3443' 'NEO4J_DATA=neo4j-data' \
            'HTTPS_PROXY=http://proxy.corp.example:3128' 'NO_PROXY=langgraph.corp.example' 'PLATFORM_VERSION=9.9.9'; do
  grep -qx "$want" "$d/.env" || bad "shipped: $want"
done
kept=1
for doc in '#   CONTAINER_ENGINE=docker' '#   CONTAINER_ENGINE=podman' '# CONTAINER_ENGINE='; do
  grep -qxF -- "$doc" "$d/.env" || { bad "shipped: documentation line kept: $doc"; kept=0; }
done
[ "$kept" = 1 ] && ok "on .env.example, the documentation lines are untouched"
out="$(run "$d" 'env_setting DB_ENGINE; echo; env_setting FRONT_DOOR_BIND')"
[ "$out" = "$(printf 'neo4j\n0.0.0.0')" ] && ok "env_setting reads back what was written" || bad "read back"

# --- what ensure_engine and ensure_db_engine record, byte for byte as before the writer existed -----------------------
d="$work/golden"; mkdir -p "$d"; printf 'A=1\n' > "$d/.env"
run "$d" 'ENGINE=docker; ensure_engine; DBE=neo4j; ensure_db_engine' >/dev/null
golden='A=1

# Container engine, recorded by byodt on first run — edit to change.
CONTAINER_ENGINE=docker

# Graph database engine, recorded by byodt on first run. Each engine keeps its own data; changing it
# starts an empty graph, and byodt refuses while the other engine'"'"'s data is still in place.
DB_ENGINE=neo4j

# The Neo4j image this deployment runs, recorded by byodt on first run. Back up before you change it:
# a store moved to a newer Neo4j cannot be moved back.
NEO4J_IMAGE=docker.io/library/neo4j:5.26.32-community'
if [ "$(cat "$d/.env")" = "$golden" ]; then ok "ensure_engine and ensure_db_engine record exactly what they always have"
else bad "ensure_engine and ensure_db_engine output"; diff <(printf '%s\n' "$golden") "$d/.env" || true; fi

if [ "$fail" = 0 ]; then echo "PASS byodt-env-write"; else echo "FAILED byodt-env-write"; exit 1; fi
