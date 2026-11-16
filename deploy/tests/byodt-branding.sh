#!/usr/bin/env bash
# Pins how byodt keeps branding/, the installation's brand for its reports, by running the wrapper itself in scratch
# bundles with a stand-in `docker` on PATH; no container engine runs.
#
#   - up creates branding/ at 0755, and an existing one keeps its mode;
#   - an empty folder, and a brand set up as asked, pass without a word;
#   - a folder or file another account owns, a symbolic link inside, a file (dot files too) not every account can read,
#     a folder not every account can enter, and a folder or file other accounts can change are warned about, naming the
#     fix, and the command carries on; a group that may write is fine when it is the operator's own private group, and
#     a file the operator made through sudo is the operator's;
#   - a name with anything but letters, digits, dots, dashes and underscores gets one warning and is never printed;
#   - branding as a regular file, or as a symbolic link to nothing, stops the command before anything starts; as a
#     link to the operator's own directory, it is used;
#   - restart looks the folder over too; destroy leaves it and says so;
#   - it belongs to the deployment: an upgrade never ships or replaces it, and the installer reserves it too;
#   - compose.yaml mounts it read-only into the platform alone, and points BRANDING_FILE at brand.json in it;
#     .gitignore keeps it out of the repository.
#
#   bash deploy/tests/byodt-branding.sh
set -euo pipefail

# No test may reach the network: stand-ins for curl, wget and cosign that fail loudly come before the system's.
export PATH="$(cd "$(dirname "$0")" && pwd)/no-network:$PATH"

SRC="$(cd "$(dirname "$0")/../compose" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
CALLS="$work/calls"
# The stand-in engine: `compose version` succeeds, no image is pulled, `config --services` lists the bundle's services,
# and every other call is recorded.
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
[ "$1 $2" = "compose version" ] && exit 0
[ "$1 $2" = "image inspect" ] && exit 1
if [ "$1" = compose ] && [[ " $* " == *" config --services "* ]]; then
  printf '%s\n' db console-init platform proxy console
  exit 0
fi
printf '%s\n' "$*" >> "$CALLS"
exit 0
SHIM
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS
unset DB_ENGINE CONTAINER_ENGINE NEO4J_IMAGE NEO4J_USERNAME HTTPS_PROXY https_proxy HTTP_PROXY http_proxy NO_PROXY no_proxy \
  2>/dev/null || true

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
mode_of() { perl -e 'printf "%o\n", (lstat $ARGV[0])[2] & 07777' "$1"; }

PASSWORD="0123456789abcdef0123456789abcdef0123456789abcdef"

# bundle NAME [SETUP]: a fresh bundle from the shipped files, then SETUP run in it.
bundle() {
  local b="$work/$1"
  rm -rf "$b"; mkdir -p "$b"
  cp "$SRC/byodt" "$SRC/compose.yaml" "$SRC/compose.memgraph.yaml" "$SRC/compose.neo4j.yaml" "$SRC/THIRD-PARTY-ACKNOWLEDGEMENT" "$b/"
  printf '%s\n' "PLATFORM_VERSION=9.9.9" "CONTAINER_ENGINE=docker" "NEO4J_USERNAME=dethernety" > "$b/.env"
  printf 'NEO4J_PASSWORD=%s\n' "$PASSWORD" > "$b/.env.secrets"
  chmod 0600 "$b/.env.secrets"
  [ -z "${2:-}" ] || ( cd "$b" && eval "$2" )
  : > "$CALLS"
  printf '%s' "$b"
}
# The commands that download confirm the third-party notice; with no terminal here, --yes does.
run() {
  case "$1" in up|start|update|pull|restart|models) set -- "$@" --yes ;; esac
  ( cd "$B" && ./byodt "$@" ) </dev/null >"$work/out" 2>&1
}
started() { grep -q ' up ' "$CALLS"; }

# --- the folder ----------------------------------------------------------------------------------------------------
B="$(bundle fresh)"
if run up; then ok "up succeeds on a fresh bundle"; else bad "up failed on a fresh bundle: $(cat "$work/out")"; fi
[ -d "$B/branding" ] && [ "$(mode_of "$B/branding")" = 755 ] && ok "up creates branding/ at 0755" \
  || bad "up left branding/ as: $(ls -ld "$B/branding" 2>&1)"
grep -q branding "$work/out" && bad "an empty branding/ is talked about: $(cat "$work/out")" || ok "an empty branding/ passes without a word"

B="$(bundle branded 'mkdir branding && printf "{}\n" > branding/brand.json && printf x > branding/logo.png')"
if run up; then ok "up succeeds with a brand in place"; else bad "up failed with a brand in place: $(cat "$work/out")"; fi
grep -q branding "$work/out" && bad "a brand set up as asked is talked about: $(cat "$work/out")" || ok "a brand set up as asked passes without a word"

B="$(bundle kept-mode 'mkdir -m 0711 branding')"
run up || true
[ "$(mode_of "$B/branding")" = 711 ] && ok "an existing branding/ keeps its mode" || bad "an existing branding/ was chmod'ed to $(mode_of "$B/branding")"
grep -q 'branding' "$work/out" && bad "a 0711 branding/, which the platform can enter, is warned about" || ok "a 0711 branding/ passes without a word"

# --- warnings: the command carries on ------------------------------------------------------------------------------
# warned NAME WHAT SETUP: up warns about the branding/ SETUP leaves, saying WHAT, and starts the stack anyway.
warned() {
  B="$(bundle "$1" "$3")"
  if ! run up; then bad "$1: up stopped: $(cat "$work/out")"; return; fi
  started || { bad "$1: up did not start the stack"; return; }
  grep -q -- "$2" "$work/out" && ok "$1: warned, saying '$2', and up carried on" || bad "$1: no warning '$2': $(cat "$work/out")"
}
warned link "branding/logo.png is a symbolic link, which does not resolve inside the platform" \
  'mkdir branding && printf x > logo.png && ln -s ../logo.png branding/logo.png'
warned private "branding/brand.json is not readable by every account" \
  'mkdir branding && printf "{}\n" > branding/brand.json && chmod 0600 branding/brand.json'
warned file-writable "branding/brand.json can be changed by other accounts" \
  'mkdir branding && printf "{}\n" > branding/brand.json && chmod 0666 branding/brand.json'
# A group-writable folder is fine when the group is the operator's own private group, which on many hosts it is: this
# case runs only where it is not. The stubbed cases below cover both.
if [ "$(id -gn)" != "$(id -un)" ]; then
  warned dir-writable "branding/ can be changed by other accounts" 'mkdir branding && chmod 0775 branding'
fi
warned dir-closed "branding/ cannot be entered by every account" 'mkdir branding && chmod 0750 branding'
warned dotfile "branding/.hidden is not readable by every account" \
  'mkdir branding && printf x > branding/.hidden && chmod 0600 branding/.hidden'
B="$(bundle odd-name 'mkdir branding && printf x > "branding/a;touch planted" && chmod 0600 "branding/a;touch planted"')"
if run up && started; then ok "odd-name: up carried on"; else bad "odd-name: up stopped: $(cat "$work/out")"; fi
grep -q 'branding/ holds a name with characters other than' "$work/out" && ok "a name byodt will not print gets one warning" \
  || bad "a name byodt will not print got no warning: $(cat "$work/out")"
grep -q 'touch planted' "$work/out" && bad "the odd name is printed: $(cat "$work/out")" || ok "the odd name is never printed, nor its other warnings"
B="$(bundle restart 'mkdir branding && printf "{}\n" > branding/brand.json && chmod 0600 branding/brand.json')"
run restart platform || true
grep -q "branding/brand.json is not readable by every account" "$work/out" && ok "restart looks branding/ over too" \
  || bad "restart did not look branding/ over: $(cat "$work/out")"

# --- refusals: nothing starts --------------------------------------------------------------------------------------
# refused NAME WHAT SETUP: up refuses the branding SETUP leaves, starts nothing, and says WHAT.
refused() {
  B="$(bundle "$1" "$3")"
  if run up; then bad "$1: up accepted it"; return; fi
  started && { bad "$1: up started the stack anyway"; return; }
  grep -q -- "$2" "$work/out" && ok "$1: refused, saying '$2'" || bad "$1: refused without '$2': $(cat "$work/out")"
}
refused file "branding is not a directory" 'printf x > branding'
refused dangling "branding is a symbolic link to nothing" 'ln -s ./nowhere branding'

B="$(bundle linked-dir 'mkdir -m 0755 elsewhere && ln -s elsewhere branding')"
if run up; then ok "branding as a link to the operator's own directory is used"; else bad "a link to a directory was refused: $(cat "$work/out")"; fi

# --- destroy -------------------------------------------------------------------------------------------------------
B="$(bundle destroy 'mkdir branding && printf "{}\n" > branding/brand.json')"
run up || true
if run destroy; then ok "destroy succeeds"; else bad "destroy failed: $(cat "$work/out")"; fi
[ -f "$B/branding/brand.json" ] && grep -q 'Left alone: .*branding/' "$work/out" \
  && ok "destroy leaves branding/ and says so" || bad "destroy: $(ls -la "$B/branding" 2>&1) $(cat "$work/out")"

# --- a file another account owns (ownership stubbed: a test cannot make one) ---------------------------------------
for f in stat_field path_owner owned_by_operator shared_write check_branding; do
  fn="$(sed -n "/^$f() {\$/,/^}\$/p" "$SRC/byodt")"
  [ -n "$fn" ] || { echo "FAIL: no $f in $SRC/byodt"; exit 1; }
  eval "$fn"
done
eval "$(sed -n '/^path_owner() {$/,/^}$/p' "$SRC/byodt" | sed '1s/^path_owner() {$/real_path_owner() {/')"
OWNER_PATH=""
path_owner() { if [ "$1" = "$OWNER_PATH" ]; then echo 4242; else real_path_owner "$1"; fi; }
die() { printf 'die: %s\n' "$*"; exit 3; }
warn() { printf 'warn: %s\n' "$*"; }
# foreign NAME PATH SHOWN SETUP: in a folder SETUP leaves, PATH belongs to uid 4242; check_branding warns about it,
# naming it SHOWN, and carries on.
foreign() {
  local d="$work/own-$1" out rc=0
  rm -rf "$d"; mkdir -p "$d"
  ( cd "$d" && eval "$4" )
  OWNER_PATH="$2"
  out="$(cd "$d" && check_branding 2>&1)" || rc=$?
  OWNER_PATH=""
  if [ "$rc" -eq 0 ] && grep -q "warn: $3 is .*owned by uid 4242, not by you" <<<"$out"; then ok "$1: warned, and carried on"
  else bad "$1: rc $rc: $out"; fi
}
foreign file branding/brand.json branding/brand.json 'mkdir branding && printf "{}\n" > branding/brand.json'
foreign folder branding/. branding/ 'mkdir branding'
foreign link branding branding 'mkdir -m 0755 elsewhere && ln -s elsewhere branding'
OWNER_PATH=""
out="$(cd "$work/own-file" && check_branding 2>&1)"
[ -z "$out" ] && ok "the operator's own folder and file pass without a word" || bad "the operator's own branding/ got: $out"
out="$(cd "$work/own-file" && SUDO_UID=4242 OWNER_PATH=branding/brand.json check_branding 2>&1)"
[ -z "$out" ] && ok "a file the operator made, byodt run through sudo, passes" || bad "a file the sudo user made got: $out"

# A group may write: fine when it is the operator's own private group (named after the operator), as on hosts whose
# umask makes new files group-writable; a warning for any other group. id is stubbed to name the groups.
d="$work/own-group"; rm -rf "$d"; mkdir -p "$d/branding"; printf '{}\n' > "$d/branding/brand.json"
chmod 0775 "$d/branding"; chmod 0664 "$d/branding/brand.json"
FILE_GID="$(stat_field %g %g "$d/branding/brand.json")"
id() { case "$1" in -g) echo "$FILE_GID" ;; -gn) echo "$GROUP_NAME" ;; -un) echo operator ;; *) command id "$@" ;; esac; }
out="$(cd "$d" && GROUP_NAME=operator check_branding 2>&1)"
[ -z "$out" ] && ok "a folder and file the operator's own private group may write pass without a word" || bad "the operator's private group got: $out"
out="$(cd "$d" && GROUP_NAME=staff check_branding 2>&1)"
grep -q 'warn: branding/ can be changed by other accounts' <<<"$out" && grep -q 'warn: branding/brand.json can be changed by other accounts' <<<"$out" \
  && ok "a folder and file a shared group may write are warned about" || bad "a shared group's write access got: $out"
unset -f id

# --- it belongs to the deployment ----------------------------------------------------------------------------------
eval "$(sed -n '/^upgrade_path_reserved() {$/,/^}$/p' "$SRC/byodt")"
ACK_LOG=third-party-acknowledgement.log
for p in branding branding/brand.json branding/logo.png BRANDING/brand.json; do
  upgrade_path_reserved "$p" && ok "an upgrade treats $p as the deployment's own" || bad "an upgrade would ship or replace $p"
done
upgrade_path_reserved brandingx && bad "brandingx is taken for branding/" || ok "a name that only starts with branding is not reserved"
grep -q 'proxy-ca|proxy-ca/\*|branding|branding/\*|' "$SRC/../installer/get-byodt.sh.in" \
  && ok "the installer reserves branding/ too" || bad "the installer's reserved list lacks branding/"

# --- compose.yaml --------------------------------------------------------------------------------------------------
block="$(sed -n "/^  platform:\$/,/^  [a-z#-]/p" "$SRC/compose.yaml")"
grep -q -- '- ./branding:/branding:ro' <<< "$block" && grep -q 'BRANDING_FILE: /branding/brand.json' <<< "$block" \
  && ok "compose.yaml mounts branding/ read-only into the platform and points BRANDING_FILE at brand.json" \
  || bad "compose.yaml's platform lacks the branding wiring"
n="$(cat "$SRC/compose.yaml" "$SRC/compose.memgraph.yaml" "$SRC/compose.neo4j.yaml" | grep -c -e './branding:' -e 'BRANDING_FILE:' || true)"
[ "$n" = 2 ] && ok "no other service gets branding/" || bad "branding/ is mounted or named $n times across the compose files"
grep -qx 'branding/' "$SRC/.gitignore" && ok ".gitignore keeps branding/ out of the repository" || bad ".gitignore lacks branding/"

exit "$fail"
