#!/usr/bin/env bash
# Pins byodt's remove_old_ollama and check_console_init, and the project_containers lookup they share: containers are
# found by this project's AND the service's labels, in both providers' namespaces, never by name or image; the old
# ollama container is removed and nothing else; a console-init that exited non-zero fails the command with the pointer.
# The functions are lifted out of the wrapper itself; the engine is a stub that answers only the exact label filters
# and records every call, so no container engine is needed.
#
#   bash deploy/tests/byodt-remove-old-ollama.sh
set -euo pipefail

BYODT="$(cd "$(dirname "$0")/../compose" && pwd)/byodt"
for f in project_containers remove_old_ollama check_console_init; do
  fn="$(sed -n "/^$f() {\$/,/^}\$/p" "$BYODT")"
  [ -n "$fn" ] || { echo "FAIL: no $f in $BYODT"; exit 1; }
  eval "$fn"
done

SELF="byodt"
info() { printf 'info: %s\n' "$*"; }
warn() { printf 'warn: %s\n' "$*"; }
die() { printf 'die: %s\n' "$*"; exit 3; }
resolve_engine() { :; }

CALLS="$(mktemp)"
trap 'rm -f "$CALLS"' EXIT
ENGINE=stub_engine
# The stub's world: lines "<namespace> <project> <service> <id> <status> <exit code> [<created> [<oneoff> [<name>]]]".
WORLD=""
stub_engine() {
  printf '%s\n' "$*" >> "$CALLS"
  case "$1" in
    ps)
      # Only the exact form: ps -aq --filter label=<ns>.project=<p> --filter label=<ns>.service=<s>
      [ "$2" = -aq ] && [ "$3" = --filter ] && [ "$5" = --filter ] || { echo "unexpected ps form: $*" >&2; return 1; }
      local ns p s
      ns="${4#label=}"; ns="${ns%.project=*}"; p="${4#*.project=}"
      [ "${6#label=}" != "$6" ] || return 1
      s="${6#label=$ns.service=}"
      [ "$s" != "$6" ] || { echo "namespaces differ in one ps: $*" >&2; return 1; }
      printf '%s\n' "$WORLD" | awk -v ns="$ns" -v p="$p" -v s="$s" '$1 == ns && $2 == p && $3 == s { print $4 }'
      ;;
    rm) return 0 ;;
    inspect)
      local fmt="$3" id="${@: -1}"
      case "$fmt" in
        '{{.State.Status}} {{.State.ExitCode}}') printf '%s\n' "$WORLD" | awk -v id="$id" '$4 == id { print $5, $6; exit }' ;;
        '{{.Created}}') printf '%s\n' "$WORLD" | awk -v id="$id" '$4 == id { print ($7 == "" ? "2026-01-01T00:00:00Z" : $7); exit }' ;;
        *oneoff*) printf '%s\n' "$WORLD" | awk -v id="$id" '$4 == id { print ($8 == "" ? "False" : $8); exit }' ;;
        '{{.Name}}') printf '%s\n' "$WORLD" | awk -v id="$id" '$4 == id { print ($9 == "" ? "dethernety-" $3 "-1" : $9); exit }' ;;
        *) echo "unexpected inspect format: $fmt" >&2; return 1 ;;
      esac ;;
  esac
}

fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
removed() { grep -c '^rm -f ' "$CALLS" || true; }

# 1. Docker Compose labels.
: > "$CALLS"
WORLD=$'com.docker.compose dethernety ollama aaa exited 0\ncom.docker.compose dethernety platform bbb running 0\ncom.docker.compose other ollama ccc running 0'
out="$(remove_old_ollama)"
check 'removes the old ollama container (Docker Compose labels)' 'grep -qx "rm -f aaa" "$CALLS"'
check 'removes nothing else (the platform, another project'"'"'s ollama)' '[ "$(removed)" = 1 ]'
check 'asks by project and service in both namespaces' 'grep -qx "ps -aq --filter label=com.docker.compose.project=dethernety --filter label=com.docker.compose.service=ollama" "$CALLS" && grep -qx "ps -aq --filter label=io.podman.compose.project=dethernety --filter label=io.podman.compose.service=ollama" "$CALLS"'
check 'never asks by name or image' '! grep -qE "name=|ancestor=" "$CALLS"'
check 'says so' 'grep -q "Removing the old embedding server" <<<"$out"'

# 2. podman-compose labels, and the same container seen under both namespaces.
: > "$CALLS"
WORLD=$'io.podman.compose dethernety ollama ddd exited 0\ncom.docker.compose dethernety ollama ddd exited 0'
remove_old_ollama >/dev/null
check 'removes it under podman-compose labels, once' 'grep -qx "rm -f ddd" "$CALLS" && [ "$(removed)" = 1 ]'

# 3. None there.
: > "$CALLS"
WORLD='com.docker.compose dethernety platform bbb running 0'
out="$(remove_old_ollama)"
check 'is quiet and removes nothing when there is none' '[ -z "$out" ] && [ "$(removed)" = 0 ]'

# 4. console-init's state.
WORLD='com.docker.compose dethernety console-init eee exited 0'
check 'passes a console-init that exited 0' 'check_console_init'
WORLD='io.podman.compose dethernety console-init fff exited 1'
set +e; out="$(check_console_init)"; rc=$?; set -e
check 'fails a console-init that exited 1, with the pointer' '[ "$rc" = 3 ] && grep -q "console-init stopped the start (exit 1): '"'"'byodt logs console-init'"'"' says why" <<<"$out"'
WORLD='com.docker.compose dethernety console-init ggg running 0'
check 'leaves a console-init still running alone' 'check_console_init'
WORLD=''
check 'passes when there is no console-init' 'check_console_init'
WORLD=$'com.docker.compose dethernety console-init old1 exited 1 2026-10-15T08:00:00Z False\ncom.docker.compose dethernety console-init new1 exited 0 2026-10-15T09:00:00Z False'
check 'reads the newest console-init, not an older failed one' 'check_console_init'
WORLD=$'com.docker.compose dethernety console-init run1 exited 0 2026-10-15T10:00:00Z True\ncom.docker.compose dethernety console-init svc1 exited 2 2026-10-15T09:00:00Z False'
set +e; out="$(check_console_init)"; rc=$?; set -e
check 'skips a newer one-off run and reads the service'"'"'s refusal' '[ "$rc" = 3 ] && grep -q "exit 2" <<<"$out"'

WORLD=$'io.podman.compose dethernety console-init tmp1 exited 1 2026-10-15T10:00:00Z False dethernety_console-init_tmp4242\nio.podman.compose dethernety console-init svc2 exited 0 2026-10-15T09:00:00Z False dethernety_console-init_1'
check 'skips a newer podman-compose one-off run (named _tmp<n>, no oneoff label)' 'check_console_init'

# 5. start_stack reads console-init's last run only for a start that runs it: not for the console alone.
eval "$(sed -n '/^start_stack() {$/,/^}$/p' "$BYODT")"
compose() { return 0; }
check_console_init() { echo checked >> "$CALLS"; }
checked_for() { : > "$CALLS"; start_stack "$@" >/dev/null; grep -c checked "$CALLS" || true; }
check 'a full start reads console-init' '[ "$(checked_for)" = 1 ]'
check 'a start of the platform reads console-init' '[ "$(checked_for platform)" = 1 ]'
check 'a start of the console alone does not' '[ "$(checked_for console)" = 0 ]'
check 'a start of the console and the platform does' '[ "$(checked_for console platform)" = 1 ]'

if [ "$fail" -ne 0 ]; then echo "remove_old_ollama / check_console_init: FAILED"; exit 1; fi
echo "remove_old_ollama / check_console_init: all cases pass"
