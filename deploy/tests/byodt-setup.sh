#!/usr/bin/env bash
# Pins `byodt setup`, the first run, and the third-party notice, by running the wrapper in scratch bundles with a
# stand-in `docker` on PATH; no container engine runs.
#
#   - flags: every answer has one; bad values, unknown options, an existing .env or .env.secrets are refused, and
#     nothing is written;
#   - no terminal: without --yes setup refuses at once and waits for nothing; --yes takes the defaults, asks nothing
#     even at a terminal, and counts as the notice's confirmation;
#   - at a terminal: the questions, the notice's explicit y, a no that writes nothing, a refused proxy asked again;
#   - .env: each answer replaces its own line of .env.example, as a hand edit would;
#   - the notice: always printed, filled with the images and model the deployment runs (compose.override.yaml's read
#     through `compose config`); [mirror] for another repository; the record's line and its refusals; asked again on
#     a new text, a changed text, a database image or model change, never for the front door alone; the installer's
#     hand-over only with a matching hash;
#   - the proxy: the proxy checks refuse a bad value and setup removes what it wrote; the login comes from the
#     installer's variable only with --proxy-login-from-env, is never printed, reaches no child process, and cannot
#     plant a second line; the CA, given as a flag or typed;
#   - storage on a VM-backed engine; --start, and its compose-project check before anything is written; a database
#     volume an earlier deployment left is refused when this one would mount it, and only named when it would not;
#   - the commands it suggests name byodt by the path it was run by;
#   - up, update, restart and models pull: a deployment that has not run confirms the notice before anything is
#     written; one that has, with nobody to ask, only shows it and warns.
#
#   bash deploy/tests/byodt-setup.sh
set -euo pipefail

# No test may reach the network: stand-ins for curl, wget and cosign that fail loudly come before the system's.
export PATH="$(cd "$(dirname "$0")" && pwd)/no-network:$PATH"

if ! command -v python3 >/dev/null 2>&1; then echo "SKIP byodt-setup: python3 drives the terminal and is not installed"; exit 0; fi

SRC="$(cd "$(dirname "$0")/../compose" && pwd)"
DRIVER="$(cd "$(dirname "$0")" && pwd)/tty-driver.py"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
CALLS="$work/calls"
# The stand-in engine: `info` answers STUB_OS; `config --services` lists the bundle's services; a plain `config`
# prints STUB_CONFIG (the normalised configuration compose would print) or fails when STUB_CONFIG_FAIL is set;
# STUB_IDS and STUB_WD_<id> are the project's containers and the directories they came from; STUB_VOLUMES the volumes
# that exist. Every other call is recorded, and every call's environment is kept, to show what reaches a child.
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
env >> "$CALLS.env"
[ "$1 $2" = "compose version" ] && exit 0
[ "$1 $2" = "image inspect" ] && exit 1
if [ "$1" = info ]; then printf '%s\n' "${STUB_OS:-Ubuntu 24.04 LTS}"; exit 0; fi
if [ "$1" = compose ] && [[ " $* " == *" config --services "* ]]; then printf '%s\n' db console-init platform proxy console; exit 0; fi
if [ "$1" = compose ] && [[ " $* " == *" config " ]]; then
  [ -z "${STUB_CONFIG_FAIL:-}" ] || exit 1
  # As compose does, refuse a project whose env_file (mode/mode.env, beside the first file) is missing.
  first=""; prev=""; for a in "$@"; do [ "$prev" = -f ] && [ -z "$first" ] && first="$a"; prev="$a"; done
  [ -f "$(dirname "$first")/mode/mode.env" ] || exit 1
  if [[ " $* " == *"compose.override.yaml "* ]]; then printf '%s\n' "${STUB_CONFIG:-}"; else printf '%s\n' "${STUB_CONFIG_BASE:-}"; fi
  exit 0
fi
if [ "$1" = ps ] && [ "$2" = -aq ]; then
  case "$*" in *"project=dethernety --filter"*) exit 0 ;; esac
  for id in ${STUB_IDS:-}; do printf '%s\n' "$id"; done; exit 0
fi
if [ "$1" = inspect ]; then id="${!#}"; var="STUB_WD_$id"; printf '%s\n' "${!var:-<no value>}"; exit 0; fi
if [ "$1 $2" = "volume inspect" ]; then for v in ${STUB_VOLUMES:-}; do [ "$v" = "$3" ] && exit 0; done; exit 1; fi
printf '%s\n' "$*" >> "$CALLS"
exit 0
SHIM
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS
unset DB_ENGINE CONTAINER_ENGINE NEO4J_IMAGE DB_IMAGE PROXY_IMAGE NEO4J_USERNAME HTTPS_PROXY https_proxy NO_PROXY no_proxy \
  STUB_IDS STUB_VOLUMES STUB_OS STUB_CONFIG STUB_CONFIG_FAIL BYODT_SETUP_PROXY_USERINFO 2>/dev/null || true

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; sed 's/^/     | /' "$work/out" | tail -15; fi; }
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

MODEL="onnx-community/embeddinggemma-300m-ONNX@5090578d9565bb06545b4552f76e6bc2c93e4a66"
# What compose config prints for the bundle's own files: the images .env.example names.
export STUB_CONFIG_BASE=$'name: dethernety\nservices:\n  db:\n    image: docker.io/memgraph/memgraph:3.13.2\n  proxy:\n    image: docker.io/nginx:1.27-alpine'
n=0
# bundle: a fresh scratch bundle in $B, unpacked as the release ships it.
bundle() {
  n=$((n + 1))
  B="$work/b$n"
  mkdir -p "$B"
  chmod 0755 "$B"
  cp "$SRC/byodt" "$SRC/compose.yaml" "$SRC/compose.memgraph.yaml" "$SRC/compose.neo4j.yaml" "$SRC/.env.example" \
     "$SRC/THIRD-PARTY-ACKNOWLEDGEMENT" "$B/"
}
# notty DIR ARGS...: byodt with no terminal (a new session, stdin a pipe that never closes); output in $work/out.
notty() {
  local d="$1"; shift
  : > "$CALLS"; : > "$CALLS.env"; rc=0
  ( cd "$d" && python3 -I "$DRIVER" notty 30 -- ./byodt "$@" ) > "$work/out" 2>&1 || rc=$?
}
# tty DIR EXPECT ANSWER ... -- ARGS...: byodt at a terminal, answering each prompt.
tty() {
  local d="$1"; shift
  : > "$CALLS"; : > "$CALLS.env"; rc=0
  ( cd "$d" && python3 -I "$DRIVER" tty 30 "$@" ) > "$work/out" 2>&1 || rc=$?
}
env_has() { grep -qxF -- "$2" "$1/.env"; }
nothing_written() { [ ! -e "$1/.env" ] && [ ! -e "$1/.env.secrets" ] && [ ! -e "$1/third-party-acknowledgement.log" ] && [ ! -e "$1/proxy-ca" ] && [ ! -e "$1/data" ] && [ ! -e "$1/.byodt-release" ]; }
records() { if [ -f "$1/third-party-acknowledgement.log" ]; then wc -l < "$1/third-party-acknowledgement.log" | tr -d ' '; else echo 0; fi; }
last_record() { tail -n 1 "$1/third-party-acknowledgement.log"; }
started() { grep -q ' up -d' "$CALLS"; }
shown() { grep -q "THIRD-PARTY SOFTWARE" "$work/out"; }

# --- no terminal ------------------------------------------------------------------------------------------------------
bundle; notty "$B" setup
check "no terminal and no --yes: refused at once, with nothing written and nothing waited for" \
  '[ "$rc" != 0 ] && [ "$rc" != 124 ] && grep -q "asks its questions at a terminal" "$work/out" && nothing_written "$B"'
bundle; notty "$B" setup --db memgraph --bind 127.0.0.1 --port 3000 --no-start
check "every question answered by a flag, still no --yes: refused the same way" \
  '[ "$rc" != 0 ] && [ "$rc" != 124 ] && grep -q "add --yes" "$work/out" && nothing_written "$B"'

bundle; notty "$B" setup --yes
check "--yes: the defaults, and the notice printed with the images and model this deployment runs" \
  '[ "$rc" = 0 ] && env_has "$B" DB_ENGINE=memgraph && env_has "$B" FRONT_DOOR_BIND=127.0.0.1 && env_has "$B" FRONT_DOOR_PORT=3000 \
   && ! grep -q "^HTTPS_PROXY=" "$B/.env" && [ ! -e "$B/.env.secrets" ] && ! started && shown \
   && grep -q "Image:    docker.io/memgraph/memgraph:3.13.2" "$work/out" && grep -q "Hugging Face, $MODEL" "$work/out" \
   && grep -q "Image:    docker.io/nginx:1.27-alpine" "$work/out" && ! grep -q "Neo4j" "$work/out" \
   && ! grep -q "points at" "$work/out" && grep -q "Ready. Start with: ./byodt up" "$work/out"'
# .env.example ships DB_ENGINE commented out; every other default is already its own value.
check "--yes: .env is .env.example with only the DB_ENGINE line changed" \
  '[ "$(diff "$SRC/.env.example" "$B/.env" | grep -c "^[<>]")" = 2 ]'
check "--yes: the record holds the text version and hash, the images, the model, how, and the release" \
  'last_record "$B" | grep -Eq "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z	text-version=1	text-sha256=$(sha_of "$B/THIRD-PARTY-ACKNOWLEDGEMENT")	db=docker.io/memgraph/memgraph:3.13.2	model=$MODEL	front-door=docker.io/nginx:1.27-alpine	via=yes	release=[0-9]" \
   && [ "$(records "$B")" = 1 ] && [ "$(mode_of "$B/third-party-acknowledgement.log")" = 644 ]'

bundle; : > "$CALLS"; : > "$CALLS.env"; rc=0
( cd "$work" && python3 -I "$DRIVER" notty 30 -- "./b$n/byodt" setup --yes ) > "$work/out" 2>&1 || rc=$?
check "run from another folder, the commands it suggests name byodt by the path it was run by" \
  '[ "$rc" = 0 ] && grep -q "Ready. Start with: ./b$n/byodt up" "$work/out"'

bundle; notty "$B" setup --yes --db neo4j --bind 0.0.0.0 --port 3443
check "flags win over defaults: neo4j, 0.0.0.0 with its warning and the TLS step, a port with its note" \
  '[ "$rc" = 0 ] && env_has "$B" DB_ENGINE=neo4j && env_has "$B" FRONT_DOOR_BIND=0.0.0.0 && env_has "$B" FRONT_DOOR_PORT=3443 \
   && grep -q "anyone who can reach port 3443" "$work/out" && grep -q "tls generate" "$work/out" && grep -q "Port 3443" "$work/out" \
   && grep -q "Image:    docker.io/library/neo4j:5.26.32-community" "$work/out" && ! grep -q "Memgraph" "$work/out" \
   && last_record "$B" | grep -q "db=docker.io/library/neo4j:5.26.32-community"'

all_refused=1
for bad_flag in "--db postgres" "--port 70000" "--port 0" "--port 08080" "--bind 10.0.0.5" "--db-data nfs" "--frobnicate" \
                "--https-proxy http://a b" "--https-proxy http://u:p@proxy.corp.example:3128" "--third-party-acknowledged abc" \
                "--third-party-acknowledged $(printf 'a%.0s' $(seq 63))!" "--proxy-ca /etc/hosts" "--start=no" "--yes=0"; do
  bundle
  # shellcheck disable=SC2086
  notty "$B" setup --yes $bad_flag
  if [ "$rc" != 0 ] && [ "$rc" != 124 ] && nothing_written "$B" && ! shown; then :; else bad "refuses $bad_flag"; all_refused=0; fi
done
[ "$all_refused" = 0 ] || ok "bad flag values (a login in the proxy URL, a short hash, a non-certificate CA) and unknown options are refused before anything is shown or written"

bundle; cp "$SRC/.env.example" "$B/.env"; notty "$B" setup --yes
check "an existing .env is refused and left as it was" \
  '[ "$rc" != 0 ] && grep -q "already set up" "$work/out" && cmp -s "$SRC/.env.example" "$B/.env"'
bundle; printf 'HTTPS_PROXY_USERINFO=old:login\n' > "$B/.env.secrets"; chmod 0600 "$B/.env.secrets"; notty "$B" setup --yes
check "an existing .env.secrets, with or without a password, is refused and left as it was" \
  '[ "$rc" != 0 ] && grep -q "has run before" "$work/out" && [ ! -e "$B/.env" ] && grep -qx "HTTPS_PROXY_USERINFO=old:login" "$B/.env.secrets"'

# --- at a terminal ---------------------------------------------------------------------------------------------------
bundle
tty "$B" "Graph database" neo4j "Continue?" y "other machines" n "Port" "" "proxy?" n "Start the stack now?" n -- ./byodt setup
check "at a terminal: the answers are written, and the notice is confirmed with y" \
  '[ "$rc" = 0 ] && env_has "$B" DB_ENGINE=neo4j && env_has "$B" FRONT_DOOR_BIND=127.0.0.1 && env_has "$B" FRONT_DOOR_PORT=3000 \
   && last_record "$B" | grep -q "via=tty"'
bundle; tty "$B" "Graph database" "" "Continue?" n -- ./byodt setup
check "at a terminal, a no to the notice writes nothing" '[ "$rc" != 0 ] && grep -q "Not confirmed" "$work/out" && nothing_written "$B"'
bundle; tty "$B" -- ./byodt setup --yes
check "--yes at a terminal asks nothing" '[ "$rc" = 0 ] && ! grep -q "Continue?" "$work/out" && ! grep -q "Graph database" "$work/out" && env_has "$B" DB_ENGINE=memgraph'

bundle
tty "$B" "Continue?" y "other machines" n "Port" "" "proxy?" y "as http://host:port" "http://127.0.0.1:3128" \
    "directly" "" "percent-encoded" "" "CA certificate" "" "Start the stack now?" n \
    "proxy?" y "as http://host:port" "http://proxy.corp.example:3128" "directly" "lg.corp.example" "percent-encoded" "" \
    "CA certificate" "" -- ./byodt setup --db memgraph
check "at a terminal, a proxy the proxy checks refuse is asked again, and the second one is written" \
  '[ "$rc" = 0 ] && grep -q "is the container itself" "$work/out" && grep -q "asking again" "$work/out" \
   && env_has "$B" HTTPS_PROXY=http://proxy.corp.example:3128 && env_has "$B" NO_PROXY=lg.corp.example && [ ! -e "$B/.env.secrets" ]'

printf -- '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----\n' > "$work/ca.pem"
cat "$work/ca.pem" > "$work/key.pem"; printf -- '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n' >> "$work/key.pem"
bundle
tty "$B" "Continue?" y "other machines" n "Port" "" "proxy?" y "as http://host:port" "http://proxy.corp.example:3128" \
    "directly" "" "percent-encoded" "" "CA certificate" "$work/key.pem" "CA certificate" "/nonexistent.pem" \
    "CA certificate" "$work/ca.pem" "Start the stack now?" n -- ./byodt setup --db memgraph
check "at a terminal, a typed CA that is a key or missing is asked again, and a certificate is taken" \
  '[ "$rc" = 0 ] && grep -q "holds a private key" "$work/out" && grep -q "is not a readable file" "$work/out" \
   && cmp -s "$work/ca.pem" "$B/proxy-ca/proxy-ca.pem"'

# --- the notice --------------------------------------------------------------------------------------------------------
bundle; notty "$B" setup --yes --third-party-acknowledged "$(sha_of "$B/THIRD-PARTY-ACKNOWLEDGEMENT")"
check "the installer's hand-over with the matching hash: not shown again, and recorded as handed over" \
  '[ "$rc" = 0 ] && ! shown && last_record "$B" | grep -q "via=handover-yes"'
bundle; notty "$B" setup --yes --third-party-acknowledged "$(printf '%064d' 0)"
check "a hand-over with another hash: setup shows the notice itself" '[ "$rc" = 0 ] && shown && last_record "$B" | grep -q "via=yes"'
bundle; DB_IMAGE=docker.io/someone/memgraph:3.13.2 notty "$B" setup --yes --third-party-acknowledged "$(sha_of "$B/THIRD-PARTY-ACKNOWLEDGEMENT")"
check "a hand-over is not taken when the [mirror] paragraph applies: setup shows the notice" \
  '[ "$rc" = 0 ] && shown && grep -q "DB_IMAGE points at docker.io/someone/memgraph:3.13.2" "$work/out"'
bundle; DB_IMAGE=memgraph/memgraph:3.14.0 notty "$B" setup --yes
check "another tag of the tested repository, in short form, shows in the image line with no [mirror] paragraph" \
  '[ "$rc" = 0 ] && grep -q "Image:    memgraph/memgraph:3.14.0" "$work/out" && ! grep -q "points at" "$work/out"'
bundle; DB_IMAGE='docker.io/x/memgraph:a&b' notty "$B" setup --yes
check "an & in a value is shown as it is" '[ "$rc" = 0 ] && grep -q "Image:    docker.io/x/memgraph:a&b" "$work/out"'
bundle; DB_IMAGE=$'docker.io/memgraph/memgraph:3.13.2\033[2J' notty "$B" setup --yes
check "an image value with a control character is refused when read, and nothing is written" \
  '[ "$rc" != 0 ] && grep -q "holds a character byodt does not print" "$work/out" && nothing_written "$B"'
bundle; printf 'services:\n    db:\n        image: registry.example.internal/mirror/memgraph:3.13.2\n' > "$B/compose.override.yaml"
STUB_CONFIG=$'name: dethernety\nservices:\n  db:\n    image: registry.example.internal/mirror/memgraph:3.13.2\n  proxy:\n    image: docker.io/nginx:1.27-alpine' \
  notty "$B" setup --yes
check "compose.override.yaml's image, read through compose config (any indentation), is shown, with the [mirror] paragraph" \
  '[ "$rc" = 0 ] && grep -q "Image:    registry.example.internal/mirror/memgraph:3.13.2" "$work/out" \
   && grep -q "compose.override.yaml points at registry.example.internal" "$work/out"'
bundle; printf 'services: [\n' > "$B/compose.override.yaml"; STUB_CONFIG_FAIL=1 notty "$B" setup --yes
check "an override compose cannot read is refused before anything is written" \
  '[ "$rc" != 0 ] && grep -q "could not read compose.override.yaml" "$work/out" && nothing_written "$B"'
bundle; notty "$B" setup --yes --no-start; printf 'services: [\n' > "$B/compose.override.yaml"; STUB_CONFIG_FAIL=1 notty "$B" notice --all
check "for a deployment already set up, an override compose cannot read is warned about once per service, and the command goes on" \
  '[ "$rc" = 0 ] && grep -q "Image:    docker.io/memgraph/memgraph:3.13.2" "$work/out" \
   && [ "$(grep -c "could not read compose.override.yaml, so the notice shows .env.s image for db" "$work/out")" = 1 ] \
   && [ "$(grep -c "could not read compose.override.yaml, so the notice shows .env.s image for proxy" "$work/out")" = 1 ]'
bundle; printf 'services:\n  console:\n    environment:\n      X: "1"\n' > "$B/compose.override.yaml"; STUB_CONFIG="$STUB_CONFIG_BASE" notty "$B" setup --yes
check "an override that sets no image changes nothing in the notice" \
  '[ "$rc" = 0 ] && grep -q "Image:    docker.io/memgraph/memgraph:3.13.2" "$work/out" && ! grep -q "points at" "$work/out"'
bundle; ln -s /etc/hosts "$B/third-party-acknowledgement.log"; notty "$B" setup --yes
check "a linked record file is refused" '[ "$rc" != 0 ] && grep -q "is a symbolic link" "$work/out"'
bundle; : > "$B/third-party-acknowledgement.log"; ln "$B/third-party-acknowledgement.log" "$work/second-name"; notty "$B" setup --yes
check "a record file with a second name (a hard link) is refused" '[ "$rc" != 0 ] && grep -q "hard link" "$work/out"'
if [ "$(id -gn)" != "$(id -un)" ]; then
  bundle; chmod 0775 "$B"; notty "$B" setup --yes
  check "a directory its group can write to, the group not the operator's own, is not recorded in" \
    '[ "$rc" != 0 ] && grep -q "Other accounts can change this directory" "$work/out"'
fi
bundle; printf '\033[2J\n' >> "$B/THIRD-PARTY-ACKNOWLEDGEMENT"; notty "$B" setup --yes
check "a notice file with a control character is refused before it is printed" \
  '[ "$rc" != 0 ] && grep -q "other than printable ASCII" "$work/out" && ! shown && nothing_written "$B"'
bundle; head -c 20000 /dev/zero | tr '\0' 'x' >> "$B/THIRD-PARTY-ACKNOWLEDGEMENT"; notty "$B" setup --yes
check "a notice file over the size cap is refused" '[ "$rc" != 0 ] && grep -q "larger than" "$work/out" && ! shown'
bundle; mv "$B/THIRD-PARTY-ACKNOWLEDGEMENT" "$work/notice"; ln -s "$work/notice" "$B/THIRD-PARTY-ACKNOWLEDGEMENT"; notty "$B" setup --yes
check "a linked notice file is refused" '[ "$rc" != 0 ] && grep -q "missing or not a regular file" "$work/out" && ! shown'

# --- the proxy -------------------------------------------------------------------------------------------------------
bundle; notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128 --no-proxy lg.corp.example
check "--https-proxy and --no-proxy are written, and the proxy checks pass them" \
  '[ "$rc" = 0 ] && env_has "$B" HTTPS_PROXY=http://proxy.corp.example:3128 && env_has "$B" NO_PROXY=lg.corp.example'
all_refused=1
for p in http://127.0.0.1:3128 http://proxy.corp.example socks5://p:1080; do
  bundle; notty "$B" setup --yes --https-proxy "$p"
  if [ "$rc" != 0 ] && [ "$rc" != 124 ] && nothing_written "$B" && grep -q "Nothing was changed" "$work/out"; then :; else bad "refuses the proxy $p"; all_refused=0; fi
done
[ "$all_refused" = 0 ] || ok "a proxy the proxy checks refuse (loopback, no port, another scheme) removes everything setup wrote"
bundle; notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128 --no-proxy 10.0.0.0/8
check "a NO_PROXY the proxy checks refuse (a CIDR) is refused too, with nothing left" '[ "$rc" != 0 ] && nothing_written "$B"'

bundle; BYODT_SETUP_PROXY_USERINFO='alice:s3cr%23t' notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128
check "--yes alone does not save the installer's login" '[ "$rc" = 0 ] && [ ! -e "$B/.env.secrets" ]'
bundle; BYODT_SETUP_PROXY_USERINFO='alice:s3cr%23t' notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128 --proxy-login-from-env
check "--proxy-login-from-env saves it to .env.secrets, 0600, never prints it, and no child process sees it" \
  '[ "$rc" = 0 ] && grep -qx "HTTPS_PROXY_USERINFO=alice:s3cr%23t" "$B/.env.secrets" && ! grep -q "s3cr" "$work/out" \
   && [ "$(mode_of "$B/.env.secrets")" = 600 ] && [ -s "$CALLS.env" ] && ! grep -q "s3cr" "$CALLS.env"'
bundle; BYODT_SETUP_PROXY_USERINFO='alice:s3cr%23t' notty "$B" setup --yes --proxy-login-from-env
check "a login without a proxy URL is refused, and not saved" '[ "$rc" != 0 ] && nothing_written "$B"'
bundle; BYODT_SETUP_PROXY_USERINFO=$'alice:x\nNEO4J_PASSWORD=planted' notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128 --proxy-login-from-env
check "a login with a newline cannot plant a second line: refused, nothing written, nothing echoed" \
  '[ "$rc" != 0 ] && nothing_written "$B" && ! grep -q planted "$work/out"'
bundle; BYODT_SETUP_PROXY_USERINFO='alice:bad#pw' notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128 --proxy-login-from-env
check "a login the proxy grammar refuses (an unencoded #) is refused, and nothing written" '[ "$rc" != 0 ] && nothing_written "$B"'
bundle; BYODT_SETUP_PROXY_USERINFO='just-a-token' notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128 --proxy-login-from-env
check "a login with no colon is neither shown nor saved" '[ "$rc" != 0 ] && ! grep -q "just-a-token" "$work/out" && nothing_written "$B"'

bundle; notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128 --proxy-ca "$work/ca.pem"
check "--proxy-ca lands as proxy-ca/proxy-ca.pem, 0644, in a 0755 proxy-ca/" \
  '[ "$rc" = 0 ] && cmp -s "$work/ca.pem" "$B/proxy-ca/proxy-ca.pem" && [ "$(mode_of "$B/proxy-ca/proxy-ca.pem")" = 644 ] && [ "$(mode_of "$B/proxy-ca")" = 755 ]'
bundle; ( cd "$work" && python3 -I "$DRIVER" notty 30 -- "$B/byodt" setup --yes --https-proxy http://proxy.corp.example:3128 --proxy-ca ca.pem ) > "$work/out" 2>&1 && rc=0 || rc=$?
check "a relative --proxy-ca is read from the directory byodt was run in" '[ "$rc" = 0 ] && cmp -s "$work/ca.pem" "$B/proxy-ca/proxy-ca.pem"'
bundle; mkdir -m 0777 "$B/proxy-ca"; notty "$B" setup --yes --https-proxy http://proxy.corp.example:3128 --proxy-ca "$work/ca.pem"
check "an existing proxy-ca/ that other accounts can write to is refused, and the CA not copied" \
  '[ "$rc" != 0 ] && [ ! -e "$B/proxy-ca/proxy-ca.pem" ] && [ ! -e "$B/.env" ]'

# --- storage, and starting ------------------------------------------------------------------------------------------
bundle; STUB_OS="Docker Desktop" notty "$B" setup --yes
check "on Docker Desktop, --yes keeps the database in the named volume" '[ "$rc" = 0 ] && env_has "$B" DB_DATA=memgraph-data'
bundle; STUB_OS="Docker Desktop" notty "$B" setup --yes --db neo4j
check "the same for Neo4j" '[ "$rc" = 0 ] && env_has "$B" NEO4J_DATA=neo4j-data'
bundle; STUB_OS="Docker Desktop" notty "$B" setup --yes --db-data bind
check "--db-data bind keeps the bind mount" '[ "$rc" = 0 ] && env_has "$B" DB_DATA=./data/memgraph'

bundle; notty "$B" setup --yes --start
check "--start starts the stack, without asking for the notice again" \
  '[ "$rc" = 0 ] && started && [ "$(grep -c "THIRD-PARTY SOFTWARE" "$work/out")" = 1 ] && [ -s "$B/.env.secrets" ]'
bundle; STUB_IDS=c1 STUB_WD_c1=/srv/byodt-0.13.0 notty "$B" setup --yes --start
check "--start with the project running from another directory is refused before anything is written" \
  '[ "$rc" != 0 ] && grep -q "/srv/byodt-0.13.0" "$work/out" && nothing_written "$B"'
bundle; STUB_OS="Docker Desktop" STUB_VOLUMES=dethernety_memgraph-data notty "$B" setup --yes --start
check "--start onto a volume left by an earlier deployment is refused before anything is written" \
  '[ "$rc" != 0 ] && grep -q "dethernety_memgraph-data remains from an earlier deployment" "$work/out" \
   && grep -q "Run setup with --db-data bind" "$work/out" && nothing_written "$B"'
bundle; STUB_VOLUMES="dethernety_memgraph-data dethernety_neo4j-data" notty "$B" setup --yes --start
check "--start beside volumes an earlier deployment left, with the database in ./data: started, each volume named, none removed" \
  '[ "$rc" = 0 ] && started && grep -q "volume dethernety_memgraph-data remains from an earlier deployment" "$work/out" \
   && grep -q "docker volume rm dethernety_neo4j-data. (this deletes it for good)" "$work/out" && ! grep -q "volume rm" "$CALLS"'
bundle; STUB_OS="Docker Desktop" STUB_VOLUMES="dethernety_memgraph-data dethernety_neo4j-data" notty "$B" setup --yes
check "volume mode without --start: the volume it would mount is named with the setting that avoids it, the other as unused" \
  '[ "$rc" = 0 ] && ! started && grep -q "dethernety_memgraph-data remains .* this one would mount it" "$work/out" \
   && grep -q "set DB_DATA=./data/memgraph in .env" "$work/out" && grep -q "dethernety_neo4j-data remains .* This one does not use it" "$work/out"'
bundle; STUB_OS="Docker Desktop" STUB_VOLUMES="dethernety_neo4j-data" notty "$B" setup --yes --start
check "volume mode with --start beside the other engine's old volume: started, that volume named" \
  '[ "$rc" = 0 ] && started && grep -q "dethernety_neo4j-data remains .* This one does not use it" "$work/out" && ! grep -q "would mount it" "$work/out"'

# --- the commands that download ---------------------------------------------------------------------------------------
bundle; notty "$B" up
check "up on a folder that has not run, with no terminal and no --yes: refused before .env, a password or a directory is made" \
  '[ "$rc" != 0 ] && grep -q "no terminal to confirm the notice" "$work/out" && nothing_written "$B" && ! started'
bundle; tty "$B" "Continue?" n -- ./byodt up
check "a no at a terminal leaves the folder as it was too" '[ "$rc" != 0 ] && nothing_written "$B"'
bundle; notty "$B" models pull
check "models pull on a folder that has not run confirms the notice too" '[ "$rc" != 0 ] && grep -q "no terminal to confirm the notice" "$work/out" && nothing_written "$B"'
bundle; notty "$B" bootstrap; notty "$B" up
check "bootstrap does not count as a start: up after it still needs the confirmation" '[ "$rc" != 0 ] && ! started'

bundle; notty "$B" up --yes
check "up --yes on a folder that has not run records the notice and starts" '[ "$rc" = 0 ] && started && last_record "$B" | grep -q "via=yes"'
export STUB_IDS=c1 STUB_WD_c1="$B"   # from here on, this deployment has run
notty "$B" up
check "a later up with nothing changed does not show the notice" '[ "$rc" = 0 ] && started && ! shown'
printf 'PROXY_IMAGE=docker.io/nginx:1.29-alpine\n' >> "$B/.env"; notty "$B" up
check "a new front-door image alone does not show the notice" '[ "$rc" = 0 ] && ! shown && [ "$(records "$B")" = 1 ]'
printf 'DB_IMAGE=docker.io/memgraph/memgraph:3.14.0\n' >> "$B/.env"
for verb in up update restart; do
  notty "$B" "$verb"
  if [ "$rc" = 0 ] && shown && grep -q "has not been confirmed" "$work/out" && [ "$(records "$B")" = 1 ]; then :; else bad "$verb on a started deployment whose database image changed"; sed 's/^/     | /' "$work/out" | tail -5; fi
done
ok "a started deployment whose database image changed: up, update and restart show the notice and warn, and are not stopped"
notty "$B" acknowledge --yes
check "acknowledge --yes records it" '[ "$rc" = 0 ] && last_record "$B" | grep -q "db=docker.io/memgraph/memgraph:3.14.0"'
notty "$B" acknowledge extra
check "acknowledge refuses an argument other than --yes" '[ "$rc" != 0 ] && grep -q "takes no arguments" "$work/out"'
sed -i.bak 's/^Text-Version: 1$/Text-Version: 2/' "$B/THIRD-PARTY-ACKNOWLEDGEMENT"; notty "$B" up --yes
check "a new Text-Version asks again" '[ "$rc" = 0 ] && shown && [ "$(records "$B")" = 3 ] && last_record "$B" | grep -q "text-version=2"'
printf '\nOne more line.\n' >> "$B/THIRD-PARTY-ACKNOWLEDGEMENT"; notty "$B" up --yes
check "a changed text with the same Text-Version asks again" '[ "$rc" = 0 ] && shown && [ "$(records "$B")" = 4 ]'
sed -i.bak 's/^readonly TESTED_MODEL=.*/readonly TESTED_MODEL="onnx-community\/other-ONNX@0123456789abcdef0123456789abcdef01234567"/' "$B/byodt"; notty "$B" up --yes
check "a new model asks again" '[ "$rc" = 0 ] && shown && last_record "$B" | grep -q "model=onnx-community/other-ONNX@"'
printf 'DB_IMAGE=${MIRROR}/memgraph:3.14.0\n' >> "$B/.env"; notty "$B" update
check "an image written with a variable on a started deployment, nobody to ask: warned, never stopped" \
  '[ "$rc" = 0 ] && grep -q "could not be shown" "$work/out"'
unset STUB_IDS STUB_WD_c1

if [ "$fail" = 0 ]; then echo "PASS byodt-setup"; else echo "FAILED byodt-setup"; exit 1; fi
