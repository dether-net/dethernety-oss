#!/usr/bin/env bash
# Pins `byodt upgrade`, by upgrading scratch deployments between two fixture releases built from this tree (9.9.8 and
# 9.9.9), served by a stand-in curl, with a stand-in docker playing the engine; nothing is downloaded and no container
# engine runs.
#
#   - the target is found from its own get-byodt.sh (latest, or a named version), and its bundle verified by the pinned
#     hash; a mismatch, a downgrade, the same version, or no version without a terminal or --yes are refused, with
#     nothing changed;
#   - the new release's own byodt runs the check, the backup and the move (a marker in the 9.9.9 fixture shows it), and
#     the moved-in byodt finishes;
#   - checks come first: edited shipped files (refused before any backup; --replace-edited goes on; a file the new
#     release no longer ships is left alone, and the first run's record leaves out .DS_Store; with no record of the old
#     release's files, a warning, and edits are replaced but kept in the backup), a database that is not running
#     (--skip-graph-backup goes on), a compose file missing here (named, with no hint to skip the backup);
#   - the backup: the graph through the old byodt, .env, the shipped files as they were, in a private directory;
#   - from real releases, through the new release's installer: 0.13.0, checked against its manifest; 0.12.1, whose
#     compose.yaml holds the database (no engine file): the database check reads compose.yaml alone, as does the notice
#     with a compose.override.yaml, 0.12.1's own byodt backs up, the move brings compose.memgraph.yaml, DB_ENGINE is
#     recorded, and the rollback steps bring 0.12.1's layout back;
#   - .env: PLATFORM_VERSION, a new setting added as its template, a new default taken where the old one was kept, a
#     setting no longer used commented out; CONSOLE_IMAGE retagged; the database image moved only with --move-db;
#   - interruptions: a failed pull is resumed by running upgrade again, and up is refused meanwhile; a health timeout
#     is checked again; a failed move puts the old files back; a run killed in the middle of the move resumes; a run
#     that stopped before it changed anything starts over with its own flags; a state file byodt does not trust stops
#     up;
#   - --abandon, the lock and its takeover, and the version comparator;
#   - the signature: verified with cosign against the exact identity and issuer; UPGRADE_REQUIRE_SIGNATURE=true refuses
#     --allow-unsigned before any download, and a value other than true or false stops;
#   - the commands it prints name byodt as it was run, never the staged copy, and the rollback steps start with a cd.
#
#   bash deploy/tests/byodt-upgrade.sh
#
# The cases built from a release tag skip when this checkout lacks the tag; with BYODT_TEST_REQUIRE_TAGS=1 (CI, which
# fetches them) a missing tag fails instead.
set -euo pipefail

# No test may reach the network: stand-ins for curl, wget and cosign that fail loudly come before the system's.
export PATH="$(cd "$(dirname "$0")" && pwd)/no-network:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
# python3 drives the terminal case; found now, before PATH is narrowed to the tools byodt uses.
PY3="$(command -v python3 2>/dev/null || true)"
SRC="$(cd "$HERE/../compose" && pwd)"
INSTALLER="$(cd "$HERE/../installer" && pwd)"
work="$(mktemp -d)"
# held: a process that holds an upgrade lock in a case; it is ended with the test, however the test ends.
held=""
trap '[ -z "$held" ] || kill "$held" 2>/dev/null; rm -rf "${work:?}"' EXIT
CALLS="$work/calls"
export CALLS

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; sed 's/^/     | /' "$work/out" | tail -14; fi; }
sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
inode_of() { stat -c %i "$1" 2>/dev/null || stat -f %i "$1"; }
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
# no_tag VERSION: the case built from VERSION's release tag cannot run here.
no_tag() {
  if [ "${BYODT_TEST_REQUIRE_TAGS:-}" = 1 ]; then bad "this checkout has no v$1 tag, and BYODT_TEST_REQUIRE_TAGS=1 requires it"
  else echo "skip $1 to 9.9.9: this checkout has no v$1 tag"; fi
}

# --- two fixture releases ------------------------------------------------------------------------------------------------
REL="$work/releases"
# release VERSION: builds byodt-VERSION.tar.gz and its get-byodt.sh under $REL/vVERSION from this tree.
release() {
  local v="$1" d="$REL/src/byodt-$1"
  mkdir -p "$d" "$REL/v$v"
  ( cd "$SRC" && cp -R byodt compose.yaml compose.memgraph.yaml compose.neo4j.yaml .env.example THIRD-PARTY-ACKNOWLEDGEMENT \
      NOTICE LICENSE README.md proxy .gitignore "$d/" )
  sed -i.bak "s/^PLATFORM_VERSION=.*/PLATFORM_VERSION=$v/" "$d/.env.example"
  if [ "$v" != 9.9.8 ]; then
    # What changes between the two: a new setting, a new front-door default, a setting dropped, a new file, a newer
    # tested database, and a marker that shows which release's byodt ran each phase. Two changes an upgrade must not
    # carry over: a new DB_DATA default and DB_ENGINE's template line gone (both hold the deployment's state).
    sed -i.bak -e 's|^PROXY_IMAGE=.*|PROXY_IMAGE=docker.io/nginx:1.29-alpine|' -e '/SNAPSHOT_INTERVAL_SEC/d' \
               -e 's|^DB_DATA=.*|DB_DATA=memgraph-data|' -e '/^# DB_ENGINE=/d' "$d/.env.example"
    printf '\n# A setting 9.9.9 adds.\n# NEW_SETTING=on\n' >> "$d/.env.example"
    printf 'New in 9.9.9.\n' > "$d/NEWFILE.md"
    awk '{ print } $0 == "set +a" { print "[ -z \"${UPGRADE_MARK:-}\" ] || printf \"byodt-9.9.9 %s\\n\" \"$*\" >> \"$UPGRADE_MARK\"" }' \
      "$d/byodt" > "$d/byodt.new" && mv "$d/byodt.new" "$d/byodt" && chmod 0755 "$d/byodt"
    sed -i.bak 's|^readonly TESTED_DB_IMAGE=.*|readonly TESTED_DB_IMAGE="docker.io/memgraph/memgraph:3.14.0"|' "$d/byodt"
  fi
  rm -f "${d:?}"/*.bak "${d:?}"/.*.bak
  # 9.9.11 is 9.9.9 plus a file under data/, which belongs to a deployment, never to a release.
  if [ "$v" = 9.9.11 ]; then mkdir -p "$d/data" && printf 'x\n' > "$d/data/planted"; fi
  ( cd "$REL/src" && COPYFILE_DISABLE=1 tar -czf "$REL/v$v/byodt-$v.tar.gz" "byodt-$v" )
  ( cd "$d" && env -i PATH="$PATH" ./byodt notice --all ) > "$REL/v$v/notice.txt"
  sh "$INSTALLER/render.sh" "$v" "$(sha_of "$REL/v$v/byodt-$v.tar.gz")" "$(sha_of "$d/THIRD-PARTY-ACKNOWLEDGEMENT")" "$REL/v$v/notice.txt" \
    > "$REL/v$v/get-byodt.sh"
}
release 9.9.8
release 9.9.9
release 9.9.11
grep -q 'byodt-9.9.9' "$REL/src/byodt-9.9.9/byodt" || { echo "FAIL the 9.9.9 fixture has no marker"; exit 1; }
mkdir -p "$REL/latest" && cp "$REL/v9.9.9/get-byodt.sh" "$REL/latest/get-byodt.sh"

# --- stand-ins --------------------------------------------------------------------------------------------------------------
mkdir -p "$work/bin"
cat > "$work/bin/curl" <<'SHIM'
#!/usr/bin/env bash
# Serves the fixture releases from $REL; STUB_TAMPER serves a changed bundle.
printf '%s\n' "$*" >> "$CALLS.curl"
out=""; url=""; while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; --max-filesize) shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
case "$url" in
  https://github.com/dether-net/dethernety-oss/releases/latest/download/*) f="$REL/latest/${url##*/}" ;;
  https://github.com/dether-net/dethernety-oss/releases/download/v*/*) v="${url#*/download/v}"; f="$REL/v${v%%/*}/${url##*/}" ;;
  *) exit 22 ;;
esac
[ -f "$f" ] || exit 22
# byodt and the installer read what they download from standard output. STUB_BIG serves a get-byodt.sh one byte over
# the size byodt accepts for it.
if [ -n "${STUB_BIG:-}" ]; then case "$url" in */get-byodt.sh) head -c 65537 /dev/zero; exit 0 ;; esac; fi
cat "$f"
if [ -n "${STUB_TAMPER:-}" ]; then case "$url" in *.tar.gz) printf 'x' ;; esac; fi
exit 0
SHIM
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
# The engine: a deployment that runs (STUB_RUNNING) from $STUB_WD, a database that answers unless STUB_DB_DOWN, a pull
# that fails with STUB_PULL_FAIL, and health from STUB_HEALTH (default healthy).
[ "$1 $2" = "compose version" ] && exit 0
[ "$1 $2" = "image inspect" ] && exit 1
[ "$1 $2" = "volume inspect" ] && exit 1
if [ "$1" = info ]; then echo Ubuntu; exit 0; fi
# The engine's own cp (this tree's byodt); `compose cp` below is 0.13.0's and 0.12.1's.
if [ "$1" = cp ]; then printf '%s\n' "$*" >> "$CALLS"; case "$2" in db-1:*) : > "$3" ;; esac; exit 0; fi
if [ "$1" = compose ]; then
  # Compose stops on a file named with -f that is not there, before it does anything else. Only compose's own options
  # (--env-file, -f), which come before the command, are read: `logs -f` or `exec … rm -f` name no file.
  i=2
  while [ "$i" -le "$#" ]; do
    j=$((i + 1))
    case "${!i}" in
      --env-file) i=$((i + 2)) ;;
      -f) if [ ! -f "${!j:-}" ]; then echo "docker stand-in: compose -f ${!j:-}: no such file or directory" >&2; exit 1; fi; i=$((i + 2)) ;;
      *) break ;;
    esac
  done
  case " $* " in
    *" config --services "*) printf '%s\n' db console-init platform proxy console; exit 0 ;;
    *" config "*) exit 0 ;;
    *" exec -T db mgconsole "*)
      [ -z "${STUB_DB_DOWN:-}" ] || exit 1
      q="$(cat)"; case "$q" in *"CREATE SNAPSHOT"*) echo '"/var/lib/memgraph/snapshots/snap-1"' ;; esac; exit 0 ;;
    *" exec "*) exit 0 ;;
    *" cp db:"*) printf '%s\n' "$*" >> "$CALLS"; out="${!#}"; : > "$out"; exit 0 ;;
    *" pull"*) printf '%s\n' "$*" >> "$CALLS"; [ -z "${STUB_PULL_FAIL:-}" ] || exit 1; exit 0 ;;
  esac
  printf '%s\n' "$*" >> "$CALLS"; exit 0
fi
if [ "$1" = ps ]; then
  [ -n "${STUB_RUNNING:-}" ] || exit 0
  case "$*" in
    *"service="*) all="$*"; s="${all##*service=}"; echo "${s%% *}-1" ;;
    *) echo platform-1 ;;
  esac
  exit 0
fi
if [ "$1" = inspect ]; then
  id="${!#}"
  case "$3" in
    *working_dir*) echo "${STUB_WD:-}" ;;
    *oneoff*) echo "" ;;
    *.Name*) echo "/dethernety-$id" ;;
    *.Created*) echo "2026-01-01T00:00:00Z" ;;
    *ExitCode*) echo "exited 0" ;;
    *Health*) case "$id" in platform-1) echo "${STUB_HEALTH:-healthy}" ;; proxy-1) echo healthy ;; *) echo running ;; esac ;;
    *) echo "" ;;
  esac
  exit 0
fi
printf '%s\n' "$*" >> "$CALLS"
exit 0
SHIM
chmod +x "$work/bin/curl" "$work/bin/docker"
# byodt's PATH is built explicitly: this test's curl and docker, a wget that fails loudly, no cosign unless a case adds
# one (whether it is installed decides what an upgrade verifies), and links to the tools byodt uses, so nothing real
# beside them in /usr/bin is reached.
mkdir -p "$work/nonet" "$work/tools" "$work/cosign-ok" "$work/cosign-bad"
cp "$HERE/no-network/wget" "$work/nonet/wget"
for t in sh bash env cat sed awk grep tar gzip cut tr sort head tail wc mktemp mkdir chmod chown cp mv rm rmdir find stat \
         id uname dirname basename ls date df du cmp od touch ln readlink perl printf true false test sleep diff xargs \
         sha256sum shasum uniq tee kill git; do
  p="$(command -v "$t" 2>/dev/null || true)"
  case "$p" in /*) ln -s "$p" "$work/tools/$t" ;; esac
done
cat > "$work/cosign-ok/cosign" <<'SHIM'
#!/bin/sh
case " $* " in
  *" --certificate-identity https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v9.9.9 "*)
    case " $* " in *" --certificate-oidc-issuer https://token.actions.githubusercontent.com "*) exit 0 ;; esac ;;
esac
echo "cosign stand-in: unexpected identity or issuer in: $*" >&2; exit 1
SHIM
printf '#!/bin/sh
echo "cosign stand-in: no matching signature" >&2
exit 1
' > "$work/cosign-bad/cosign"
chmod +x "$work/cosign-ok/cosign" "$work/cosign-bad/cosign"
printf 'sigstore bundle\n' > "$REL/v9.9.9/byodt-9.9.9.tar.gz.bundle"
export PATH="$work/bin:$work/nonet:$work/tools" REL
unset DB_ENGINE CONTAINER_ENGINE DB_IMAGE NEO4J_IMAGE PROXY_IMAGE HTTPS_PROXY https_proxy NO_PROXY no_proxy \
  STUB_RUNNING STUB_WD STUB_DB_DOWN STUB_PULL_FAIL STUB_HEALTH STUB_TAMPER STUB_BIG UPGRADE_MARK 2>/dev/null || true

PASSWORD="0123456789abcdef0123456789abcdef0123456789abcdef"
n=0
# deployment: a fresh 9.9.8 deployment in $D, set up and started, its engine running from it.
deployment() {
  n=$((n + 1))
  mkdir -p "$work/d$n" && chmod 0755 "$work/d$n"
  tar -xzf "$REL/v9.9.8/byodt-9.9.8.tar.gz" -C "$work/d$n"
  D="$work/d$n/byodt-9.9.8"
  chmod 0755 "$D"
  ( cd "$D" && ./byodt setup --yes </dev/null >/dev/null 2>&1 )
  printf 'NEO4J_PASSWORD=%s\n' "$PASSWORD" > "$D/.env.secrets"; chmod 0600 "$D/.env.secrets"
  mkdir -p "$D/mode" && printf 'ENABLE_NOAUTH=true\n' > "$D/mode/mode.env"
  export STUB_RUNNING=1 STUB_WD="$D" UPGRADE_MARK="$work/marks$n"
  : > "$UPGRADE_MARK"
}
# run DIR ARGS...: runs byodt ARGS in DIR with no terminal, under a watchdog; output in $work/out. An upgrade gets
# --allow-unsigned (no case but the signature ones has cosign) unless SIGNED_ONLY is set.
run() {
  local d="$1"; shift
  if [ "$1" = upgrade ] && [ -z "${SIGNED_ONLY:-}" ]; then set -- "$@" --allow-unsigned; fi
  : > "$CALLS"; : > "$CALLS.curl"; rc=0
  ( cd "$d" && perl -e 'alarm(120); exec(@ARGV)' ./byodt "$@" ) </dev/null > "$work/out" 2>&1 || rc=$?
}
env_has() { grep -qxF -- "$2" "$1/.env"; }
no_upgrade_left() { [ ! -e "$1/.byodt-upgrade.state" ] && [ ! -e "$1/.byodt-upgrade.lock" ] && ! ls -d "$1"/.byodt-upgrade.?????? >/dev/null 2>&1; }
staged_args() { grep "^byodt-9.9.9 upgrade --staged" "$UPGRADE_MARK"; }
still_998() { env_has "$1" PLATFORM_VERSION=9.9.8 && cmp -s "$1/byodt" "$REL/src/byodt-9.9.8/byodt" && [ ! -e "$1/NEWFILE.md" ]; }
pulled() { grep -q ' pull' "$CALLS"; }
backup_of() { ls -d "$1"/backups/upgrade-9.9.8-to-9.9.9-* 2>/dev/null | sed -n 1p; }

# --- the happy path ---------------------------------------------------------------------------------------------------------
deployment
before_inode="$(inode_of "$D/compose.yaml")"
run "$D" upgrade --yes
check "upgrade --yes moves 9.9.8 to the latest, 9.9.9, and finishes healthy" \
  '[ "$rc" = 0 ] && grep -q "Upgraded from 9.9.8 to 9.9.9" "$work/out" && env_has "$D" PLATFORM_VERSION=9.9.9 && pulled && no_upgrade_left "$D"'
check "the new release's byodt ran the staged phase and the finish" \
  'grep -q "^byodt-9.9.9 upgrade --staged" "$UPGRADE_MARK" && grep -q "^byodt-9.9.9 upgrade --finish" "$UPGRADE_MARK"'
check "the files are the new release's, moved in by rename (a new inode)" \
  'cmp -s "$D/byodt" "$REL/src/byodt-9.9.9/byodt" && cmp -s "$D/NEWFILE.md" "$REL/src/byodt-9.9.9/NEWFILE.md" && [ "$(inode_of "$D/compose.yaml")" != "$before_inode" ]'
check ".env: a new setting added as its template, a new default taken, a setting no longer used commented out" \
  'grep -qx "# NEW_SETTING=on" "$D/.env" && grep -qx "# A setting 9.9.9 adds." "$D/.env" && env_has "$D" PROXY_IMAGE=docker.io/nginx:1.29-alpine \
   && grep -q "^# SNAPSHOT_INTERVAL_SEC=300  # no longer used since 9.9.9$" "$D/.env"'
check "the database image stays where it was without --move-db" \
  'env_has "$D" DB_IMAGE=docker.io/memgraph/memgraph:3.13.2 && grep -q "DB_IMAGE stays as it is unless you choose to move it" "$work/out"'
check "settings that hold the deployment's state are never changed or commented out (DB_DATA, DB_ENGINE)" \
  'env_has "$D" DB_DATA=./data/memgraph && env_has "$D" DB_ENGINE=memgraph'
# A listing is read whole before it is searched: under pipefail, a grep -q that stops at its first match can leave tar
# writing into a closed pipe, which fails the pipeline.
B="$(backup_of "$D")"; listing="$(tar -tzf "$B/bundle-files-9.9.8.tar.gz" 2>/dev/null || true)"
check "the backup: the graph through the old byodt, .env, the shipped files as they were, in a private directory" \
  '[ -n "$B" ] && [ "$(mode_of "$B")" = 700 ] && ls "$B"/byodt-snapshot-9.9.8-* >/dev/null 2>&1 \
   && [ -f "$B/env.before-9.9.9" ] && grep -qx "byodt-9.9.8/byodt" <<< "$listing" \
   && ! grep -q "\.env\.secrets\|\.env$" <<< "$listing"'
check "the snapshot is copied out with the engine's own cp, from the project's db container" \
  'grep -q "^cp db-1:/var/lib/memgraph/snapshots/snap-1 " "$CALLS"'
check "the release record names 9.9.9 and its files, for the next upgrade" \
  'grep -qx "version=9.9.9" "$D/.byodt-release" && grep -q "  NEWFILE.md$" "$D/.byodt-release"'
check "the rollback steps are printed with the real paths, from a cd into the deployment" \
  'grep -qxF "  cd '"'"'$(cd "$D" && pwd -P)'"'"'" "$work/out" \
   && grep -q "tar -xzf backups/upgrade-9.9.8-to-9.9.9-.*/bundle-files-9.9.8.tar.gz --strip-components=1" "$work/out" && grep -q "rm -f NEWFILE.md" "$work/out" \
   && grep -q "byodt restore backups/upgrade-9.9.8-to-9.9.9-" "$work/out"'

# --- refusals before anything changes --------------------------------------------------------------------------------------
run "$D" upgrade --yes
check "the same version is refused" '[ "$rc" != 0 ] && grep -q "Already on 9.9.9" "$work/out"'
run "$D" upgrade 9.9.8 --yes
check "a downgrade is refused" '[ "$rc" != 0 ] && grep -q "a downgrade is a rollback" "$work/out" && env_has "$D" PLATFORM_VERSION=9.9.9'
deployment; run "$D" upgrade
check "no version, no terminal, no --yes: refused before anything is downloaded" \
  '[ "$rc" != 0 ] && grep -q "give the version or add --yes" "$work/out" && [ ! -s "$CALLS.curl" ] && still_998 "$D"'
STUB_BIG=1 run "$D" upgrade 9.9.9 --yes
check "a download larger than its file can be is refused, nothing changed, nothing left" \
  '[ "$rc" != 0 ] && grep -q "larger than a release.s file is" "$work/out" && still_998 "$D" && no_upgrade_left "$D"'
STUB_TAMPER=1 run "$D" upgrade 9.9.9 --yes
check "a bundle that is not the pinned one is refused, nothing changed, nothing left" \
  '[ "$rc" != 0 ] && grep -q "SHA-256 mismatch" "$work/out" && still_998 "$D" && no_upgrade_left "$D"'
printf '# a local edit\n' >> "$D/compose.yaml"; run "$D" upgrade 9.9.9 --yes
check "an edited shipped file is refused before any backup, and named" \
  '[ "$rc" != 0 ] && grep -q "not release 9.9.8.s as shipped: compose.yaml" "$work/out" && [ ! -d "$D/backups" ] && still_998 "$D" && no_upgrade_left "$D"'
run "$D" upgrade 9.9.9 --yes --replace-edited
check "--replace-edited goes on, and the edited file is in the backup" \
  '[ "$rc" = 0 ] && env_has "$D" PLATFORM_VERSION=9.9.9 && grep -q "a local edit" <<< "$(tar -xOzf "$(backup_of "$D")/bundle-files-9.9.8.tar.gz" byodt-9.9.8/compose.yaml)"'
deployment; STUB_DB_DOWN=1 run "$D" upgrade 9.9.9 --yes
check "a database that is not running is refused before anything changes" '[ "$rc" != 0 ] && grep -q "database is not running" "$work/out" && still_998 "$D"'
STUB_DB_DOWN=1 run "$D" upgrade 9.9.9 --yes --skip-graph-backup
check "--skip-graph-backup goes on, and says no graph backup was taken" \
  '[ "$rc" = 0 ] && grep -q "NOT backed up" "$work/out" && grep -q "no graph backup was taken" "$work/out"'
# A compose file missing here (not the layout of a release before 0.13.0) is named where compose's own message is
# hidden: by the database check, which does not point to --skip-graph-backup, and by the notice's reading of
# compose.override.yaml, which does not blame the override.
deployment; mv "$D/compose.memgraph.yaml" "$work/compose.memgraph.aside"
printf 'services:\n  db:\n    mem_limit: 8g\n' > "$D/compose.override.yaml"
run "$D" upgrade 9.9.9 --yes
check "a missing compose.memgraph.yaml stops the upgrade before anything changes, named, with no hint to skip the backup" \
  '[ "$rc" != 0 ] && grep -qx "error: compose.memgraph.yaml is missing here, so the upgrade cannot check the database. Nothing was changed." "$work/out" \
     && ! grep -q -- "--skip-graph-backup" "$work/out" && ! grep -q "database is not running" "$work/out" \
     && ! grep -q "could not read compose.override.yaml" "$work/out" && grep -q "^warning: compose.memgraph.yaml is missing here, so the notice" "$work/out" \
     && [ ! -d "$D/backups" ] && still_998 "$D" && no_upgrade_left "$D"'

deployment; printf 'mine\n' > "$D/NEWFILE.md"; run "$D" upgrade 9.9.9 --yes
check "an operator's own file where the new release ships one counts as edited: refused, named" \
  '[ "$rc" != 0 ] && grep -q "NEWFILE.md" "$work/out" && grep -q "not release 9.9.8" "$work/out" && [ "$(cat "$D/NEWFILE.md")" = mine ]'
run "$D" upgrade 9.9.9 --yes --replace-edited
check "with --replace-edited it is replaced, and kept in the backup" \
  '[ "$rc" = 0 ] && grep -qx mine <<< "$(tar -xOzf "$(backup_of "$D")/bundle-files-9.9.8.tar.gz" byodt-9.9.8/NEWFILE.md)"'
# Follow the printed rollback steps (all but the graph restore and the restart, which need a database): back to 9.9.8,
# with the operator's own NEWFILE.md back too.
grep -E '^  (\./byodt upgrade --abandon|\./byodt down|rm -f|tar -xzf|cp -p)' "$work/out" | sed 's/^  //' > "$work/rollback.sh"
( cd "$D" && PATH="$work/bin:$work/nonet:$work/tools" sh "$work/rollback.sh" ) </dev/null > "$work/rb.out" 2>&1 || true
check "the printed rollback steps bring back 9.9.8's files and .env, and keep the operator's own file" \
  'cmp -s "$D/byodt" "$REL/src/byodt-9.9.8/byodt" && env_has "$D" PLATFORM_VERSION=9.9.8 && [ "$(cat "$D/NEWFILE.md")" = mine ] \
   && grep -qx "version=9.9.8" "$D/.byodt-release"'
deployment; run "$D" upgrade 9.9.11 --yes
check "a bundle that ships a path a deployment owns (data/) is refused, nothing changed" \
  '[ "$rc" != 0 ] && grep -q "belongs to a deployment" "$work/out" && still_998 "$D" && no_upgrade_left "$D"'
deployment; run "$D" upgrade 9.9.9 --yes --move-db --skip-graph-backup
check "--move-db with --skip-graph-backup is refused" '[ "$rc" != 0 ] && grep -q "needs a graph backup" "$work/out" && still_998 "$D"'
deployment; SIGNED_ONLY=1 run "$D" upgrade 9.9.9 --yes
check "an unattended upgrade without cosign is refused, naming cosign and --allow-unsigned" \
  '[ "$rc" != 0 ] && grep -q "Install cosign" "$work/out" && grep -q -- "--allow-unsigned" "$work/out" && still_998 "$D" && no_upgrade_left "$D"'
if [ -n "$PY3" ]; then
  rc=0
  ( cd "$D" && "$PY3" -I "$HERE/tty-driver.py" tty 120 "Use it anyway?" y "Upgrade from 9.9.8 to 9.9.9?" y "Also move the database" n \
      "Add the new setting NEW_SETTING" n "Take the new default for PROXY_IMAGE" y "Comment out SNAPSHOT_INTERVAL_SEC" y \
      -- ./byodt upgrade 9.9.9 ) > "$work/out" 2>&1 || rc=$?
  check "at a terminal: an unverified bundle is asked about, every question comes at once, and a no is kept" \
    '[ "$rc" = 0 ] && env_has "$D" PLATFORM_VERSION=9.9.9 && ! grep -q "NEW_SETTING" "$D/.env" && env_has "$D" PROXY_IMAGE=docker.io/nginx:1.29-alpine'
else
  echo "skip the terminal case: python3 is not installed"
fi

# --- what .env carries ------------------------------------------------------------------------------------------------------
deployment; printf 'CONSOLE_IMAGE=registry.example.internal/byodt-console:9.9.8\n' >> "$D/.env"; run "$D" upgrade 9.9.9 --yes
check "a CONSOLE_IMAGE pinned to the old release is retagged" '[ "$rc" = 0 ] && env_has "$D" CONSOLE_IMAGE=registry.example.internal/byodt-console:9.9.9'
deployment; printf 'CONSOLE_IMAGE=registry.example.internal/byodt-console:1.0.0\n' >> "$D/.env"; run "$D" upgrade 9.9.9 --yes
check "a CONSOLE_IMAGE pinned to another release is refused" '[ "$rc" != 0 ] && grep -q "pinned to" "$work/out" && still_998 "$D"'
deployment; printf 'PROXY_IMAGE=registry.example.internal/nginx:custom\n' >> "$D/.env"; run "$D" upgrade 9.9.9 --yes
check "a default the operator changed is kept" '[ "$rc" = 0 ] && env_has "$D" PROXY_IMAGE=registry.example.internal/nginx:custom'
deployment; run "$D" upgrade 9.9.9 --yes --move-db
check "--move-db moves the database image, after the backup, and the changed database is confirmed in the notice" \
  '[ "$rc" = 0 ] && env_has "$D" DB_IMAGE=docker.io/memgraph/memgraph:3.14.0 && grep -q "THIRD-PARTY SOFTWARE" "$work/out" \
   && tail -n 1 "$D/third-party-acknowledgement.log" | grep -q "db=docker.io/memgraph/memgraph:3.14.0" \
   && grep -q "the newer database wrote it" "$work/out" \
   && grep -q "the database moves to docker.io/memgraph/memgraph:3.14.0 after the graph backup (--move-db; one-way)" "$work/out"'

# --- the phases and the lock ---
deployment; run "$D" upgrade --finish
check "--finish with no upgrade in progress is refused" '[ "$rc" != 0 ] && grep -q "No upgrade is in progress" "$work/out"'
deployment; STUB_PULL_FAIL=1 run "$D" upgrade 9.9.9 --yes
sed -i.bak 's/^phase=.*/phase=backed-up/' "$D/.byodt-upgrade.state" && rm -f "$D/.byodt-upgrade.state.bak"
run "$D" upgrade --finish
check "--finish at a phase before the move is refused, and nothing is removed" \
  '[ "$rc" != 0 ] && grep -q "not ready to finish" "$work/out" && [ -f "$D/.byodt-upgrade.state" ]'
sed -i.bak 's/^phase=.*/phase=env-done/' "$D/.byodt-upgrade.state" && rm -f "$D/.byodt-upgrade.state.bak"
mkdir -p "$D/.byodt-upgrade.lock"; perl -e 'sleep 300' & held=$!; printf '%s\n' "$held" > "$D/.byodt-upgrade.lock/pid"
run "$D" upgrade --yes
check "while another upgrade runs, resuming is refused and its state left alone" \
  '[ "$rc" != 0 ] && grep -q "Another upgrade is running" "$work/out" && grep -qx "phase=env-done" "$D/.byodt-upgrade.state"'
run "$D" upgrade --abandon --yes
check "... and so is --abandon" '[ "$rc" != 0 ] && grep -q "Another upgrade is running" "$work/out" && [ -f "$D/.byodt-upgrade.state" ]'
{ kill "$held"; wait "$held"; } 2>/dev/null || true; held=""
run "$D" upgrade --yes
check "once it is gone, upgrade resumes and finishes" '[ "$rc" = 0 ] && no_upgrade_left "$D" && env_has "$D" PLATFORM_VERSION=9.9.9'
chmod 0644 "$D/.env" 2>/dev/null || true

# --- interruptions ---------------------------------------------------------------------------------------------------------
deployment; STUB_PULL_FAIL=1 run "$D" upgrade 9.9.9 --yes
check "a failed pull stops after the files and .env, says how to go on, and keeps the state" \
  '[ "$rc" != 0 ] && grep -q "to go on" "$work/out" && env_has "$D" PLATFORM_VERSION=9.9.9 && grep -qx "phase=env-done" "$D/.byodt-upgrade.state"'
check "after the staged copy and the re-runs, the commands it names are still the byodt it was run as" \
  'grep -q "run .\./byodt upgrade. to go on" "$work/out" && ! grep -q "\.byodt-upgrade\.[A-Za-z0-9]*/byodt-" "$work/out"'
run "$D" up
check "up is refused while the upgrade is half done" '[ "$rc" != 0 ] && grep -q "half done" "$work/out"'
run "$D" upgrade --yes
check "upgrade again resumes and finishes" '[ "$rc" = 0 ] && grep -q "Upgraded from 9.9.8 to 9.9.9" "$work/out" && no_upgrade_left "$D"'

deployment; STUB_HEALTH=starting run "$D" upgrade 9.9.9 --yes --health-timeout=1
check "a health timeout ends non-zero, says it can check again, and gives the rollback steps" \
  '[ "$rc" != 0 ] && grep -q "checks again" "$work/out" && grep -q "bundle-files-9.9.8.tar.gz" "$work/out" && grep -qx "phase=applied" "$D/.byodt-upgrade.state"'
run "$D" upgrade --yes
check "upgrade again checks the health only, and finishes" '[ "$rc" = 0 ] && ! pulled && grep -q "Upgraded from 9.9.8 to 9.9.9" "$work/out" && no_upgrade_left "$D"'
deployment; STUB_HEALTH=unhealthy run "$D" upgrade 9.9.9 --yes --health-timeout=6
check "an unhealthy report does not end the wait early: it waits to the deadline, then says what it last saw" \
  '[ "$rc" != 0 ] && grep -q "Last seen: platform unhealthy" "$work/out" && grep -q "within 6 seconds" "$work/out"'

# A move that fails partway (a stand-in mv that refuses NEWFILE.md) puts every old file back.
deployment; mkdir -p "$work/badmv"
printf '#!/bin/sh\ncase "$*" in *NEWFILE.md*) exit 1 ;; esac\nexec /bin/mv "$@"\n' > "$work/badmv/mv"; chmod +x "$work/badmv/mv"
PATH="$work/badmv:$PATH" run "$D" upgrade 9.9.9 --yes
check "a move that fails partway puts the old files back" \
  '[ "$rc" != 0 ] && grep -q "the old ones are back" "$work/out" && still_998 "$D"'
run "$D" upgrade 9.9.9 --yes
check "and the next upgrade starts over and finishes" '[ "$rc" = 0 ] && env_has "$D" PLATFORM_VERSION=9.9.9 && no_upgrade_left "$D"'

# A run killed in the middle of the move (a stand-in mv that kills byodt at NEWFILE.md) resumes from where it stopped.
deployment
printf '#!/bin/sh\ncase "$*" in *NEWFILE.md*) kill -9 $PPID; exit 1 ;; esac\nexec /bin/mv "$@"\n' > "$work/badmv/mv"
PATH="$work/badmv:$PATH" run "$D" upgrade 9.9.9 --yes
check "a run killed in the middle of the move leaves the journal at moving, with the new byodt already in place" \
  'grep -qx "phase=moving" "$D/.byodt-upgrade.state" && cmp -s "$D/byodt" "$REL/src/byodt-9.9.9/byodt"'
run "$D" upgrade --yes
check "upgrade again finishes the move and the upgrade" \
  '[ "$rc" = 0 ] && cmp -s "$D/NEWFILE.md" "$REL/src/byodt-9.9.9/NEWFILE.md" && env_has "$D" PLATFORM_VERSION=9.9.9 && no_upgrade_left "$D"'

# The same, killed at a file the move replaces (compose.yaml), not one it adds.
deployment
# The window that matters most: the old compose.yaml is already in old/, the new one not yet in place.
printf '#!/bin/sh\ncase "$*" in *byodt-9.9.9/compose.yaml*) kill -9 $PPID; exit 1 ;; esac\nexec /bin/mv "$@"\n' > "$work/badmv/mv"
PATH="$work/badmv:$PATH" run "$D" upgrade 9.9.9 --yes
run "$D" upgrade
check "killed at a replaced file, a resume without a terminal or --yes is refused, pointing to --yes and --abandon" \
  '[ "$rc" != 0 ] && grep -q -- "--abandon" "$work/out" && grep -qx "phase=moving" "$D/.byodt-upgrade.state"'
run "$D" upgrade --yes
check "with --yes it finishes the move and the upgrade" \
  '[ "$rc" = 0 ] && cmp -s "$D/compose.yaml" "$REL/src/byodt-9.9.9/compose.yaml" && env_has "$D" PLATFORM_VERSION=9.9.9 && no_upgrade_left "$D"'

# --abandon in the middle of the move uses the same stand-in mv, which kills byodt at compose.yaml.
deployment
PATH="$work/badmv:$PATH" run "$D" upgrade 9.9.9 --yes
run "$D" upgrade --abandon
check "--abandon in the middle of the move puts the old files back and drops the upgrade" \
  '[ "$rc" = 0 ] && still_998 "$D" && no_upgrade_left "$D"'

deployment; STUB_PULL_FAIL=1 run "$D" upgrade 9.9.9 --yes; run "$D" upgrade --abandon
check "--abandon after the move, with no terminal and no --yes, prints the rollback steps and keeps the state" \
  '[ "$rc" != 0 ] && grep -q "bundle-files-9.9.8.tar.gz" "$work/out" && [ -f "$D/.byodt-upgrade.state" ]'
run "$D" upgrade --abandon --yes
check "--abandon --yes drops it" '[ "$rc" = 0 ] && no_upgrade_left "$D"'

# A start-over keeps the interrupted run's flags. The state is written as a run that stopped once staged leaves it;
# the resume itself is given no flags.
deployment
printf '%s\n' phase=staged from=9.9.8 to=9.9.9 "stage=$D/.byodt-upgrade.zzzzzz" "new=$D/.byodt-upgrade.zzzzzz/byodt-9.9.9" \
  health_timeout=4 "flags=--yes --move-db --allow-unsigned --health-timeout=4 " > "$D/.byodt-upgrade.state"
chmod 0600 "$D/.byodt-upgrade.state"
STUB_HEALTH=starting SIGNED_ONLY=1 run "$D" upgrade
check "a start-over uses the flags the interrupted run was given (--move-db, --health-timeout), none given again" \
  '[ "$rc" != 0 ] && grep -q "starting over" "$work/out" && env_has "$D" DB_IMAGE=docker.io/memgraph/memgraph:3.14.0 \
     && grep -q "within 4 seconds" "$work/out" && grep -qx "phase=applied" "$D/.byodt-upgrade.state"'

# A state file byodt does not trust stops up, update and restart, whatever phase it names.
deployment; printf 'phase=moving\nto=9.9.9\n' > "$D/.byodt-upgrade.state"; chmod 0644 "$D/.byodt-upgrade.state"
run "$D" up
check "a state file readable by others stops up instead of a warning" \
  '[ "$rc" != 0 ] && grep -q "is not this deployment.s own" "$work/out" && ! grep -q "pending" "$work/out"'
deployment; mkdir "$D/.byodt-upgrade.state"; run "$D" up
check "so does a directory where the state file belongs" '[ "$rc" != 0 ] && grep -q "is not this deployment.s own" "$work/out"'
deployment; mkdir "$D/.byodt-upgrade.state"; run "$D" upgrade 9.9.9 --yes
check "and a directory there stops an upgrade before anything is downloaded" \
  '[ "$rc" != 0 ] && grep -q "is not this deployment.s own" "$work/out" && [ ! -s "$CALLS.curl" ] && still_998 "$D"'

# A file the first run recorded that no release ships (here notes.txt, edited since) is left alone: no reason to stop.
deployment; printf 'mine\n' > "$D/notes.txt"; printf '%s  notes.txt\n' "$(sha_of "$D/notes.txt")" >> "$D/.byodt-release"
printf 'edited\n' > "$D/notes.txt"
run "$D" upgrade 9.9.9 --yes
check "an edited file the new release does not ship does not count as edited, and stays as it is" \
  '[ "$rc" = 0 ] && env_has "$D" PLATFORM_VERSION=9.9.9 && grep -qx edited "$D/notes.txt" && grep -q "no longer ships.*notes.txt" "$work/out"'
n=$((n + 1)); mkdir -p "$work/d$n" && tar -xzf "$REL/v9.9.8/byodt-9.9.8.tar.gz" -C "$work/d$n"
printf 'finder\n' > "$work/d$n/byodt-9.9.8/.DS_Store"; ( cd "$work/d$n/byodt-9.9.8" && ./byodt setup --yes </dev/null >/dev/null 2>&1 )
check "the first run's record of shipped files leaves out .DS_Store" \
  'grep -q "  byodt$" "$work/d$n/byodt-9.9.8/.byodt-release" && ! grep -q "DS_Store" "$work/d$n/byodt-9.9.8/.byodt-release"'

deployment; mkdir "$D/.byodt-upgrade.lock"; perl -e 'sleep 300' & held=$!; printf '%s\n' "$held" > "$D/.byodt-upgrade.lock/pid"
run "$D" upgrade 9.9.9 --yes
{ kill "$held"; wait "$held"; } 2>/dev/null || true; held=""
check "another running upgrade's lock is respected" '[ "$rc" != 0 ] && grep -q "Another upgrade is running" "$work/out" && still_998 "$D"'
printf '999999\n' > "$D/.byodt-upgrade.lock/pid"
run "$D" upgrade 9.9.9 --yes
check "a lock left by a process that is gone does not block a new upgrade" '[ "$rc" = 0 ] && env_has "$D" PLATFORM_VERSION=9.9.9'
# The takeover, run on byodt's own functions in a scratch folder: lock() runs upgrade_lock there, output in $work/out.
sed '/^# --- dispatch/,$d' "$SRC/byodt" > "$work/lockfns"; L="$work/lockrace/.byodt-upgrade.lock"; mkdir -p "$work/lockrace"
lock() { rc=0; bash -c 'cd "$1" && . "$2" && eval "$3" && upgrade_lock' _ "$work/lockrace" "$work/lockfns" "${1:-:}" > "$work/out" 2>&1 || rc=$?; }
mkdir -p "$L"; printf '999999\n' > "$L/pid"; mkdir "$L.takeover"; lock
check "a stale lock another process is taking over (its takeover lock is there) is refused and left alone" \
  '[ "$rc" != 0 ] && grep -q "Another upgrade is running" "$work/out" && grep -qx 999999 "$L/pid" && [ -d "$L.takeover" ]'
rmdir "$L.takeover"
# The race: the lock looked stale, but by the time this process holds the takeover lock another has taken it over
# (upgrade_lock_held answers "gone" once, then truly). Checked again under the takeover lock: refused, the lock kept.
perl -e 'sleep 300' & held=$!; printf '%s\n' "$held" > "$L/pid"
lock 'eval "orig_$(declare -f upgrade_lock_held)"; n=0; upgrade_lock_held() { n=$((n + 1)); [ "$n" -gt 1 ] && orig_upgrade_lock_held; }'
check "a takeover that finds the lock taken meanwhile refuses, leaves that lock as it is, and drops its takeover lock" \
  '[ "$rc" != 0 ] && grep -q "Another upgrade is running" "$work/out" && grep -qx "$held" "$L/pid" \
     && [ ! -e "$L.takeover" ]'
{ kill "$held"; wait "$held"; } 2>/dev/null || true; held=""
: > "$L/pid"; lock
check "a lock with no pid yet is one being taken: refused, not taken over" '[ "$rc" != 0 ] && [ -d "$L" ] && [ ! -s "$L/pid" ]'
# Released while this process looked: upgrade_lock_held removes the lock (its owner unlocking) and answers "gone".
# Under the takeover lock there is no stale lock to take over, so the plain mkdir is tried again and wins.
perl -e 'sleep 300' & held=$!; printf '%s\n' "$held" > "$L/pid"
lock 'upgrade_lock_held() { rm -rf .byodt-upgrade.lock; return 1; }'
check "a lock released during a takeover is taken by a plain mkdir, with no takeover lock left" \
  '[ "$rc" = 0 ] && grep -qx "[0-9][0-9]*" "$L/pid" && ! grep -qx "$held" "$L/pid" && [ ! -e "$L.takeover" ]'
# Released, then taken at once by a third process before this one held the takeover lock: that lock is not stale, so
# it is left to its owner and this process refuses.
printf '%s\n' "$held" > "$L/pid"
stub='upgrade_lock_held() { rm -rf .byodt-upgrade.lock; mkdir .byodt-upgrade.lock; echo HELD > .byodt-upgrade.lock/pid; return 1; }'
lock "${stub/HELD/$held}"
check "a lock released and taken by another process during a takeover is left to it: refused" \
  '[ "$rc" != 0 ] && grep -q "Another upgrade is running" "$work/out" && grep -qx "$held" "$L/pid" \
     && [ ! -e "$L.takeover" ]'
{ kill "$held"; wait "$held"; } 2>/dev/null || true; held=""
printf '999999\n' > "$L/pid"; lock
check "a lock whose process is gone is taken over by mkdir, with no takeover lock left" \
  '[ "$rc" = 0 ] && ! grep -qx 999999 "$L/pid" && grep -qx "[0-9][0-9]*" "$L/pid" && [ ! -e "$L.takeover" ]'

# --- from a real 0.13.0, through the release's installer ----------------------------------------------------------------
# 0.13.0's byodt has no upgrade of its own: the installer stages the new release, whose byodt checks the files against
# the 0.13.0 manifest it carries and backs up with 0.13.0's own `byodt backup`. Built from the v0.13.0 tag when this
# checkout has it.
if TAGTREE="$(git -C "$SRC" rev-parse -q --verify 'v0.13.0^{tree}' 2>/dev/null)" && [ -n "$TAGTREE" ]; then
  n=$((n + 1)); mkdir -p "$work/d$n/byodt-0.13.0"; D="$work/d$n/byodt-0.13.0"; chmod 0755 "$work/d$n" "$D"
  top="$(git -C "$SRC" rev-parse --show-toplevel)"; pre=""
  git -C "$top" cat-file -e "v0.13.0:oss/deploy/compose/byodt" 2>/dev/null && pre="oss/"
  # Nothing from the tag is unpacked or run unless it is release 0.13.0's files as shipped, by the manifest byodt pins:
  # in CI the tag is fetched from the public repository. Its folder must list exactly the manifest's paths, all regular
  # files (no link, no submodule), before anything is unpacked; then each file must have the manifest's hash.
  sed '/^# --- dispatch/,$d' "$SRC/byodt" > "$work/fns013"
  bash -c '. "$1"; known_manifest 0.13.0' _ "$work/fns013" > "$work/manifest013"
  tag_ok=1; grep -q '  byodt$' "$work/manifest013" || tag_ok=""
  awk '{ print $2 }' "$work/manifest013" | LC_ALL=C sort > "$work/manifest013.paths"
  git -C "$top" ls-tree -r --full-tree "$TAGTREE:${pre}deploy/compose" > "$work/tag013.tree" || tag_ok=""
  awk -F'\t' '{ print $2 }' "$work/tag013.tree" | LC_ALL=C sort | cmp -s - "$work/manifest013.paths" || tag_ok=""
  awk '$2 != "blob" || ($1 != "100644" && $1 != "100755") { bad = 1 } END { exit bad }' "$work/tag013.tree" || tag_ok=""
  if [ -n "$tag_ok" ]; then
    git -C "$top" archive "$TAGTREE:${pre}deploy/compose" | tar -x -C "$D" || tag_ok=""
    while read -r sum path; do [ "$(sha_of "$D/$path")" = "$sum" ] || tag_ok=""; done < "$work/manifest013"
  fi
fi
if [ -n "${TAGTREE:-}" ] && [ -z "${tag_ok:-}" ]; then
  bad "the v0.13.0 tag's files are not release 0.13.0's as shipped: nothing from it was run"
elif [ -n "${TAGTREE:-}" ]; then
  cp "$D/.env.example" "$D/.env"; printf 'CONTAINER_ENGINE=docker\nDB_ENGINE=memgraph\n' >> "$D/.env"
  printf 'NEO4J_PASSWORD=%s\n' "$PASSWORD" > "$D/.env.secrets"; chmod 0600 "$D/.env.secrets"
  mkdir -p "$D/mode" && printf 'ENABLE_NOAUTH=true\n' > "$D/mode/mode.env"
  export STUB_RUNNING=1 STUB_WD="$D" UPGRADE_MARK="$work/marks$n"; : > "$UPGRADE_MARK"
  : > "$CALLS.curl"; rc=0
  ( cd "$work/d$n" && perl -e 'alarm(120); exec(@ARGV)' sh "$REL/v9.9.9/get-byodt.sh" --upgrade --yes --allow-unsigned --dir "$D" ) </dev/null > "$work/out" 2>&1 || rc=$?
  check "0.13.0 to 9.9.9 through the installer: checked against 0.13.0's manifest, backed up by 0.13.0's byodt, upgraded" \
    '[ "$rc" = 0 ] && ! grep -q "edited here" "$work/out" && ! grep -q "cannot tell whether" "$work/out" \
     && ls "$(ls -d "$D"/backups/upgrade-0.13.0-to-9.9.9-*)"/byodt-snapshot-0.13.0-* >/dev/null 2>&1 \
     && env_has "$D" PLATFORM_VERSION=9.9.9 && grep -q "^byodt-9.9.9 upgrade --staged" "$UPGRADE_MARK" && no_upgrade_left "$D"'
  check "through the installer, the commands it prints name the deployment's byodt, never the staged copy it ran from" \
    'grep -qxF "  cd '"'"'$(cd "$D" && pwd -P)'"'"'" "$work/out" && ! grep -q "\.byodt-upgrade\.[A-Za-z0-9]*/byodt-" "$work/out"'
else
  no_tag 0.13.0
fi

# --- from a real 0.12.1, through the release's installer ----------------------------------------------------------------
# 0.12.1's compose.yaml holds the database service itself: compose.memgraph.yaml arrives with the move. Its byodt has no
# upgrade of its own (its `upgrade` is `update`) and wrote no record of its files, and byodt carries no manifest for it.
# The new release's byodt says it cannot tell whether the files were edited, checks the database through compose.yaml
# alone (the stand-in docker refuses a missing -f file, as compose does), backs up with 0.12.1's own `byodt backup`,
# which copies the snapshot out with `compose cp`, and moves the files in. Built from the v0.12.1 tag when this checkout
# has it. Nothing from the tag is unpacked or run unless its folder is the tree pinned here: the tree's hash covers every
# file's content and mode.
readonly TREE_0121=789cb28f00d99312bda68f9dec879824a71c00db
tree0121=""
if git -C "$SRC" rev-parse -q --verify 'v0.12.1^{commit}' >/dev/null 2>&1; then
  top="$(git -C "$SRC" rev-parse --show-toplevel)"; pre=""
  git -C "$top" cat-file -e "v0.12.1:oss/deploy/compose/byodt" 2>/dev/null && pre="oss/"
  tree0121="$(git -C "$top" rev-parse -q --verify "v0.12.1:${pre}deploy/compose" 2>/dev/null || echo none)"
fi
# deployment_0121: a 0.12.1 deployment in $D, as its first run left it (CONTAINER_ENGINE recorded, no DB_ENGINE, no
# record of its files), its engine running from it.
deployment_0121() {
  n=$((n + 1)); D="$work/d$n/byodt-0.12.1"
  mkdir -p "$D" && chmod 0755 "$work/d$n" "$D"
  tar -xf "$work/v0.12.1.tar" -C "$D"
  cp "$D/.env.example" "$D/.env"; printf 'CONTAINER_ENGINE=docker\n' >> "$D/.env"
  printf 'NEO4J_PASSWORD=%s\n' "$PASSWORD" > "$D/.env.secrets"; chmod 0600 "$D/.env.secrets"
  mkdir -p "$D/mode" && printf 'ENABLE_NOAUTH=true\n' > "$D/mode/mode.env"
  export STUB_RUNNING=1 STUB_WD="$D" UPGRADE_MARK="$work/marks$n"; : > "$UPGRADE_MARK"
}
# backup_0121 prints the upgrade's backup directory in $D; nothing when there is none.
backup_0121() { { ls -d "$D"/backups/upgrade-0.12.1-to-9.9.9-* 2>/dev/null || true; } | sed -n 1p; }
# install_upgrade: runs the 9.9.9 installer's unattended upgrade of $D; output in $work/out.
install_upgrade() {
  : > "$CALLS"; : > "$CALLS.curl"; rc=0
  ( cd "$work/d$n" && perl -e 'alarm(120); exec(@ARGV)' sh "$REL/v9.9.9/get-byodt.sh" --upgrade --yes --allow-unsigned --dir "$D" ) \
    </dev/null > "$work/out" 2>&1 || rc=$?
}
if [ -z "$tree0121" ]; then
  no_tag 0.12.1
elif [ "$tree0121" != "$TREE_0121" ]; then
  bad "the v0.12.1 tag's files are not release 0.12.1's as shipped (tree $tree0121, not $TREE_0121): nothing from it was run"
else
  git -C "$top" archive --format=tar "$tree0121" > "$work/v0.12.1.tar"
  deployment_0121
  [ ! -e "$D/compose.memgraph.yaml" ] && [ ! -e "$D/.byodt-release" ] || bad "the 0.12.1 deployment is not laid out as 0.12.1 shipped it"
  install_upgrade
  check "0.12.1 to 9.9.9 through the installer: upgraded, the new release's byodt staged, the files moved in" \
    '[ "$rc" = 0 ] && grep -q "Upgraded from 0.12.1 to 9.9.9" "$work/out" && env_has "$D" PLATFORM_VERSION=9.9.9 \
     && grep -q "^byodt-9.9.9 upgrade --staged" "$UPGRADE_MARK" && cmp -s "$D/byodt" "$REL/src/byodt-9.9.9/byodt" && no_upgrade_left "$D"'
  check "... with no record of 0.12.1's files, it says it cannot tell whether they were edited" \
    'grep -qxF "warning: byodt cannot tell whether release 0.12.1'"'"'s files were edited here (no record of them); any edits are kept in the backup." "$work/out"'
  # 0.12.1's backup names no file and copies with `compose cp`; this tree's names them and copies with the engine's cp.
  B="$(backup_0121)"
  listing="$(tar -tzf "$B/bundle-files-0.12.1.tar.gz" 2>/dev/null || true)"
  check "... the graph backed up by 0.12.1's own byodt into the backup, with the old files beside it" \
    '[ -n "$B" ] && ls "$B"/byodt-snapshot-0.12.1-*.snapshot >/dev/null 2>&1 \
     && grep -Eq "^compose --env-file \.env cp db:/var/lib/memgraph/snapshots/snap-1 ${B#"$D"/}/byodt-snapshot-0\.12\.1-[0-9-]+\.snapshot$" "$CALLS" \
     && ! grep -q "^cp db-1:" "$CALLS" && grep -qx "byodt-0.12.1/compose.yaml" <<< "$listing"'
  check "... compose.memgraph.yaml in place, DB_ENGINE recorded, and the start names the engine file" \
    'cmp -s "$D/compose.memgraph.yaml" "$REL/src/byodt-9.9.9/compose.memgraph.yaml" && cmp -s "$D/compose.yaml" "$REL/src/byodt-9.9.9/compose.yaml" \
     && env_has "$D" DB_ENGINE=memgraph && grep -q -- "-f compose.yaml -f compose.memgraph.yaml pull" "$CALLS"'
  # The printed rollback steps (all but the update and the restart) bring back 0.12.1's layout, and 0.12.1's byodt runs
  # there: compose finds compose.yaml itself, and the graph restore (confirmed on its input) loads the backup.
  { grep -E '^  (\./byodt upgrade --abandon|\./byodt down|rm -f|tar -xzf|cp -p|\./byodt restore)' "$work/out" || true; } | sed 's/^  //' > "$work/rollback.sh"
  ( cd "$D" && printf 'restore\n' | PATH="$work/bin:$work/nonet:$work/tools" sh "$work/rollback.sh" ) > "$work/rb.out" 2>&1 || true
  restored=""; grep -q "Restore complete" "$work/rb.out" && restored=1
  run "$D" status
  check "the printed rollback steps bring back 0.12.1's files, its layout and .env, and 0.12.1's byodt restores the graph" \
    'git -C "$top" show "$tree0121:byodt" | cmp -s - "$D/byodt" && git -C "$top" show "$tree0121:compose.yaml" | cmp -s - "$D/compose.yaml" \
     && [ ! -e "$D/compose.memgraph.yaml" ] && [ ! -e "$D/.byodt-release" ] && env_has "$D" PLATFORM_VERSION=0.12.1 \
     && ! grep -q "^DB_ENGINE=" "$D/.env" && [ -n "$restored" ] && [ "$rc" = 0 ] && grep -qx "compose --env-file .env ps" "$CALLS"'

  # With a compose.override.yaml as 0.12.1 read it (compose found it beside compose.yaml), byodt reads it through
  # compose.yaml alone, so the notice has no false warning; after the move it is named last.
  deployment_0121
  printf '# Local changes, kept across upgrades.\nservices:\n  db:\n    mem_limit: 8g\n' > "$D/compose.override.yaml"
  cp "$D/compose.override.yaml" "$work/override.0121"
  install_upgrade
  check "0.12.1 with a compose.override.yaml: upgraded, the override read without a warning and kept, and named last" \
    '[ "$rc" = 0 ] && grep -q "Upgraded from 0.12.1 to 9.9.9" "$work/out" && ! grep -q "could not read compose.override.yaml" "$work/out" \
     && cmp -s "$D/compose.override.yaml" "$work/override.0121" && ls "$(backup_0121)"/byodt-snapshot-0.12.1-*.snapshot >/dev/null 2>&1 \
     && grep -q -- "-f compose.yaml -f compose.memgraph.yaml -f compose.override.yaml pull" "$CALLS" && no_upgrade_left "$D"'
fi

# --- from a release with no record of its files -----------------------------------------------------------------------
# A release older than 0.13.0 (0.12.x) wrote no record on its first run, and byodt carries no manifest for it. A 9.9.8
# deployment without its record stands in: byodt says it cannot tell, replaces what it ships, and keeps every edit in
# the backup.
deployment; rm -f "$D/.byodt-release"; printf '# a local edit\n' >> "$D/compose.yaml"; run "$D" upgrade 9.9.9 --yes
check "with no record of the old release's files, byodt says it cannot tell whether they were edited" \
  'grep -qxF "warning: byodt cannot tell whether release 9.9.8'"'"'s files were edited here (no record of them); any edits are kept in the backup." "$work/out"'
check "... replaces an edited shipped file without --replace-edited, keeps the edit in the backup, and upgrades" \
  '[ "$rc" = 0 ] && cmp -s "$D/compose.yaml" "$REL/src/byodt-9.9.9/compose.yaml" \
     && grep -q "a local edit" <<< "$(tar -xOzf "$(backup_of "$D")/bundle-files-9.9.8.tar.gz" byodt-9.9.8/compose.yaml)" \
     && grep -q "Upgraded from 9.9.8 to 9.9.9" "$work/out" && env_has "$D" PLATFORM_VERSION=9.9.9 && no_upgrade_left "$D"'

# --- the signature, with cosign installed ----------------------------------------------------------------------------------
deployment; SIGNED_ONLY=1 PATH="$work/cosign-ok:$PATH" run "$D" upgrade 9.9.9 --yes
check "with cosign, the new release's signature is verified against its exact identity" \
  '[ "$rc" = 0 ] && grep -q "Signature verified" "$work/out" && env_has "$D" PLATFORM_VERSION=9.9.9'
deployment; SIGNED_ONLY=1 PATH="$work/cosign-bad:$PATH" run "$D" upgrade 9.9.9 --yes
check "a signature cosign refuses stops the upgrade, nothing changed" \
  '[ "$rc" != 0 ] && grep -q "could not verify" "$work/out" && still_998 "$D" && no_upgrade_left "$D"'
deployment; SIGNED_ONLY=1 run "$D" upgrade 9.9.9 --yes --require-signature
check "--require-signature without cosign refuses" '[ "$rc" != 0 ] && grep -q "cosign is not installed" "$work/out" && still_998 "$D"'
deployment; printf 'UPGRADE_REQUIRE_SIGNATURE=true\n' >> "$D/.env"; SIGNED_ONLY=1 run "$D" upgrade 9.9.9 --yes
check "UPGRADE_REQUIRE_SIGNATURE=true in .env refuses the same way" '[ "$rc" != 0 ] && grep -q "cosign is not installed" "$work/out" && still_998 "$D"'
deployment; printf 'UPGRADE_REQUIRE_SIGNATURE=true\n' >> "$D/.env"
SIGNED_ONLY=1 PATH="$work/cosign-ok:$PATH" run "$D" upgrade 9.9.9 --yes --allow-unsigned
check "UPGRADE_REQUIRE_SIGNATURE=true in .env refuses --allow-unsigned up front, as the installer does, downloading nothing" \
  '[ "$rc" != 0 ] && grep -q "^error: .env sets UPGRADE_REQUIRE_SIGNATURE=true, so --allow-unsigned does not apply. Nothing was changed." "$work/out" \
     && ! grep -q contradict "$work/out" && [ ! -s "$CALLS.curl" ] && still_998 "$D" && no_upgrade_left "$D"'
deployment; printf 'UPGRADE_REQUIRE_SIGNATURE=true\n' >> "$D/.env"; SIGNED_ONLY=1 PATH="$work/cosign-ok:$PATH" run "$D" upgrade 9.9.9 --yes
check "UPGRADE_REQUIRE_SIGNATURE=true in .env without --allow-unsigned verifies and upgrades, carrying no signature flag" \
  '[ "$rc" = 0 ] && grep -q "Signature verified" "$work/out" && env_has "$D" PLATFORM_VERSION=9.9.9 && no_upgrade_left "$D" \
     && staged_args >/dev/null && ! staged_args | grep -q -- "--require-signature\|--allow-unsigned"'
deployment; SIGNED_ONLY=1 run "$D" upgrade 9.9.9 --yes --allow-unsigned
check "with no requirement in .env, --allow-unsigned still upgrades without cosign, and is carried alone" \
  '[ "$rc" = 0 ] && grep -q -- "--allow-unsigned: cosign is not installed" "$work/out" && env_has "$D" PLATFORM_VERSION=9.9.9 \
     && staged_args | grep -q -- "--allow-unsigned" && ! staged_args | grep -q -- "--require-signature"'
deployment; SIGNED_ONLY=1 PATH="$work/cosign-ok:$PATH" run "$D" upgrade 9.9.9 --yes --require-signature
check "a given --require-signature is carried into the staged phase" \
  '[ "$rc" = 0 ] && env_has "$D" PLATFORM_VERSION=9.9.9 && staged_args | grep -q -- "--require-signature" && ! staged_args | grep -q -- "--allow-unsigned"'
deployment; printf 'UPGRADE_REQUIRE_SIGNATURE=yes\n' >> "$D/.env"; run "$D" upgrade 9.9.9 --yes
check "UPGRADE_REQUIRE_SIGNATURE=yes is neither true nor false: refused before any download, not read as off" \
  '[ "$rc" != 0 ] && grep -q "UPGRADE_REQUIRE_SIGNATURE=yes, which is neither true nor false" "$work/out" && [ ! -s "$CALLS.curl" ] && still_998 "$D"'
deployment; printf 'UPGRADE_REQUIRE_SIGNATURE=FALSE\n' >> "$D/.env"; run "$D" upgrade 9.9.9 --yes
check "UPGRADE_REQUIRE_SIGNATURE=FALSE is off: --allow-unsigned upgrades" '[ "$rc" = 0 ] && env_has "$D" PLATFORM_VERSION=9.9.9'
deployment; printf 'UPGRADE_REQUIRE_SIGNATURE=\n' >> "$D/.env"; run "$D" upgrade 9.9.9 --yes
check "an empty UPGRADE_REQUIRE_SIGNATURE is unset: --allow-unsigned upgrades" '[ "$rc" = 0 ] && env_has "$D" PLATFORM_VERSION=9.9.9'
if [ "$(id -u)" != 0 ]; then
  deployment; chmod 000 "$D/.env"; run "$D" upgrade 9.9.9 --yes --allow-unsigned; chmod 600 "$D/.env"
  check "a .env byodt cannot read stops the upgrade, since it could require a signature" \
    '[ "$rc" != 0 ] && grep -q "cannot read .*may require a signature" "$work/out" && still_998 "$D" && no_upgrade_left "$D"'
fi

# --- the version comparator ---------------------------------------------------------------------------------------------
sed '/^# --- dispatch/,$d' "$SRC/byodt" > "$work/fns"
cmp_ok=1
while read -r a b want; do
  got="$(bash -c '. "$1"; version_cmp "$2" "$3"' _ "$work/fns" "$a" "$b")"
  [ "$got" = "$want" ] || { bad "version_cmp $a $b: $got, not $want"; cmp_ok=0; }
done <<'CASES'
1.0.0 1.0.0 0
1.0.0 1.0.1 -1
1.10.0 1.9.0 1
1.0.0-rc.1 1.0.0 -1
1.0.0 1.0.0-rc.1 1
1.0.0-rc.2 1.0.0-rc.10 -1
1.0.0-rc.10 1.0.0-rc.2 1
1.0.0-alpha 1.0.0-alpha.1 -1
1.0.0-alpha.beta 1.0.0-beta -1
1.0.0-beta.2 1.0.0-beta.11 -1
1.0.0-rc.1 1.0.0-beta.1 1
1.0.0-1 1.0.0-alpha -1
CASES
[ "$cmp_ok" = 0 ] || ok "version_cmp follows semver precedence (rc.10 after rc.2, a release after its pre-releases)"

if [ "$fail" = 0 ]; then echo "PASS byodt-upgrade"; else echo "FAILED byodt-upgrade"; exit 1; fi
