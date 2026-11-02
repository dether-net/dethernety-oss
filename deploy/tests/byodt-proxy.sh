#!/usr/bin/env bash
# Pins how byodt settles the outbound proxy, by running the wrapper itself in scratch bundles with a stand-in `docker`
# on PATH that records what compose is handed; no container engine runs.
#
#   - HTTPS_PROXY and NO_PROXY come from .env only; a different value in the shell gets a notice, never adoption;
#   - NO_PROXY is the operator's hosts, then loopback and the stack's own names, then any service compose lists;
#   - the login comes from .env.secrets, is checked strictly (UTF-8 once decoded, as Node decodes it), and is never
#     printed;
#   - the platform's Node is switched to the proxy (NODE_USE_ENV_PROXY=1) only when there is one, and no other
#     service is;
#   - every refusal: a login in .env, no port, a bad port, a loopback proxy, a CIDR, a range, a wildcard, a space;
#   - an https:// proxy without a login is warned about, not refused;
#   - the CA is named only when proxy-ca/proxy-ca.pem exists; proxy-ca/ is created, and refused when it holds
#     anything else, another account can change it, or it is a dangling link;
#   - the Docker daemon without a proxy is warned about, and only when .env sets one;
#   - down, status, logs, backup and restore run whatever the proxy setting says.
#
#   bash deploy/tests/byodt-proxy.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../compose" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
CALLS="$work/calls"
# The stand-in engine: `compose version` succeeds, no image is pulled, `config --services` lists the bundle's services
# plus one an override added, `info` answers STUB_DAEMON_PROXY, and every `up` records the proxy values compose gets.
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
[ "$1 $2" = "compose version" ] && exit 0
[ "$1 $2" = "image inspect" ] && exit 1
if [ "$1" = info ]; then printf '%s\n' "$*" >> "$CALLS.info"; printf '%s\n' "${STUB_DAEMON_PROXY:-}"; exit 0; fi
if [ "$1" = compose ] && [[ " $* " == *" config --services "* ]]; then
  printf '%s\n' "${CONSOLE_IMAGE:-}" > "$CALLS.svcimage"
  printf '%s\n' db console-init platform proxy console extra-svc
  exit 0
fi
printf '%s\n' "$*" >> "$CALLS"
if [ "$1" = compose ] && [[ " $* " == *" up "* ]]; then
  printf 'URL=%s\nNO=%s\nCA=%s\nCADIR=%s\nUSE=%s\n' "${BYODT_HTTPS_PROXY-unset}" "${BYODT_NO_PROXY-unset}" \
    "${BYODT_NODE_EXTRA_CA_CERTS-unset}" "${BYODT_SSL_CERT_DIR-unset}" "${BYODT_NODE_USE_ENV_PROXY-unset}" > "$CALLS.env"
fi
exit 0
SHIM
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS
unset DB_ENGINE CONTAINER_ENGINE NEO4J_IMAGE NEO4J_USERNAME HTTPS_PROXY https_proxy HTTP_PROXY http_proxy NO_PROXY no_proxy \
  STUB_DAEMON_PROXY 2>/dev/null || true

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

PASSWORD="0123456789abcdef0123456789abcdef0123456789abcdef"
SECRET_PART="s3cr%23t"

# bundle NAME USERINFO [ENV LINES...]: a fresh bundle from the shipped files, with an .env of the given lines and, when
# USERINFO is not empty, a proxy login in .env.secrets.
bundle() {
  local b="$work/$1" ui="$2"; shift 2
  rm -rf "$b"; mkdir -p "$b"
  cp "$SRC/byodt" "$SRC/compose.yaml" "$SRC/compose.memgraph.yaml" "$SRC/compose.neo4j.yaml" "$b/"
  printf '%s\n' "PLATFORM_VERSION=9.9.9" "CONTAINER_ENGINE=docker" "NEO4J_USERNAME=dethernety" "$@" > "$b/.env"
  printf 'NEO4J_PASSWORD=%s\n' "$PASSWORD" > "$b/.env.secrets"
  [ -z "$ui" ] || printf 'HTTPS_PROXY_USERINFO=%s\n' "$ui" >> "$b/.env.secrets"
  chmod 0600 "$b/.env.secrets"
  : > "$CALLS"; rm -f "$CALLS.env" "$CALLS.info" "$CALLS.svcimage"
  printf '%s' "$b"
}
run() { ( cd "$B" && ./byodt "$@" ) </dev/null >"$work/out" 2>&1; }
got() { sed -n "s/^$1=//p" "$CALLS.env" 2>/dev/null; }
# refused NAME WHAT [ENV LINES...]: up refuses that .env, starts nothing, and says WHAT.
refused() {
  local name="$1" what="$2"; shift 2
  B="$(bundle "$name" "" "$@")"
  if run up; then bad "$name: up accepted it"; return; fi
  if grep -q ' up ' "$CALLS"; then bad "$name: up started the stack anyway"; return; fi
  grep -q -- "$what" "$work/out" && ok "$name: refused, saying '$what'" || bad "$name: refused without '$what': $(cat "$work/out")"
}

INTERNAL="localhost,127.0.0.1,::1,db,console-init,platform,proxy,console"

# --- no proxy: today's behaviour ---------------------------------------------------------------------------------
B="$(bundle none "")"
if run up; then ok "up succeeds with no proxy"; else bad "up failed with no proxy: $(cat "$work/out")"; fi
[ "$(got URL)" = "" ] && [ "$(got NO)" = "" ] && [ "$(got CA)" = "" ] && [ "$(got USE)" = "" ] \
  && ok "with no proxy, compose gets the proxy values empty, NODE_USE_ENV_PROXY too" || bad "with no proxy, compose got: $(cat "$CALLS.env")"
[ -d "$B/proxy-ca" ] && ok "up creates proxy-ca/" || bad "up did not create proxy-ca/"
[ -s "$CALLS.info" ] && bad "the daemon was asked with no proxy set" || ok "with no proxy, the daemon is not asked"

# --- a proxy in .env -----------------------------------------------------------------------------------------------
B="$(bundle plain "" "HTTPS_PROXY=http://proxy.example.internal:3128" "NO_PROXY=langgraph.example.internal,10.1.2.3:8443")"
if STUB_DAEMON_PROXY=http://proxy.example.internal:3128 run up; then ok "up succeeds with a proxy"; else bad "up failed with a proxy: $(cat "$work/out")"; fi
[ "$(got URL)" = "http://proxy.example.internal:3128" ] && ok "compose gets the proxy from .env" || bad "compose got URL=$(got URL)"
[ "$(got USE)" = "1" ] && ok "with a proxy, compose gets NODE_USE_ENV_PROXY=1" || bad "with a proxy, compose got USE=$(got USE)"
[ "$(got NO)" = "langgraph.example.internal,10.1.2.3:8443,$INTERNAL,extra-svc" ] \
  && ok "NO_PROXY is the operator's hosts, loopback, the stack's names and the other listed services" || bad "compose got NO=$(got NO)"
[ -n "$(cat "$CALLS.svcimage" 2>/dev/null)" ] && ok "the service listing gets the images compose needs" || bad "the service listing ran with no CONSOLE_IMAGE"
grep -q 'no proxy of its own' "$work/out" && bad "a daemon with a proxy is warned about" || ok "a daemon with a proxy is not warned about"

: > "$CALLS"
if run up; then ok "up succeeds when the daemon has no proxy"; else bad "up failed when the daemon has no proxy"; fi
grep -q 'no proxy of its own' "$work/out" && ok "a daemon without a proxy is warned about" || bad "a daemon without a proxy is not warned about"
: > "$CALLS"
if run update; then ok "update succeeds with a proxy"; else bad "update failed with a proxy: $(cat "$work/out")"; fi
grep -q 'no proxy of its own' "$work/out" && ok "update warns about the daemon too" || bad "update does not warn about the daemon"
grep -q ' pull' "$CALLS" && ok "update still pulls after the warning" || bad "update did not pull"
: > "$CALLS"; rm -f "$CALLS.env"
if run restart platform; then ok "restart succeeds with a proxy"; else bad "restart failed: $(cat "$work/out")"; fi
[ "$(got URL)" = "http://proxy.example.internal:3128" ] && [ "$(got USE)" = "1" ] \
  && ok "restart recreates with the proxy" || bad "restart recreated with URL=$(got URL) USE=$(got USE)"

# --- the shell never counts ----------------------------------------------------------------------------------------
B="$(bundle shell-only "")"
HTTPS_PROXY=http://user:shellpass@shell-proxy.example.internal:8080 run up || true
[ "$(got URL)" = "" ] && ok "a proxy only the shell sets is not adopted" || bad "the shell's proxy was adopted: $(got URL)"
grep -q 'Your shell sets HTTPS_PROXY' "$work/out" && ok "the shell's proxy gets a notice" || bad "the shell's proxy got no notice"
grep -q shellpass "$work/out" && bad "the shell proxy's password is printed" || ok "the shell proxy's password is masked"
B="$(bundle shell-differs "" "HTTPS_PROXY=http://proxy.example.internal:3128")"
https_proxy=http://other.example.internal:3128 STUB_DAEMON_PROXY=x run up || true
[ "$(got URL)" = "http://proxy.example.internal:3128" ] && ok ".env's proxy beats the shell's" || bad "the shell's proxy won: $(got URL)"
B="$(bundle shell-same "" "HTTPS_PROXY=http://proxy.example.internal:3128")"
HTTPS_PROXY=http://proxy.example.internal:3128 STUB_DAEMON_PROXY=x run up || true
grep -q 'Your shell sets HTTPS_PROXY' "$work/out" && bad "the same value in the shell gets a notice" || ok "the same value in the shell gets no notice"
B="$(bundle shell-and-env-login "" "HTTPS_PROXY=http://user:envpass@proxy.example.internal:3128")"
HTTPS_PROXY='http://u:pa@ss/w@other.example.internal:3128' run up || true
grep -q 'envpass\|pa@ss\|ss/w' "$work/out" && bad "a login in the notice is printed: $(cat "$work/out")" || ok "the notice masks the logins of both, a raw @ and / included"

# --- the login -----------------------------------------------------------------------------------------------------
B="$(bundle login "ci-user:$SECRET_PART" "HTTPS_PROXY=http://proxy.example.internal:3128")"
if STUB_DAEMON_PROXY=x run up; then ok "up succeeds with a proxy login"; else bad "up failed with a login: $(cat "$work/out")"; fi
[ "$(got URL)" = "http://ci-user:$SECRET_PART@proxy.example.internal:3128" ] && ok "the login is added to the URL compose gets" || bad "compose got URL=$(got URL)"
grep -q "$SECRET_PART" "$work/out" && bad "the login is printed" || ok "the login is not printed"
grep -q "$SECRET_PART" "$CALLS" && bad "the login is on an engine command line" || ok "the login is on no command line"
for ui in 'u:p#ss' 'u:p/ss' 'u:p@ss' 'u:p:ss' 'nopassword' 'u:p%2' ':pzq9' 'u:pa$$x'; do
  B="$(bundle "login-bad" "$ui" "HTTPS_PROXY=http://proxy.example.internal:3128")"
  if run up; then bad "the login '$ui' is accepted"; continue; fi
  password="${ui#*:}"
  if [ "$password" != "$ui" ] && [ -n "$password" ] && grep -qF -- "$password" "$work/out"; then
    bad "the refused login '$ui' is printed"
  else
    grep -q 'Percent-encode the user name and the password' "$work/out" && ok "the login '$ui' is refused, without printing it" || bad "the login '$ui' is refused without the fix: $(cat "$work/out")"
  fi
done
# The user name is checked by the same rule, and the message names it too.
for ui in 'us#erq7:pzq9' 'us/erq7:pzq9' 'us erq7:pzq9'; do
  B="$(bundle "login-bad-user" "$ui" "HTTPS_PROXY=http://proxy.example.internal:3128")"
  if run up; then bad "the login '$ui' is accepted"; continue; fi
  if grep -qF -- "${ui%%:*}" "$work/out"; then bad "the refused user name in '$ui' is printed"; continue; fi
  grep -q 'Percent-encode the user name and the password' "$work/out" && ok "the user name in '$ui' is refused, and the fix names the user name" || bad "the login '$ui' is refused without the fix: $(cat "$work/out")"
done
for ui in 'u:p%E9ss' 'u:p%C3' 'u:p%C3%28' 'u:%C0%AF' 'u:%C1%BF' 'u:%E0%80%80' 'u:%ED%A0%80' 'u:%F0%8F%BF%BF' \
  'u:%F4%90%80%80' 'u:%F5%80%80%80' 'u%C3:%A9'; do
  B="$(bundle "login-utf8" "$ui" "HTTPS_PROXY=http://proxy.example.internal:3128")"
  if run up; then bad "the login '$ui', not UTF-8 once decoded, is accepted"; continue; fi
  grep -q 'not UTF-8' "$work/out" && ok "the login '$ui' is refused as not UTF-8" || bad "the login '$ui' is refused without saying why: $(cat "$work/out")"
done
for ui in 'u:p%C3%A9ss' 'u:%E2%82%AC' 'u:%F0%9F%94%91' 'u:%7E%25'; do
  B="$(bundle "login-utf8-ok" "$ui" "HTTPS_PROXY=http://proxy.example.internal:3128")"
  STUB_DAEMON_PROXY=x run up && ok "the UTF-8 login '$ui' is accepted" || bad "the UTF-8 login '$ui' is refused: $(cat "$work/out")"
done
B="$(bundle login-quoted '"u:p"' "HTTPS_PROXY=http://proxy.example.internal:3128")"
run up && bad "a quoted login is accepted" || { grep -q 'without quotes' "$work/out" && ok "a quoted login is refused as quoted" || bad "a quoted login is refused without saying why: $(cat "$work/out")"; }
B="$(bundle login-unused "u:p" )"
run up || true
grep -q 'HTTPS_PROXY_USERINFO .* is not used' "$work/out" && ok "a login with no proxy is warned about" || bad "a login with no proxy is silent"
[ "$(got URL)" = "" ] && ok "a login with no proxy adds no proxy" || bad "a login with no proxy set URL=$(got URL)"

# --- refusals ------------------------------------------------------------------------------------------------------
refused userinfo-in-env "HTTPS_PROXY_USERINFO" "HTTPS_PROXY=http://user:envpass@proxy.example.internal:3128"
grep -q envpass "$work/out" && bad "the refused .env login is printed" || ok "the refused .env login is masked"
refused no-port "needs the proxy's port" "HTTPS_PROXY=http://proxy.example.internal"
refused bad-port "numeric port" "HTTPS_PROXY=http://proxy.example.internal:31x8"
refused big-port "1 to 65535" "HTTPS_PROXY=http://proxy.example.internal:70000"
refused path "nothing after it" "HTTPS_PROXY=http://proxy.example.internal:3128/x"
refused scheme "http://host:port" "HTTPS_PROXY=socks5://proxy.example.internal:1080"
refused loopback "the container itself" "HTTPS_PROXY=http://127.0.0.1:3128"
refused localhost "the container itself" "HTTPS_PROXY=http://localhost:3128"
refused loopback6 "the container itself" "HTTPS_PROXY=http://[::1]:3128"
refused octet "not a valid name or address" "HTTPS_PROXY=http://10.0.0.300:3128"
refused five-octets "not a valid name or address" "HTTPS_PROXY=http://1.2.3.4.5:3128"
refused hex-label "not a valid name or address" "HTTPS_PROXY=http://proxy.0x1f:3128"
refused ipv6-triple "not a valid name or address" "HTTPS_PROXY=http://[:::]:3128"
refused ipv6-short "not a valid name or address" "HTTPS_PROXY=http://[1:2:3]:3128"
refused service-name "one of its own services" "HTTPS_PROXY=http://proxy:3128"
refused db-name "one of its own services" "HTTPS_PROXY=http://db:3128"
refused override-name "one of its own services" "HTTPS_PROXY=http://extra-svc:3128"
refused ipv6-leading "not a valid name or address" "HTTPS_PROXY=http://[:1:2:3:4:5:6:7]:3128"
refused ipv6-trailing "not a valid name or address" "HTTPS_PROXY=http://[1::2:]:3128"
refused octal-octet "not a valid name or address" "HTTPS_PROXY=http://10.0.0.08:3128"
refused punycode "not a valid name or address" "HTTPS_PROXY=http://XN--abc.example:3128"
refused service-case "one of its own services" "HTTPS_PROXY=http://Platform:3128"
refused localhost-case "the container itself" "HTTPS_PROXY=http://LOCALHOST:3128"
refused byodt-key "byodt sets those itself" "BYODT_HTTPS_PROXY=http://proxy.example.internal:3128"
refused cidr "List the hosts" "HTTPS_PROXY=http://proxy.example.internal:3128" "NO_PROXY=10.0.0.0/8"
refused range "List the hosts" "HTTPS_PROXY=http://proxy.example.internal:3128" "NO_PROXY=10.0.0.1-10.0.0.9"
refused wildcard "List the hosts" "HTTPS_PROXY=http://proxy.example.internal:3128" "NO_PROXY=*.example.internal"
refused leading-dot "List the hosts" "HTTPS_PROXY=http://proxy.example.internal:3128" "NO_PROXY=.example.internal"
refused space "commas only" "HTTPS_PROXY=http://proxy.example.internal:3128" "NO_PROXY=\"a.example.internal, b.example.internal\""

# --- warnings ------------------------------------------------------------------------------------------------------
B="$(bundle https-proxy "" "HTTPS_PROXY=https://proxy.example.internal:3129")"
STUB_DAEMON_PROXY=x run up && ok "an https:// proxy is accepted" || bad "an https:// proxy is refused: $(cat "$work/out")"
grep -q 'Most proxies take http://' "$work/out" && ok "an https:// proxy is warned about" || bad "an https:// proxy is not warned about"
B="$(bundle https-proxy-login "u:p" "HTTPS_PROXY=https://proxy.example.internal:3129")"
STUB_DAEMON_PROXY=x run up && ok "an https:// proxy with a login is accepted" || bad "an https:// proxy with a login is refused: $(cat "$work/out")"
grep -q 'Most proxies take http://' "$work/out" && bad "an https:// proxy with a login is warned away from TLS" || ok "an https:// proxy with a login is not warned about"
B="$(bundle http-proxy "" "HTTP_PROXY=http://proxy.example.internal:3128")"
run up || true
grep -q 'HTTP_PROXY in .* is not used' "$work/out" && ok "HTTP_PROXY in .env is warned about" || bad "HTTP_PROXY in .env is silent"
[ "$(got URL)" = "" ] && ok "HTTP_PROXY in .env adds no proxy" || bad "HTTP_PROXY in .env set URL=$(got URL)"
B="$(bundle ipv6 "" "HTTPS_PROXY=http://[2001:db8::1]:3128" "NO_PROXY=[2001:db8::2]:443,2001:db8::3")"
STUB_DAEMON_PROXY=x run up && ok "an IPv6 proxy and NO_PROXY entries are accepted" || bad "IPv6 refused: $(cat "$work/out")"

# --- the CA of a TLS-inspecting proxy ------------------------------------------------------------------------------
B="$(bundle ca "" "HTTPS_PROXY=http://proxy.example.internal:3128")"
mkdir -p "$B/proxy-ca"; printf 'not a real certificate\n' > "$B/proxy-ca/proxy-ca.pem"
STUB_DAEMON_PROXY=x run up || true
[ "$(got CA)" = "/proxy-ca/proxy-ca.pem" ] && ok "NODE_EXTRA_CA_CERTS names the CA file when it exists" || bad "compose got CA=$(got CA)"
[ "$(got CADIR)" = "/proxy-ca" ] && ok "SSL_CERT_DIR names the CA directory when the file exists" || bad "compose got CADIR=$(got CADIR)"
B="$(bundle ca-alone "")"
mkdir -p "$B/proxy-ca"; printf 'not a real certificate\n' > "$B/proxy-ca/proxy-ca.pem"
run up || true
[ "$(got CA)" = "/proxy-ca/proxy-ca.pem" ] && ok "the CA file counts without HTTPS_PROXY (a transparent proxy)" || bad "compose got CA=$(got CA) without a proxy"
B="$(bundle ca-mode "")"
mkdir -m 0700 "$B/proxy-ca"
run up || true
[ "$(stat -c %a "$B/proxy-ca" 2>/dev/null || stat -f %Lp "$B/proxy-ca")" = 700 ] && ok "an existing proxy-ca/ keeps its mode" || bad "an existing proxy-ca/ was chmod'ed"
[ "$(got CADIR)" = "" ] && ok "SSL_CERT_DIR is empty without the CA file" || bad "compose got CADIR=$(got CADIR) without a CA file"
# ca_refused NAME WHAT SETUP: up refuses the proxy-ca/ SETUP leaves, and says WHAT.
ca_refused() {
  B="$(bundle "$1" "")"
  ( cd "$B" && eval "$3" )
  if run up; then bad "$1: up accepted it"; return; fi
  grep -q -- "$2" "$work/out" && ok "$1: refused, saying '$2'" || bad "$1: refused without '$2': $(cat "$work/out")"
}
ca_refused ca-extra-file "holds only proxy-ca.pem" "mkdir proxy-ca && echo x > proxy-ca/proxy-ca.pem && echo x > proxy-ca/root.crt"
ca_refused ca-group-writable "can be changed by other accounts" "mkdir proxy-ca && chmod 0775 proxy-ca"
ca_refused ca-file-writable "can be changed by other accounts" "mkdir proxy-ca && echo x > proxy-ca/proxy-ca.pem && chmod 0666 proxy-ca/proxy-ca.pem"
ca_refused ca-dangling "a symbolic link to nothing" "ln -s ./nowhere proxy-ca"
ca_refused ca-dotdot "holds only proxy-ca.pem" "mkdir proxy-ca && echo x > proxy-ca/proxy-ca.pem && echo x > proxy-ca/..extra.pem"
ca_refused ca-pem-link "symbolic link, which does not resolve" "mkdir proxy-ca && echo x > ca.pem && ln -s ../ca.pem proxy-ca/proxy-ca.pem"
ca_refused ca-pem-private "not readable by every account" "mkdir proxy-ca && echo x > proxy-ca/proxy-ca.pem && chmod 0600 proxy-ca/proxy-ca.pem"
ca_refused ca-to-tls "holds only proxy-ca.pem" "mkdir -p tls && echo x > tls/key.pem && ln -s tls proxy-ca"

# --- commands that stop or inspect run whatever the setting says ---------------------------------------------------
B="$(bundle broken "" "HTTPS_PROXY=http://127.0.0.1:3128")"
run up || true
mkdir -p "$B/mode"; printf 'NODE_ENV=development\n' > "$B/mode/mode.env"
for c in down status logs; do
  : > "$CALLS"
  run "$c" && ok "$c runs with a proxy setting up refuses" || bad "$c refused: $(cat "$work/out")"
done
# The stand-in has no snapshot to copy, so backup and restore stop later on their own: only the proxy check is asserted.
for c in backup "restore nofile"; do
  run $c || true
  grep -q 'HTTPS_PROXY in' "$work/out" && bad "$c checks the proxy setting" || ok "${c%% *} does not check the proxy setting"
done

# --- compose.yaml: who gets what -----------------------------------------------------------------------------------
for svc in console-init platform console; do
  block="$(sed -n "/^  $svc:\$/,/^  [a-z#-]/p" "$SRC/compose.yaml")"
  printf '%s\n' "$block" | grep -q 'HTTPS_PROXY: ${BYODT_HTTPS_PROXY:-}' && printf '%s\n' "$block" | grep -q 'NO_PROXY: ${BYODT_NO_PROXY:-}' \
    && printf '%s\n' "$block" | grep -q 'HTTP_PROXY: ""' && printf '%s\n' "$block" | grep -q './proxy-ca:/proxy-ca:ro' \
    && ok "compose.yaml gives $svc the proxy, an empty HTTP_PROXY and the CA directory" || bad "compose.yaml's $svc lacks the proxy wiring"
done
block="$(sed -n "/^  platform:\$/,/^  [a-z#-]/p" "$SRC/compose.yaml")"
printf '%s\n' "$block" | grep -q 'NODE_USE_ENV_PROXY: ${BYODT_NODE_USE_ENV_PROXY:-}' \
  && ok "compose.yaml gives the platform NODE_USE_ENV_PROXY from byodt" || bad "compose.yaml's platform lacks NODE_USE_ENV_PROXY"
n="$(cat "$SRC/compose.yaml" "$SRC/compose.memgraph.yaml" "$SRC/compose.neo4j.yaml" | grep -c 'NODE_USE_ENV_PROXY:' || true)"
[ "$n" = 1 ] && ok "no other service gets NODE_USE_ENV_PROXY" || bad "NODE_USE_ENV_PROXY is set $n times across the compose files"
for f in compose.yaml compose.memgraph.yaml compose.neo4j.yaml; do
  if grep -q 'PROXY: \${[^B]' "$SRC/$f"; then bad "$f reads a proxy variable byodt does not set"; else ok "$f reads the proxy only from byodt's values"; fi
done
for spec in "compose.yaml proxy" "compose.memgraph.yaml db" "compose.neo4j.yaml db"; do
  read -r file svc <<< "$spec"
  block="$(sed -n "/^  $svc:\$/,/^  [a-z#-]/p" "$SRC/$file")"
  printf '%s\n' "$block" | grep -q 'HTTPS_PROXY: ""' && printf '%s\n' "$block" | grep -q 'NO_PROXY: ""' \
    && ok "$file sets the proxy empty for $svc" || bad "$file does not set the proxy empty for $svc"
done

exit "$fail"
