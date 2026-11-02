#!/usr/bin/env bash
# Pins byodt's compose-project check, by running the wrapper in scratch bundles with a stand-in `docker` on PATH; no
# container engine runs.
#
#   - `up`, `update`, `down`, `stop`, `destroy`, `backup` and `restore` refuse while a container of the project
#     `dethernety`, running or stopped, was started from another directory, and name it; containers started here, or
#     with no directory label, do not count;
#   - on a fresh folder (no database password yet), `up` also refuses when the named volume the database would mount
#     already exists, before any password is written; a bind mount, or an existing deployment, is not refused;
#   - `down --take-over` and `destroy --take-over` are the way out for a deployment moved from another directory.
#
#   bash deploy/tests/byodt-project.sh
set -euo pipefail

# No test may reach the network: stand-ins for curl, wget and cosign that fail loudly come before the system's.
export PATH="$(cd "$(dirname "$0")" && pwd)/no-network:$PATH"

SRC="$(cd "$(dirname "$0")/../compose" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
CALLS="$work/calls"
# The stand-in engine. STUB_IDS lists the project's containers; STUB_WD_<id> is the directory each was started from
# ("none" for no label); STUB_VOLUMES lists the volumes that exist. Every other call is recorded and succeeds.
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
[ "$1 $2" = "compose version" ] && exit 0
[ "$1 $2" = "image inspect" ] && exit 1
if [ "$1" = ps ] && [ "$2" = -aq ]; then
  case "$*" in *"project=dethernety --filter"*) exit 0 ;; esac   # project_containers asks per service: none
  for id in ${STUB_IDS:-}; do printf '%s\n' "$id"; done
  exit 0
fi
if [ "$1" = inspect ]; then
  id="${!#}"; var="STUB_WD_$id"; wd="${!var:-none}"
  if [ "$wd" = none ]; then echo '<no value>'; else printf '%s\n' "$wd"; fi
  exit 0
fi
if [ "$1 $2" = "volume inspect" ]; then
  for v in ${STUB_VOLUMES:-}; do [ "$v" = "$3" ] && exit 0; done
  exit 1
fi
printf '%s\n' "$*" >> "$CALLS"
exit 0
SHIM
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS
unset DB_ENGINE CONTAINER_ENGINE NEO4J_IMAGE NEO4J_USERNAME HTTPS_PROXY https_proxy NO_PROXY no_proxy STUB_IDS STUB_VOLUMES \
  2>/dev/null || true

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

PASSWORD="0123456789abcdef0123456789abcdef0123456789abcdef"

# bundle NAME fresh|set-up [ENV LINES...]: a scratch bundle from the shipped files. "set-up" adds the database password
# and the mode layer, as an earlier start leaves them.
bundle() {
  local b="$work/$1" state="$2"; shift 2
  mkdir -p "$b"
  cp "$SRC/byodt" "$SRC/compose.yaml" "$SRC/compose.memgraph.yaml" "$SRC/compose.neo4j.yaml" "$SRC/THIRD-PARTY-ACKNOWLEDGEMENT" "$SRC/.env.example" "$b/"
  printf '%s\n' "PLATFORM_VERSION=9.9.9" "CONTAINER_ENGINE=docker" "NEO4J_USERNAME=dethernety" "$@" > "$b/.env"
  if [ "$state" = set-up ]; then
    printf 'NEO4J_PASSWORD=%s\n' "$PASSWORD" > "$b/.env.secrets"; chmod 0600 "$b/.env.secrets"
    mkdir -p "$b/mode"; printf 'ENABLE_NOAUTH=true\n' > "$b/mode/mode.env"
  fi
  printf '%s' "$b"
}

# byodt DIR ARGS...: runs the wrapper in DIR under a watchdog; output in $work/out, exit status in $rc.
byodt() {
  local d="$1"; shift
  : > "$CALLS"
  set +e
  case "$1" in up|update) set -- "$@" --yes ;; esac
  ( cd "$d" && perl -e 'alarm(30); exec(@ARGV)' ./byodt "$@" ) </dev/null > "$work/out" 2>&1
  rc=$?
  set -e
}
started() { grep -q ' up -d' "$CALLS"; }

# --- containers from another directory ------------------------------------------------------------------------------
b="$(bundle clean set-up)"
STUB_IDS="" byodt "$b" up
[ "$rc" = 0 ] && started && ok "no container of the project: up starts" || { bad "no containers"; cat "$work/out"; }

b="$(bundle here set-up)"
STUB_IDS="c1 c2" STUB_WD_c1="$b" STUB_WD_c2="$(cd "$b" && pwd -P)" byodt "$b" up
[ "$rc" = 0 ] && started && ok "containers started from this directory (either spelling of its path): up starts" \
  || { bad "own containers"; cat "$work/out"; }

b="$(bundle other set-up)"
STUB_IDS="c1 c2" STUB_WD_c1="/srv/byodt-0.13.0" STUB_WD_c2="none" byodt "$b" up
if [ "$rc" != 0 ] && ! started && grep -q '/srv/byodt-0.13.0' "$work/out" && grep -q 'already used by another directory' "$work/out"; then
  ok "a container from another directory stops up, which names that directory"
else bad "other directory stops up"; cat "$work/out"; fi
grep -q "byodt down --take-over'" "$work/out" && ok "the refusal says how a moved deployment gets out" || bad "moved hint"

STUB_IDS="c1" STUB_WD_c1="/srv/byodt-0.13.0" byodt "$b" update
[ "$rc" != 0 ] && ! grep -q '^compose.* pull' "$CALLS" && ok "update stops too, before pulling" || { bad "update refused"; cat "$work/out"; }

for c in down stop destroy backup "restore $b/.env.example"; do
  # shellcheck disable=SC2086
  STUB_IDS="c1" STUB_WD_c1="/srv/byodt-0.13.0" byodt "$b" $c
  if [ "$rc" != 0 ] && ! grep -q '^cp \| down\| exec' "$CALLS" && grep -q '/srv/byodt-0.13.0' "$work/out"; then
    ok "${c%% *} stops too, naming that directory, before it touches a container"
  else bad "${c%% *} refused"; cat "$work/out"; fi
done
for c in down stop destroy nuke; do
  STUB_IDS="c1" STUB_WD_c1="/srv/byodt-0.13.0" byodt "$b" $c --take-over
  [ "$rc" = 0 ] && grep -q ' down' "$CALLS" && ! grep -q -- '--take-over' "$CALLS" \
    && ok "$c --take-over removes the containers another directory started, and the flag stays byodt's" || { bad "$c --take-over"; cat "$work/out"; }
done

b="$(bundle nolabel set-up)"
STUB_IDS="c9" STUB_WD_c9="none" byodt "$b" up
[ "$rc" = 0 ] && started && ok "a container with no directory label does not count" || { bad "no label"; cat "$work/out"; }

# --- a fresh folder and an existing volume ---------------------------------------------------------------------------
b="$(bundle fresh-volume fresh 'DB_DATA=memgraph-data')"
STUB_VOLUMES="dethernety_memgraph-data" byodt "$b" up
if [ "$rc" != 0 ] && ! started && [ ! -e "$b/.env.secrets" ] && grep -q 'dethernety_memgraph-data remains from an earlier deployment' "$work/out" && grep -q 'Set DB_DATA=./data/memgraph' "$work/out"; then
  ok "a fresh folder stops on an existing volume it would mount, before a password is written"
else bad "fresh volume"; cat "$work/out"; fi

b="$(bundle fresh-neo4j fresh 'DB_ENGINE=neo4j' 'NEO4J_DATA=neo4j-data')"
STUB_VOLUMES="dethernety_neo4j-data" byodt "$b" up
[ "$rc" != 0 ] && ! started && ok "the same on Neo4j" || { bad "fresh neo4j volume"; cat "$work/out"; }

b="$(bundle fresh-bind fresh)"
STUB_VOLUMES="dethernety_memgraph-data" byodt "$b" up
[ "$rc" = 0 ] && started && ok "a fresh folder on a bind mount is not stopped by a volume it does not mount" \
  || { bad "fresh bind"; cat "$work/out"; }

b="$(bundle existing-volume set-up 'DB_DATA=memgraph-data')"
STUB_VOLUMES="dethernety_memgraph-data" byodt "$b" up
[ "$rc" = 0 ] && started && ok "an existing deployment's own volume does not stop it" || { bad "existing volume"; cat "$work/out"; }

if [ "$fail" = 0 ]; then echo "PASS byodt-project"; else echo "FAILED byodt-project"; exit 1; fi
