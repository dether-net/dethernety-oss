#!/usr/bin/env bash
# Pins how byodt picks and drives the graph database engine, by running the wrapper itself in scratch bundles with a
# stand-in `docker` on PATH that records every call and answers only what the wrapper asks; no container engine runs.
#
#   - the compose files: compose.yaml plus compose.<engine>.yaml, then compose.override.yaml when there is one;
#   - DB_ENGINE: recorded in .env on the first run (with NEO4J_IMAGE on Neo4j), an export overrides it for one
#     command, anything else is refused;
#   - the switch guard: an empty store for the chosen engine while the other engine's store holds data is refused,
#     before anything is recorded or created;
#   - db_query: mgconsole on Memgraph, cypher-shell as neo4j on Neo4j with the password on no command line;
#   - Neo4j backup and restore: the database stops, neo4j-admin runs in a one-off container with a private directory
#     mounted, the database starts again, on failure too; the dump is copied out private and the directory removed;
#     each engine refuses the other's backup.
#
#   bash deploy/tests/byodt-engine.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../compose" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
CALLS="$work/calls"
# The stand-in engine. `compose version` and `image inspect` answer as an engine with no image pulled. neo4j-admin's
# dump writes neo4j.dump into the directory mounted at /dumps, and its load copies that file out for the test to read,
# unless FAIL_ADMIN is set; FAIL_STOP fails `stop db`. Everything is recorded, and the mounted directory's mode with it.
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
[ "$1 $2" = "compose version" ] && exit 0
[ "$1 $2" = "image inspect" ] && exit 1
printf '%s\n' "$*" >> "$CALLS"
if [ "$1" = compose ] && [[ " $* " == *" exec -T db "* ]]; then cat >> "$CALLS.stdin"; fi
[[ " $* " == *" stop db "* ]] && [ -n "${FAIL_STOP:-}" ] && exit 1
# When the database is started again, is the private directory still there (it must be removed after the start)?
if [[ " $* " == *" start db"* ]]; then
  if ls -d .byodt-dump.* >/dev/null 2>&1; then echo before-cleanup > "$CALLS.start"; else echo after-cleanup > "$CALLS.start"; fi
fi
mounted=""
prev=""
for a in "$@"; do [ "$prev" = -v ] && mounted="${a%%:/dumps*}"; prev="$a"; done
if [ -n "$mounted" ]; then
  perl -e 'printf "%o\n", (stat $ARGV[0])[2] & 07777' "$mounted" > "$CALLS.mode"
  printf '%s\n' "$mounted" > "$CALLS.dir"
fi
if [[ " $* " == *" database dump "* ]]; then
  [ -z "${FAIL_ADMIN:-}" ] || exit 1
  printf 'graph' > "$mounted/neo4j.dump"
fi
if [[ " $* " == *" database load "* ]]; then
  [ -z "${FAIL_ADMIN:-}" ] || exit 1
  cp "$mounted/neo4j.dump" "$CALLS.loaded"
  perl -e 'printf "%o\n", (stat $ARGV[0])[2] & 07777' "$mounted/neo4j.dump" > "$CALLS.staged-mode"
fi
exit 0
SHIM
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS
unset DB_ENGINE CONTAINER_ENGINE NEO4J_IMAGE 2>/dev/null || true

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
mode_of() { perl -e 'printf "%o", (stat $ARGV[0])[2] & 07777' "$1"; }

# bundle NAME [ENV LINES...]: a fresh bundle from the shipped files, with an .env of the given lines and a password.
bundle() {
  local b="$work/$1"; shift
  rm -rf "$b"; mkdir -p "$b"
  cp "$SRC/byodt" "$SRC/compose.yaml" "$SRC/compose.memgraph.yaml" "$SRC/compose.neo4j.yaml" "$b/"
  printf '%s\n' "PLATFORM_VERSION=9.9.9" "CONTAINER_ENGINE=docker" "$@" > "$b/.env"
  printf 'NEO4J_PASSWORD=not-a-real-password\n' > "$b/.env.secrets"; chmod 0600 "$b/.env.secrets"
  : > "$CALLS"; rm -f "$CALLS.stdin" "$CALLS.loaded" "$CALLS.mode" "$CALLS.dir"
  printf '%s' "$b"
}
run() { ( cd "$B" && ./byodt "$@" ) </dev/null >"$work/out" 2>&1; }
boot() { ( cd "$B" && ./byodt bootstrap ) </dev/null >"$work/boot" 2>&1; }
compose_line() { grep -m1 '^compose ' "$CALLS" || true; }
# the calls that matter for a backup or restore, in order
admin_order() { sed -nE 's/^compose .* (stop db|start db)$/\1/p; s/^compose .* --entrypoint [^ ]+ -v [^ ]+ db (database [a-z]+) .*/\1/p' "$CALLS" | tr '\n' '|'; }
no_work_dirs() { [ -z "$(find "$B" -maxdepth 1 -name '.byodt-dump.*' -print)" ]; }

# 1. The compose files per engine, and a local override.
B="$(bundle m1)"; boot
run compose config || true
case "$(compose_line)" in
  "compose --env-file .env -f compose.yaml -f compose.memgraph.yaml config") ok "memgraph: compose.yaml + compose.memgraph.yaml" ;;
  *) bad "memgraph compose files: $(compose_line)" ;;
esac
grep -qx 'DB_ENGINE=memgraph' "$B/.env" && ok "the first run records DB_ENGINE=memgraph in .env" || bad "DB_ENGINE not recorded: $(cat "$B/.env")"
grep -q '^NEO4J_IMAGE=' "$B/.env" && bad "a Memgraph deployment recorded NEO4J_IMAGE" || ok "a Memgraph deployment records no NEO4J_IMAGE"
: > "$B/compose.override.yaml"; : > "$CALLS"
run compose config || true
case "$(compose_line)" in
  "compose --env-file .env -f compose.yaml -f compose.memgraph.yaml -f compose.override.yaml config") ok "compose.override.yaml is passed, last" ;;
  *) bad "override not passed last: $(compose_line)" ;;
esac
: > "$B/compose.override.yml"
run up || true
grep -q 'compose.override.yml is not loaded' "$work/out" && ok "another override name is named as not loaded" || bad "no warning for compose.override.yml: $(cat "$work/out")"

B="$(bundle n1 DB_ENGINE=neo4j)"; boot
run compose config || true
case "$(compose_line)" in
  "compose --env-file .env -f compose.yaml -f compose.neo4j.yaml config") ok "neo4j: compose.yaml + compose.neo4j.yaml" ;;
  *) bad "neo4j compose files: $(compose_line)" ;;
esac
[ "$(grep -c '^DB_ENGINE=' "$B/.env")" = 1 ] && ok "a recorded DB_ENGINE is not recorded twice" || bad "DB_ENGINE recorded twice"
img="$(sed -n 's/^readonly TESTED_NEO4J_IMAGE="\(.*\)"$/\1/p' "$SRC/byodt")"
grep -qx "NEO4J_IMAGE=$img" "$B/.env" && ok "the first Neo4j run records NEO4J_IMAGE, the tested image" || bad "NEO4J_IMAGE not recorded: $(cat "$B/.env")"

# A first run that makes .env from the template settles the engine from the file it just made.
B="$(bundle t1)"; rm -f "$B/.env"
printf '%s\n' "PLATFORM_VERSION=9.9.9" "CONTAINER_ENGINE=docker" "DB_ENGINE=neo4j" > "$B/.env.example"
boot; : > "$CALLS"
run compose config || true
if [[ "$(compose_line)" == *"-f compose.neo4j.yaml"* ]] && [ -d "$B/data/neo4j-logs" ] && [ ! -e "$B/data/memgraph-log" ]; then
  ok "the engine of a .env made from the template on the first run is the template's"
else bad "engine from a fresh .env: $(compose_line) / $(ls "$B/data" 2>/dev/null)"; fi

# 2. An export overrides .env for one command; anything but memgraph|neo4j is refused before compose runs.
: > "$CALLS"
( cd "$B" && DB_ENGINE=memgraph ./byodt compose config ) </dev/null >/dev/null 2>&1 || true
[[ "$(compose_line)" == *"-f compose.memgraph.yaml"* ]] && ok "an exported DB_ENGINE overrides .env" || bad "export ignored: $(compose_line)"
: > "$CALLS"; rc=0
( cd "$B" && DB_ENGINE=postgres ./byodt compose config ) </dev/null >"$work/out" 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && grep -q "DB_ENGINE=postgres in your shell's environment is not a database this bundle runs" "$work/out" && [ -z "$(compose_line)" ]; then
  ok "an unknown exported DB_ENGINE is refused before compose runs, and the message says where it came from"
else bad "unknown DB_ENGINE: rc $rc, $(cat "$work/out"), $(compose_line)"; fi
B="$(bundle n2 'export DB_ENGINE=neo4j  # chosen at install')"; boot
run compose config || true
[[ "$(compose_line)" == *"-f compose.neo4j.yaml"* ]] && ! grep -qx 'DB_ENGINE=memgraph' "$B/.env" \
  && ok "DB_ENGINE in .env is read as compose reads it (export prefix, trailing comment)" || bad "env parsing: $(compose_line) / $(cat "$B/.env")"

# 3. The switch guard, before anything is recorded or created.
B="$(bundle s1 DB_ENGINE=neo4j)"; mkdir -p "$B/data/memgraph"; : > "$B/data/memgraph/snapshot"; rc=0
run up || rc=$?
if [ "$rc" -ne 0 ] && grep -q 'DB_ENGINE is neo4j, but its data directory (./data/neo4j) is empty while memgraph' "$work/out" \
  && grep -q 'cannot be loaded into it' "$work/out" && ! grep -q ' up ' "$CALLS"; then
  ok "neo4j on an empty store beside Memgraph data is refused, before compose up"
else bad "switch guard (neo4j): rc $rc: $(cat "$work/out")"; fi
B="$(bundle s2 DB_ENGINE=memgraph)"; mkdir -p "$B/data/neo4j"; : > "$B/data/neo4j/store"; rc=0
run up || rc=$?
if [ "$rc" -ne 0 ] && grep -q 'DB_ENGINE is memgraph, but its data directory (./data/memgraph) is empty while neo4j' "$work/out" \
  && ! grep -q ' up ' "$CALLS"; then ok "memgraph on an empty store beside Neo4j data is refused, before compose up"
else bad "switch guard (memgraph): rc $rc: $(cat "$work/out")"; fi
B="$(bundle s3 DB_ENGINE=neo4j)"; mkdir -p "$B/data/memgraph" "$B/data/neo4j"; : > "$B/data/memgraph/snapshot"; : > "$B/data/neo4j/store"; rc=0
run up || rc=$?
[ "$rc" -eq 0 ] && ok "both stores holding data: the chosen one starts" || bad "both stores: rc $rc: $(cat "$work/out")"
B="$(bundle s4 DB_ENGINE=neo4j DB_DATA=memgraph-data)"; rc=0
run up || rc=$?
[ "$rc" -eq 0 ] && ok "the other engine on a named volume is not checked" || bad "named volume: rc $rc: $(cat "$work/out")"
B="$(bundle s5 DB_ENGINE=neo4j)"; mkdir -p "$B/data/neo4j"; : > "$B/data/neo4j/.DS_Store"; mkdir -p "$B/data/memgraph"; : > "$B/data/memgraph/snapshot"; rc=0
run up || rc=$?
[ "$rc" -ne 0 ] && ok "a .DS_Store alone does not make a store hold data" || bad ".DS_Store counted as data"
# An existing Memgraph deployment from before DB_ENGINE was recorded, run once with an export: refused, and nothing
# about it recorded or made — the next command without the export is a Memgraph deployment still.
for verb in up bootstrap; do
  B="$(bundle u-$verb)"; mkdir -p "$B/data/memgraph"; : > "$B/data/memgraph/snapshot"; rc=0
  ( cd "$B" && DB_ENGINE=neo4j ./byodt "$verb" ) </dev/null >"$work/out" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ] && ! grep -q '^DB_ENGINE=' "$B/.env" && ! grep -q '^NEO4J_IMAGE=' "$B/.env" \
    && [ ! -e "$B/data/neo4j" ] && [ ! -e "$B/data/neo4j-logs" ]; then
    ok "$verb with an exported DB_ENGINE=neo4j over Memgraph data is refused, and records and makes nothing"
  else bad "export over Memgraph data ($verb): rc $rc, .env: $(cat "$B/.env"), data: $(ls "$B/data" 2>/dev/null)"; fi
done

# 4. db_query per engine (through backup's reachability probe), and the first-run notices.
B="$(bundle q1 DB_ENGINE=memgraph NEO4J_USERNAME=dethernety)"; boot; : > "$CALLS"
run backup || true
grep -q -- 'exec -T db mgconsole --username dethernety --password not-a-real-password' "$CALLS" && ok "memgraph: db_query runs mgconsole as NEO4J_USERNAME" \
  || bad "memgraph db_query: $(cat "$CALLS")"
B="$(bundle q2 DB_ENGINE=neo4j NEO4J_USERNAME=dethernety NEO4J_DATABASE=memgraph)"; boot
grep -q 'NEO4J_USERNAME=dethernety in .env is not used on Neo4j' "$work/boot" && grep -q 'NEO4J_DATABASE=memgraph in .env is not used on Neo4j' "$work/boot" \
  && ok "neo4j: the first run says which .env connection values Neo4j does not use" || bad "neo4j notices: $(cat "$work/boot")"
run up || true
grep -q 'is not used on Neo4j' "$work/out" && bad "the notice repeats on a later start" || ok "the notice does not repeat on a later start"

# 5. Neo4j backup: stop, dump into a private directory, copy out private, start; the directory goes.
: > "$CALLS"
run backup "$work/q2-backups" || true
[ "$(admin_order)" = "stop db|database dump|start db|" ] && ok "neo4j backup: stop db, then the dump in a one-off container, then start db" \
  || bad "neo4j backup order: $(admin_order) / $(cat "$CALLS")"
grep -q -- '--entrypoint /var/lib/neo4j/bin/neo4j-admin -v ' "$CALLS" && ok "neo4j-admin runs as the service's user, past the image's entrypoint" \
  || bad "neo4j-admin entrypoint: $(cat "$CALLS")"
if grep -qF "exec -T db sh -c NEO4J_PASSWORD=\"\${NEO4J_AUTH#neo4j/}\" exec cypher-shell -u neo4j --format plain" "$CALLS" \
  && ! grep -q 'not-a-real-password' "$CALLS"; then ok "neo4j: db_query runs cypher-shell as neo4j, the password on no command line"
else bad "neo4j db_query: $(cat "$CALLS")"; fi
[ "$(cat "$CALLS.mode")" = 700 ] && ok "the dump directory is private (0700)" || bad "dump directory mode: $(cat "$CALLS.mode" 2>/dev/null)"
case "$(cat "$CALLS.dir")" in "$B"/.byodt-dump.*) ok "the dump directory is in the bundle, not under data/" ;; *) bad "dump directory: $(cat "$CALLS.dir")" ;; esac
out_file="$(ls "$work/q2-backups"/byodt-dump-9.9.9-*.dump 2>/dev/null | head -1)"
if [ -n "$out_file" ] && [ "$(cat "$out_file")" = graph ] && [ "$(mode_of "$out_file")" = 600 ] && no_work_dirs; then
  ok "neo4j backup: copied out as byodt-dump-<version>-<time>.dump, mode 0600, and the private directory removed"
else bad "neo4j backup output: ${out_file:-none} $(ls -la "$work/q2-backups" 2>&1) $(ls -a "$B")"; fi

[ "$(cat "$CALLS.start")" = before-cleanup ] && ok "the database is started before the private directory is removed" \
  || bad "start/cleanup order: $(cat "$CALLS.start" 2>/dev/null)"

# 6. Failures: the database is started again last, and the private directory goes.
: > "$CALLS"; rc=0
( cd "$B" && FAIL_ADMIN=1 ./byodt backup "$work/q2-backups" ) </dev/null >"$work/out" 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && grep -q 'neo4j-admin could not dump the database' "$work/out" && [ "$(admin_order)" = "stop db|database dump|start db|" ] \
  && [[ "$(tail -1 "$CALLS")" == *" start db" ]] && no_work_dirs; then
  ok "neo4j backup: a failed dump fails the command, starts the database last, and removes the private directory"
else bad "failed dump: rc $rc: $(cat "$work/out") / $(admin_order)"; fi
: > "$CALLS"; rc=0
( cd "$B" && FAIL_STOP=1 ./byodt backup "$work/q2-backups" ) </dev/null >"$work/out" 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && grep -q 'Could not stop the database; nothing was dumped' "$work/out" && ! grep -q 'database dump' "$CALLS" \
  && [[ "$(tail -1 "$CALLS")" == *" start db" ]] && no_work_dirs; then
  ok "neo4j backup: a failed stop dumps nothing, still asks the database to start, and leaves no directory"
else bad "failed stop: rc $rc: $(cat "$work/out") / $(cat "$CALLS")"; fi

# 7. Neo4j restore: confirm, stage privately, stop, load read-only, start; the directory goes.
# A backup readable by others (copied from elsewhere, say): the staged copy is still private.
printf 'graph-from-backup' > "$work/byodt-dump-9.9.9-20260101-000000.dump"; chmod 0644 "$work/byodt-dump-9.9.9-20260101-000000.dump"
: > "$CALLS"; rm -f "$CALLS.mode" "$CALLS.dir" "$CALLS.staged-mode"; rc=0
( cd "$B" && printf 'restore\n' | ./byodt restore "$work/byodt-dump-9.9.9-20260101-000000.dump" ) >"$work/out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && [ "$(admin_order)" = "stop db|database load|start db|" ] && [ "$(cat "$CALLS.loaded")" = graph-from-backup ] \
  && grep -q -- '-v [^ ]*:/dumps:ro db database load neo4j --from-path=/dumps --overwrite-destination=true' "$CALLS" \
  && [ "$(cat "$CALLS.mode")" = 700 ] && [ "$(cat "$CALLS.staged-mode")" = 600 ] && no_work_dirs; then
  ok "neo4j restore: stop db, load the privately staged dump (0600, in a 0700 directory) read-only, start db; the directory is removed"
else bad "neo4j restore: rc $rc, order $(admin_order): $(cat "$work/out") / $(cat "$CALLS")"; fi
: > "$CALLS"; rc=0
( cd "$B" && printf 'no\n' | ./byodt restore "$work/byodt-dump-9.9.9-20260101-000000.dump" ) >"$work/out" 2>&1 || rc=$?
[ "$rc" -ne 0 ] && [ -z "$(admin_order)" ] && no_work_dirs && ok "neo4j restore: no confirmation, nothing stopped" || bad "unconfirmed restore: $(cat "$CALLS")"
: > "$CALLS"; rc=0
( cd "$B" && printf 'restore\n' | FAIL_ADMIN=1 ./byodt restore "$work/byodt-dump-9.9.9-20260101-000000.dump" ) >"$work/out" 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && grep -q 'the current one may be gone' "$work/out" && [ "$(admin_order)" = "stop db|database load|start db|" ] && no_work_dirs; then
  ok "neo4j restore: a failed load says the graph may be gone, starts the database last, and removes the directory"
else bad "failed load: rc $rc: $(cat "$work/out") / $(admin_order)"; fi
: > "$CALLS"; rc=0
( cd "$B" && printf 'restore\n' | ./byodt restore "$work/byodt-dump-9.9.9-20260101-000000.dump" ) >"$work/out" 2>&1 || rc=$?
grep -q 'taken on version' "$work/out" && bad "same-version restore warned" || ok "a backup of this version restores without a version warning"
cp "$work/byodt-dump-9.9.9-20260101-000000.dump" "$work/byodt-dump-1.0.0-rc1-20260101-000000.dump"
( cd "$B" && printf 'no\n' | ./byodt restore "$work/byodt-dump-1.0.0-rc1-20260101-000000.dump" ) >"$work/out" 2>&1 || true
grep -q 'taken on version 1.0.0-rc1; this deployment is 9.9.9 — a dump may not load' "$work/out" && ok "a backup of another version warns, a hyphenated version read whole" \
  || bad "version warning: $(cat "$work/out")"

# 8. Each engine refuses the other's backup, before anything is stopped.
: > "$work/x.snapshot"; : > "$CALLS"; rc=0
( cd "$B" && printf 'restore\n' | ./byodt restore "$work/x.snapshot" ) >"$work/out" 2>&1 || rc=$?
[ "$rc" -ne 0 ] && grep -q 'is a Memgraph snapshot; this deployment runs Neo4j' "$work/out" && [ -z "$(admin_order)" ] \
  && ok "neo4j refuses a Memgraph snapshot" || bad "snapshot on neo4j: $(cat "$work/out")"
B="$(bundle r2 DB_ENGINE=memgraph)"; boot; rc=0
( cd "$B" && printf 'restore\n' | ./byodt restore "$work/byodt-dump-9.9.9-20260101-000000.dump" ) >"$work/out" 2>&1 || rc=$?
[ "$rc" -ne 0 ] && grep -q 'is a Neo4j dump; this deployment runs Memgraph' "$work/out" && ok "memgraph refuses a Neo4j dump" \
  || bad "dump on memgraph: $(cat "$work/out")"

# An export that differs from the deployment's engine does not reach a backup or a restore of the other engine's store.
B="$(bundle x1 DB_ENGINE=memgraph)"; boot; mkdir -p "$B/data/memgraph"; : > "$B/data/memgraph/snapshot"; : > "$CALLS"; rc=0
( cd "$B" && DB_ENGINE=neo4j ./byodt backup "$work/x1" ) </dev/null >"$work/out" 2>&1 || rc=$?
[ "$rc" -ne 0 ] && grep -q 'DB_ENGINE is neo4j, but its data directory' "$work/out" && ! grep -q ' stop db$' "$CALLS" \
  && ok "a backup under an exported DB_ENGINE=neo4j on a Memgraph deployment is refused, nothing stopped" || bad "backup under export: rc $rc: $(cat "$work/out")"
: > "$CALLS"; rc=0
( cd "$B" && printf 'restore\n' | DB_ENGINE=neo4j ./byodt restore "$work/byodt-dump-9.9.9-20260101-000000.dump" ) >"$work/out" 2>&1 || rc=$?
[ "$rc" -ne 0 ] && grep -q 'DB_ENGINE is neo4j, but its data directory' "$work/out" && ! grep -q ' stop db$' "$CALLS" \
  && ok "a restore under an exported DB_ENGINE=neo4j on a Memgraph deployment is refused, nothing stopped" || bad "restore under export: rc $rc: $(cat "$work/out")"

# The notice also comes when NEO4J_IMAGE was set before the first run.
B="$(bundle q3 NEO4J_IMAGE=docker.io/library/neo4j:5.26-community NEO4J_USERNAME=dethernety)"; rm -f "$B/.env.example"
( cd "$B" && DB_ENGINE=neo4j ./byodt bootstrap ) </dev/null >"$work/boot" 2>&1 || true
grep -q 'NEO4J_USERNAME=dethernety in .env is not used on Neo4j' "$work/boot" && ok "the notice comes on the first Neo4j run even with NEO4J_IMAGE preset" \
  || bad "notice with NEO4J_IMAGE preset: $(cat "$work/boot")"

# A bad DB_ENGINE does not stand in the way of help, version, tls or an unknown command's message.
B="$(bundle v1 DB_ENGINE=postgres)"; rc=0
( cd "$B" && ./byodt version ) </dev/null >"$work/out" 2>&1 || rc=$?
[ "$rc" -eq 0 ] && grep -q 'DB_ENGINE=postgres' "$work/out" && ok "version runs, and shows DB_ENGINE, whatever its value" || bad "version with a bad DB_ENGINE: rc $rc: $(cat "$work/out")"
rc=0; ( cd "$B" && ./byodt frobnicate ) </dev/null >"$work/out" 2>&1 || rc=$?
grep -q 'unknown command: frobnicate' "$work/out" && ok "an unknown command says so, whatever DB_ENGINE is" || bad "unknown command: $(cat "$work/out")"

# version lists the Neo4j image a Neo4j deployment's .env names (a key with a digit in it).
B="$(bundle v2 DB_ENGINE=neo4j NEO4J_IMAGE=docker.io/library/neo4j:5.26-enterprise)"; rc=0
( cd "$B" && ./byodt version ) </dev/null >"$work/out" 2>&1 || rc=$?
[ "$rc" -eq 0 ] && grep -qx '  NEO4J_IMAGE=docker.io/library/neo4j:5.26-enterprise' "$work/out" \
  && ok "version shows the NEO4J_IMAGE set in .env" || bad "version without NEO4J_IMAGE: rc $rc: $(cat "$work/out")"

if [ "$fail" -ne 0 ]; then echo "byodt engine: FAILED"; exit 1; fi
echo "byodt engine: all cases pass"
