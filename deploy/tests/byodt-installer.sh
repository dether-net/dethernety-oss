#!/usr/bin/env bash
# Pins get-byodt.sh, the per-release installer, by rendering it the way the release does (render.sh, with the notice
# from the bundle's own `byodt notice --all`) for a fixture release built from this tree, and running it under dash
# and bash with stand-in curl, docker and cosign on PATH; nothing is downloaded and no container engine runs.
#
#   - the notice is shown and confirmed before anything is downloaded: --yes, or a y at a terminal; without either,
#     refused with nothing downloaded;
#   - every download is HTTPS only and capped in size;
#   - the bundle is used only when its SHA-256 is the one written in, and, with cosign, when its signature verifies;
#     without cosign a warning, and --require-signature refuses; a failed check leaves nothing behind;
#   - an unattended upgrade refuses a bundle cosign did not verify unless --allow-unsigned, and
#     UPGRADE_REQUIRE_SIGNATURE=true in the deployment's .env refuses --allow-unsigned; false or empty counts as unset,
#     and any other value stops the upgrade;
#   - entries outside byodt-<version>/, unsafe names and links are refused even with a matching hash;
#   - a fresh install unpacks into ./byodt (or --dir) and hands over to `byodt setup`, with the notice's hand-over and
#     the proxy URL without its login; the login travels only in the environment, and never in an argument; a login
#     given in --https-proxy is refused;
#   - an existing folder, a parent other accounts can write to, or a second deployment are refused or named; a
#     deployment already on this release, or with an upgrade half done, is told so, with nothing downloaded;
#   - a database volume an earlier deployment left is named (by setup), and the install goes on;
#   - a script cut short runs nothing;
#   - the npm package's bin runs the installer it carries, and passes on its exit status.
#
#   bash deploy/tests/byodt-installer.sh
set -euo pipefail

# No test may reach the network: stand-ins for curl, wget and cosign that fail loudly come before the system's.
export PATH="$(cd "$(dirname "$0")" && pwd)/no-network:$PATH"

if ! command -v python3 >/dev/null 2>&1; then echo "SKIP byodt-installer: python3 drives the terminal and is not installed"; exit 0; fi

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/../compose" && pwd)"
INSTALLER="$(cd "$HERE/../installer" && pwd)"
DRIVER="$HERE/tty-driver.py"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
CALLS="$work/calls"
export CALLS

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; sed 's/^/     | /' "$work/out" | tail -12; fi; }
sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# --- a fixture release, 9.9.9, built from this tree as the release workflow builds it -----------------------------------
V=9.9.9
REL="$work/release"
mkdir -p "$REL/src/byodt-$V"
( cd "$SRC" && cp -R byodt compose.yaml compose.memgraph.yaml compose.neo4j.yaml .env.example THIRD-PARTY-ACKNOWLEDGEMENT \
    NOTICE LICENSE README.md proxy .gitignore "$REL/src/byodt-$V/" )
sed -i.bak "s/^PLATFORM_VERSION=.*/PLATFORM_VERSION=$V/" "$REL/src/byodt-$V/.env.example" && rm "$REL/src/byodt-$V/.env.example.bak"
( cd "$REL/src" && COPYFILE_DISABLE=1 tar -czf "$REL/byodt-$V.tar.gz" "byodt-$V" )
( cd "$REL/src/byodt-$V" && env -i PATH="$PATH" ./byodt notice --all ) > "$REL/notice.txt"
ACK_SHA="$(sha_of "$REL/src/byodt-$V/THIRD-PARTY-ACKNOWLEDGEMENT")"
# render NAME TARBALL: renders the installer for TARBALL's hash into $REL/NAME.
render() { BYODT_RELEASE_REPO=example/repo sh "$INSTALLER/render.sh" "$V" "$(sha_of "$2")" "$ACK_SHA" "$REL/notice.txt" > "$REL/$1"; }
render get-byodt.sh "$REL/byodt-$V.tar.gz"
printf 'sigstore bundle\n' > "$REL/byodt-$V.tar.gz.bundle"

# --- stand-ins -----------------------------------------------------------------------------------------------------------
mkdir -p "$work/bin" "$work/cosign-ok" "$work/cosign-bad" "$work/nonet"
# The installer's PATH is built explicitly: this test's curl (which serves the fixtures), a wget that fails loudly, and
# no cosign unless a case adds one, since whether cosign is installed is what several cases are about.
cp "$HERE/no-network/wget" "$work/nonet/wget"
# The rest of the installer's PATH is a folder of links to exactly the tools it and setup use, so a real cosign, podman,
# docker, curl or wget installed beside them in /usr/bin is never reached.
mkdir -p "$work/tools"
for t in sh dash bash env cat sed awk grep tar gzip cut tr sort head tail wc mktemp mkdir chmod chown cp mv rm rmdir \
         find stat id uname dirname basename ls date python3 sha256sum shasum cmp od touch ln readlink perl printf true \
         false test sleep diff xargs node; do
  p="$(command -v "$t" 2>/dev/null || true)"
  case "$p" in /*) ln -s "$p" "$work/tools/$t" ;; esac
done
cat > "$work/bin/curl" <<'SHIM'
#!/usr/bin/env bash
# Serves the fixture release for https://github.com/example/repo/releases/download/v9.9.9/<file>; records its arguments
# and the proxy it was given.
printf '%s\n' "$*" >> "$CALLS.curl"; printf 'https_proxy=%s\n' "${https_proxy:-}" >> "$CALLS.curlenv"
out=""; url=""; while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; --max-filesize) shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
case "$url" in https://github.com/example/repo/releases/download/v9.9.9/*) f="$REL/${url##*/}" ;; *) exit 22 ;; esac
# STUB_BIG serves a bundle one byte over the size the installer accepts.
if [ -n "${STUB_BIG:-}" ]; then case "$url" in *.tar.gz) head -c 52428801 /dev/zero; exit 0 ;; esac; fi
[ -f "$f" ] || exit 22
if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi
SHIM
cat > "$work/bin/docker" <<'SHIM'
#!/usr/bin/env bash
[ "$1 $2" = "compose version" ] && exit 0
[ "$1 $2" = "image inspect" ] && exit 1
if [ "$1" = info ]; then echo "Ubuntu"; exit 0; fi
if [ "$1" = compose ] && [[ " $* " == *" config --services "* ]]; then printf '%s\n' db console-init platform proxy console; exit 0; fi
if [ "$1" = ps ]; then for id in ${STUB_IDS:-}; do echo "$id"; done; exit 0; fi
if [ "$1" = inspect ]; then id="${!#}"; var="STUB_WD_$id"; printf '%s\n' "${!var:-<no value>}"; exit 0; fi
if [ "$1 $2" = "volume inspect" ]; then for v in ${STUB_VOLUMES:-}; do [ "$v" = "$3" ] && exit 0; done; exit 1; fi
printf '%s\n' "$*" >> "$CALLS.docker"
exit 0
SHIM
# The accepting cosign checks it is asked about the release workflow at this exact tag, with GitHub Actions as the
# issuer, as the installer must ask.
cat > "$work/cosign-ok/cosign" <<'SHIM'
#!/bin/sh
case " $* " in *" --certificate-identity https://github.com/example/repo/.github/workflows/release.yml@refs/tags/v9.9.9 "*)
  case " $* " in *" --certificate-oidc-issuer https://token.actions.githubusercontent.com "*) exit 0 ;; esac ;;
esac
echo "cosign stand-in: unexpected identity or issuer in: $*" >&2; exit 1
SHIM
printf '#!/bin/sh\nexit 1\n' > "$work/cosign-bad/cosign"
chmod +x "$work/bin/curl" "$work/bin/docker" "$work/cosign-ok/cosign" "$work/cosign-bad/cosign"
export REL
unset HTTPS_PROXY https_proxy STUB_IDS DB_ENGINE CONTAINER_ENGINE 2>/dev/null || true

n=0
# place: a fresh, empty working directory in $P (where the operator runs the installer).
place() { n=$((n + 1)); P="$work/p$n"; mkdir -p "$P"; chmod 0755 "$P"; : > "$CALLS.curl"; : > "$CALLS.curlenv"; }
# inst SH [EXTRA-PATH] -- ARGS…: runs the rendered installer under SH in $P with no terminal; output in $work/out.
inst() {
  local sh="$1" extra="$2"; shift 3
  rc=0
  ( cd "$P" && PATH="${extra:+$extra:}$work/bin:$work/nonet:$work/tools" python3 -I "$DRIVER" notty 60 -- "$sh" "$REL/get-byodt.sh" "$@" ) \
    > "$work/out" 2>&1 || rc=$?
}
downloaded() { [ -s "$CALLS.curl" ]; }
nothing_left() { [ -z "$(ls -A "$P")" ]; }

SHELLS="bash"
command -v dash >/dev/null 2>&1 && SHELLS="dash bash"
for SH in $SHELLS; do
  SHP="$(command -v "$SH")"
  echo "--- under $SH"

  place; inst "$SHP" "" -- --yes
  check "$SH: --yes downloads, verifies, unpacks into ./byodt, and hands over to setup with the notice already confirmed" \
    '[ "$rc" = 0 ] && downloaded && [ -x "$P/byodt/byodt" ] && grep -q "THIRD-PARTY SOFTWARE" "$work/out" \
     && grep -q "SHA-256 matches" "$work/out" && grep -q "cosign is not installed" "$work/out" \
     && grep -qx "DB_ENGINE=memgraph" "$P/byodt/.env" && tail -n 1 "$P/byodt/third-party-acknowledgement.log" | grep -q "via=handover-yes" \
     && [ "$(grep -c "THIRD-PARTY SOFTWARE" "$work/out")" = 1 ] && [ -z "$(ls -A "$P" | grep -v "^byodt$")" ]'
  check "$SH: every download is HTTPS only, and capped in size" \
    '! grep -qv -- "--proto =https" "$CALLS.curl" && ! grep -qv -- "--max-filesize 52428800" "$CALLS.curl"'

  place; inst "$SHP" "" --
  check "$SH: no terminal and no --yes: the notice is refused before anything is downloaded" \
    '[ "$rc" != 0 ] && [ "$rc" != 124 ] && grep -q "no terminal to confirm" "$work/out" && ! downloaded && nothing_left'

  place; inst "$SHP" "" -- --yes --dir "$P/elsewhere" --db neo4j --port 3443
  check "$SH: --dir, and options for setup passed through" \
    '[ "$rc" = 0 ] && grep -qx "DB_ENGINE=neo4j" "$P/elsewhere/.env" && grep -qx "FRONT_DOOR_PORT=3443" "$P/elsewhere/.env"'

  place; inst "$SHP" "$work/cosign-ok" -- --yes
  check "$SH: with cosign, the signature is verified too" '[ "$rc" = 0 ] && grep -q "Signature verified" "$work/out"'
  place; inst "$SHP" "$work/cosign-bad" -- --yes
  check "$SH: a signature cosign refuses stops the install, with nothing left behind" \
    '[ "$rc" != 0 ] && grep -q "could not verify" "$work/out" && nothing_left'
  place; inst "$SHP" "" -- --yes --require-signature
  check "$SH: --require-signature without cosign refuses" \
    '[ "$rc" != 0 ] && grep -q "A signature is required, but cosign is not installed" "$work/out" && nothing_left'

  place; cp "$REL/byodt-$V.tar.gz" "$P/tampered.tar.gz"; printf 'x' >> "$P/tampered.tar.gz"
  inst "$SHP" "" -- --yes --tarball "$P/tampered.tar.gz"
  check "$SH: a bundle with another SHA-256 is not used, and nothing is left behind" \
    '[ "$rc" != 0 ] && grep -q "was not used" "$work/out" && [ "$(ls -A "$P")" = tampered.tar.gz ]'

  place; inst "$SHP" "" -- --yes --tarball "$REL/byodt-$V.tar.gz"
  check "$SH: --tarball installs from a local file, checked the same way, with no download" \
    '[ "$rc" = 0 ] && ! downloaded && [ -x "$P/byodt/byodt" ]'
  place; cp "$REL/byodt-$V.tar.gz" "$work/lonely.tgz"; inst "$SHP" "$work/cosign-ok" -- --yes --tarball "$work/lonely.tgz"
  check "$SH: with cosign, a --tarball with no .bundle beside it is never followed by a download: a warning instead" \
    '[ "$rc" = 0 ] && ! downloaded && grep -q "its signature was not" "$work/out"'
  place; inst "$SHP" "$work/cosign-ok" -- --yes --require-signature --tarball "$work/lonely.tgz"
  check "$SH: ... and --require-signature refuses it" \
    '[ "$rc" != 0 ] && grep -q "A signature is required, but there is no .*lonely.tgz.bundle" "$work/out" && ! downloaded && nothing_left'
  place; cp "$REL/byodt-$V.tar.gz" "$P/local.tgz"; cp "$REL/byodt-$V.tar.gz.bundle" "$P/local.tgz.bundle"
  inst "$SHP" "$work/cosign-ok" -- --yes --tarball "$P/local.tgz"
  check "$SH: with cosign, a --tarball with its .bundle beside it is verified, with no download" \
    '[ "$rc" = 0 ] && ! downloaded && grep -q "Signature verified" "$work/out"'

  place; STUB_BIG=1 inst "$SHP" "" -- --yes
  check "$SH: a download larger than a release's file can be is refused, with nothing left behind" \
    '[ "$rc" != 0 ] && grep -q "larger than a release.s file is" "$work/out" && nothing_left'

  place; mkdir "$P/byodt"; inst "$SHP" "" -- --yes
  check "$SH: an existing folder is refused" \
    '[ "$rc" != 0 ] && grep -q "already exists" "$work/out" && ! downloaded'

  place; mkdir "$P/open"; chmod 0777 "$P/open"; inst "$SHP" "" -- --yes --dir "$P/open/byodt"
  check "$SH: a parent other accounts can write to is refused" '[ "$rc" != 0 ] && grep -q "Other accounts can change" "$work/out" && ! downloaded'

  place; HTTPS_PROXY='http://alice:s3cr%23t@proxy.corp.example:3128' inst "$SHP" "" -- --yes
  check "$SH: the shell's proxy is used for the download, through curl's environment, never in an argument" \
    '[ "$rc" = 0 ] && grep -q "https_proxy=http://alice:s3cr%23t@proxy.corp.example:3128" "$CALLS.curlenv" \
     && ! grep -q "s3cr" "$CALLS.curl" && ! grep -q "s3cr" "$work/out" && grep -q "through http://\*\*\*@proxy.corp.example:3128" "$work/out"'
  check "$SH: setup gets the proxy URL without the login, and --yes alone does not save the login" \
    'grep -qx "HTTPS_PROXY=http://proxy.corp.example:3128" "$P/byodt/.env" && [ ! -e "$P/byodt/.env.secrets" ]'
  place; inst "$SHP" "" -- --yes --https-proxy 'http://alice:s3cr%23t@proxy.corp.example:3128'
  check "$SH: a login given in --https-proxy is refused before anything is downloaded" \
    '[ "$rc" != 0 ] && grep -q "without a login" "$work/out" && ! downloaded && nothing_left && ! grep -q "s3cr" "$work/out"'
  place; HTTPS_PROXY='http://alice:s3cr%23t@proxy.corp.example:3128' inst "$SHP" "" -- --yes --proxy-login-from-env
  check "$SH: with --proxy-login-from-env, setup saves the login it was handed" \
    '[ "$rc" = 0 ] && grep -qx "HTTPS_PROXY_USERINFO=alice:s3cr%23t" "$P/byodt/.env.secrets"'

  # A database volume an earlier deployment left: setup names it, with how to use or remove it, and the install goes on.
  place; STUB_VOLUMES=dethernety_memgraph-data inst "$SHP" "" -- --yes
  check "$SH: a database volume an earlier deployment left is named once, with how to use or remove it; the install goes on" \
    '[ "$rc" = 0 ] && [ -x "$P/byodt/byodt" ] && [ "$(grep -c "volume dethernety_memgraph-data remains" "$work/out")" = 1 ] \
     && grep -q "docker volume rm dethernety_memgraph-data. (this deletes it for good)" "$work/out" && ! grep -q "volume rm" "$CALLS.docker"'

  # A deployment found beside it, with no terminal and no --upgrade: named, and nothing installed or changed.
  place; mkdir -p "$P/byodt-0.13.0"; cp "$SRC/.env.example" "$P/byodt-0.13.0/"; : > "$P/byodt-0.13.0/byodt"; printf 'NEO4J_PASSWORD=x\n' > "$P/byodt-0.13.0/.env.secrets"
  ( cd "$P/byodt-0.13.0" && ls -la ) > "$work/before"
  inst "$SHP" "" -- --yes
  check "$SH: a deployment beside it is not upgraded without --upgrade: refused, nothing installed, it left untouched" \
    '[ "$rc" != 0 ] && grep -q "There is a deployment in $(cd "$P/byodt-0.13.0" && pwd -P)" "$work/out" && ! downloaded \
     && [ ! -e "$P/byodt" ] && ( cd "$P/byodt-0.13.0" && ls -la ) | cmp -s - "$work/before"'
  # A deployment that already runs this release is not offered as an upgrade; one with an upgrade half done is left to
  # its own byodt; one that was never started is pointed to its `byodt up`.
  place; mkdir -p "$P/byodt-$V/mode"; cp "$REL/src/byodt-$V/.env.example" "$P/byodt-$V/"; : > "$P/byodt-$V/byodt"; : > "$P/byodt-$V/.env.secrets"
  ( cd "$P/byodt-$V" && ls -la ) > "$work/before"
  inst "$SHP" "" -- --yes --upgrade
  check "$SH: a deployment already on this release but never started (no database password) is pointed to its byodt up" \
    '[ "$rc" != 0 ] && grep -q "has not been started yet; .*/byodt-$V/byodt up. starts it. To install another one" "$work/out" \
     && ! grep -q "byodt update" "$work/out" && ! downloaded && ( cd "$P/byodt-$V" && ls -la ) | cmp -s - "$work/before"'
  : > "$P/byodt-$V/.env"; printf 'NEO4J_PASSWORD=x\n' > "$P/byodt-$V/.env.secrets"; inst "$SHP" "" -- --yes --upgrade
  check "$SH: with a .env and a password but no mode layer it has still not started: pointed to byodt up" \
    '[ "$rc" != 0 ] && grep -q "has not been started yet" "$work/out" && ! downloaded'
  : > "$P/byodt-$V/mode/mode.env"
  ( cd "$P/byodt-$V" && ls -la ) > "$work/before"
  inst "$SHP" "" -- --yes --upgrade
  check "$SH: a deployment already on this release is refused as such, with --upgrade too, and left untouched" \
    '[ "$rc" != 0 ] && grep -q "already runs release $V; .*/byodt-$V/byodt update. applies it again. To install another one" "$work/out" \
     && ! downloaded && ( cd "$P/byodt-$V" && ls -la ) | cmp -s - "$work/before"'
  : > "$P/byodt-$V/.byodt-upgrade.state"; ( cd "$P/byodt-$V" && ls -la ) > "$work/before"; inst "$SHP" "" -- --yes --upgrade
  check "$SH: an upgrade half done there is left to that deployment's own byodt, with nothing downloaded or changed" \
    '[ "$rc" != 0 ] && grep -q "An upgrade is half done in .*/byodt-$V/byodt upgrade. goes on with it" "$work/out" \
     && ! downloaded && ( cd "$P/byodt-$V" && ls -la ) | cmp -s - "$work/before"'
  # On another release, an upgrade half done there (an earlier installer's) goes on to the hand-over, which takes it over.
  place; mkdir -p "$P/byodt"; cp "$SRC/.env.example" "$P/byodt/"; : > "$P/byodt/byodt"; : > "$P/byodt/.env.secrets"
  : > "$P/byodt/.byodt-upgrade.state"; inst "$SHP" "" -- --yes --upgrade --allow-unsigned
  check "$SH: a deployment on another release with an upgrade half done is still handed over, not refused" \
    'grep -q "Handing over to release $V" "$work/out" && ! grep -q "An upgrade is half done" "$work/out"'
  place; mkdir -p "$P/byodt"; cp "$SRC/.env.example" "$P/byodt/"; : > "$P/byodt/byodt"; cp "$SRC/.env.example" "$P/byodt/.env"
  inst "$SHP" "" -- --yes
  check "$SH: a set-up but never-started folder (a .env, no .env.secrets) counts as a deployment" \
    '[ "$rc" != 0 ] && grep -q "There is a deployment in" "$work/out" && ! downloaded'
  place; mkdir -p "$P/a" "$P/b"; for d in a b; do cp "$SRC/.env.example" "$P/$d/"; : > "$P/$d/byodt"; : > "$P/$d/.env.secrets"; done
  mv "$P/a" "$P/byodt-a"; mv "$P/b" "$P/byodt-b"; inst "$SHP" "" -- --yes --upgrade
  check "$SH: two deployments found and --upgrade: refused, naming both" '[ "$rc" != 0 ] && grep -q "More than one deployment" "$work/out" && ! downloaded'
  inst "$SHP" "" -- --yes --upgrade --dir "$P/elsewhere"
  check "$SH: --dir names the only place looked at: --upgrade with no deployment there is refused, the others ignored" \
    '[ "$rc" != 0 ] && grep -q "no deployment was found in $P/elsewhere" "$work/out" && ! downloaded'
  place; mkdir -p "$P/srv/dep"; cp "$SRC/.env.example" "$P/srv/dep/"; : > "$P/srv/dep/byodt"; : > "$P/srv/dep/.env.secrets"
  STUB_IDS=c1 STUB_WD_c1="$P/srv/dep" inst "$SHP" "" -- --yes
  check "$SH: a deployment the container engine knows, in another folder, is found too" \
    '[ "$rc" != 0 ] && grep -q "There is a deployment in $(cd "$P/srv/dep" && pwd -P)" "$work/out" && ! downloaded'
  if [ "$(id -gn)" != "$(id -un)" ]; then
    chmod 0775 "$P/srv/dep"; STUB_IDS=c1 STUB_WD_c1="$P/srv/dep" inst "$SHP" "" -- --yes --upgrade
    check "$SH: a deployment other accounts can change is not acted on" \
      '[ "$rc" != 0 ] && grep -q "this script does not act on it" "$work/out" && ! downloaded'
  fi
  place; mkdir -p "$P/byodt"; cp "$SRC/.env.example" "$P/byodt/"; : > "$P/byodt/byodt"; : > "$P/byodt/.env.secrets"
  inst "$SHP" "" -- --yes --upgrade
  check "$SH: an unattended upgrade with a bundle cosign did not verify is refused before the hand-over, naming both ways on" \
    '[ "$rc" != 0 ] && grep -q "Install cosign" "$work/out" && grep -q -- "--allow-unsigned" "$work/out" \
     && ! grep -q "Handing over" "$work/out" && ! ls -d "$P"/byodt/.byodt-upgrade.* >/dev/null 2>&1'
  printf 'UPGRADE_REQUIRE_SIGNATURE="True"\n' > "$P/byodt/.env"; : > "$CALLS.curl"; inst "$SHP" "" -- --yes --upgrade --allow-unsigned
  check "$SH: UPGRADE_REQUIRE_SIGNATURE=true in the deployment's .env refuses --allow-unsigned, before any download" \
    '[ "$rc" != 0 ] && grep -q "so --allow-unsigned does not apply" "$work/out" && ! downloaded \
     && ! ls -d "$P"/byodt/.byodt-upgrade.* >/dev/null 2>&1'
  inst "$SHP" "" -- --yes --upgrade
  check "$SH: ... and makes a signature required" \
    '[ "$rc" != 0 ] && grep -q "A signature is required, but cosign is not installed" "$work/out" && ! ls -d "$P"/byodt/.byodt-upgrade.* >/dev/null 2>&1'
  printf 'UPGRADE_REQUIRE_SIGNATURE=yes\n' > "$P/byodt/.env"; : > "$CALLS.curl"; inst "$SHP" "" -- --yes --upgrade --allow-unsigned
  check "$SH: UPGRADE_REQUIRE_SIGNATURE neither true nor false stops the upgrade, before any download" \
    '[ "$rc" != 0 ] && grep -qF "$(cd "$P/byodt" && pwd -P)/.env sets UPGRADE_REQUIRE_SIGNATURE=yes, which is neither true nor false. Nothing was changed." "$work/out" \
     && ! downloaded && ! ls -d "$P"/byodt/.byodt-upgrade.* >/dev/null 2>&1'
  for unset_value in FALSE ""; do
    printf 'UPGRADE_REQUIRE_SIGNATURE=%s\n' "$unset_value" > "$P/byodt/.env"; inst "$SHP" "" -- --yes --upgrade
    check "$SH: UPGRADE_REQUIRE_SIGNATURE=$unset_value counts as unset: no signature required, the unattended rule applies" \
      '[ "$rc" != 0 ] && grep -q "an unattended upgrade does not run code it cannot verify" "$work/out" \
       && ! grep -q "A signature is required\|neither true nor false" "$work/out" && ! ls -d "$P"/byodt/.byodt-upgrade.* >/dev/null 2>&1'
  done
  if [ "$(id -u)" != 0 ]; then
    printf 'X=1\n' > "$P/byodt/.env"; chmod 000 "$P/byodt/.env"; : > "$CALLS.curl"; inst "$SHP" "" -- --yes --upgrade --allow-unsigned
    check "$SH: a .env it cannot read stops the upgrade, since it could require a signature" \
      '[ "$rc" != 0 ] && grep -q "Cannot read .*may require a signature" "$work/out" && ! downloaded'
    chmod 600 "$P/byodt/.env"
  fi
  rm -f "$P/byodt/.env"; inst "$SHP" "" -- --yes --upgrade --allow-unsigned
  # The deployment here has only a .env.secrets, so the new release's upgrade refuses at its first check of the
  # deployment; what matters here is that the installer staged it inside the deployment and handed over, and that the
  # refusal leaves nothing staged behind.
  check "$SH: --upgrade stages the release inside the deployment and hands over to its own byodt upgrade" \
    'grep -q "Handing over to release 9.9.9" "$work/out" && grep -q "byodt does not upgrade it. Nothing was changed" "$work/out" \
     && ! ls -d "$P"/byodt/.byodt-upgrade.* >/dev/null 2>&1'
  inst "$SHP" "" -- --yes --upgrade --allow-unsigned --no-such-option
  check "$SH: an option the new release refuses names the deployment's own byodt, and leaves nothing staged" \
    '[ "$rc" != 0 ] && grep -q "Unknown option for upgrade: --no-such-option (see .$(cd "$P/byodt" && pwd -P)/byodt upgrade --help.)" "$work/out" \
     && ! ls -d "$P"/byodt/.byodt-upgrade.* >/dev/null 2>&1'

  place; inst "$SHP" "" -- --yes --no-start
  rm -f "$P/byodt/.env" "$P/byodt/third-party-acknowledgement.log"
  : > "$CALLS.curl"; inst "$SHP" "" -- --yes
  check "$SH: a re-run into its own unpacked, never set up folder is refused too, naming what to do" \
    '[ "$rc" != 0 ] && grep -q "already exists" "$work/out" && grep -q "can be removed" "$work/out" && ! downloaded'

  place; NO_PROXY='10.0.0.0/8,.corp.example' inst "$SHP" "" -- --yes
  check "$SH: the shell's NO_PROXY is not carried into the new deployment" '[ "$rc" = 0 ] && ! grep -q "^NO_PROXY=" "$P/byodt/.env"'
done

# --- tarballs with a matching hash that must still be refused ----------------------------------------------------------
refused=1
for kind in dotdot outside link; do
  rm -rf "$work/evil"; mkdir -p "$work/evil/byodt-$V"; cp "$SRC/byodt" "$work/evil/byodt-$V/"
  case "$kind" in
    # GNU tar strips a name's `..` when it writes it, and BSD tar does not; python's tarfile keeps it on both.
    dotdot)  : > "$work/evil/x"; why="holds an unexpected name"
             python3 -I -c 'import sys, tarfile
with tarfile.open(sys.argv[1], "w:gz") as t:
    t.add(sys.argv[2], arcname=sys.argv[3]); t.add(sys.argv[4], arcname=sys.argv[5])' \
               "$work/evil.tgz" "$work/evil/byodt-$V/byodt" "byodt-$V/byodt" "$work/evil/x" "byodt-$V/sub/../sub/x" ;;
    outside) : > "$work/evil/stray"; why="an entry outside byodt-$V/"; ( cd "$work/evil" && COPYFILE_DISABLE=1 tar -czf "$work/evil.tgz" "byodt-$V" stray ) ;;
    link)    ln -s /etc/passwd "$work/evil/byodt-$V/passwd"; why="a link or a special file"; ( cd "$work/evil" && COPYFILE_DISABLE=1 tar -czf "$work/evil.tgz" "byodt-$V" ) ;;
  esac
  render get-evil.sh "$work/evil.tgz"
  place; rc=0
  ( cd "$P" && PATH="$work/bin:$work/nonet:$work/tools" python3 -I "$DRIVER" notty 60 -- bash "$REL/get-evil.sh" --yes --tarball "$work/evil.tgz" ) > "$work/out" 2>&1 || rc=$?
  if [ "$rc" != 0 ] && grep -qF "$why" "$work/out" && grep -q "was not used" "$work/out" && nothing_left; then :
  else bad "refuses a bundle with $kind entries, saying why"; refused=0; sed 's/^/     | /' "$work/out" | tail -4; fi
done
[ "$refused" = 0 ] || ok "a bundle whose hash matches but holds .., an entry outside byodt-$V/, or a link is refused, leaving nothing"

# --- at a terminal ----------------------------------------------------------------------------------------------------
place; rc=0
( cd "$P" && PATH="$work/bin:$work/nonet:$work/tools" python3 -I "$DRIVER" tty 60 "Continue?" n -- bash "$REL/get-byodt.sh" ) > "$work/out" 2>&1 || rc=$?
check "at a terminal, a no to the notice downloads nothing" '[ "$rc" != 0 ] && grep -q "Not confirmed" "$work/out" && ! downloaded && nothing_left'
place; mkdir -p "$P/byodt"; cp "$SRC/.env.example" "$P/byodt/"; : > "$P/byodt/byodt"; : > "$P/byodt/.env.secrets"; rc=0
( cd "$P" && PATH="$work/bin:$work/nonet:$work/tools" python3 -I "$DRIVER" tty 60 "Upgrade the deployment" n -- bash "$REL/get-byodt.sh" ) > "$work/out" 2>&1 || rc=$?
check "at a terminal, a no to the upgrade stops, with nothing downloaded or installed" \
  '[ "$rc" != 0 ] && grep -q "Nothing was changed" "$work/out" && ! downloaded && ! ls -d "$P"/byodt/.byodt-upgrade.* >/dev/null 2>&1'

# --- a script cut short --------------------------------------------------------------------------------------------------
size="$(wc -c < "$REL/get-byodt.sh" | tr -d ' ')"
ran=0
for cut in 200 1500 4000 $((size / 2)) $((size - 20)); do
  head -c "$cut" "$REL/get-byodt.sh" > "$work/cut.sh"
  place
  ( cd "$P" && PATH="$work/bin:$work/nonet:$work/tools" sh "$work/cut.sh" --yes ) > "$work/out" 2>&1 || true
  if downloaded || ! nothing_left; then bad "a script cut at $cut bytes ran"; ran=1; fi
done
[ "$ran" = 1 ] || ok "a script cut short anywhere runs nothing"

# --- the npm package: its bin runs the carried installer --------------------------------------------------------------
if [ -x "$work/tools/node" ]; then
  NPMPKG="$work/npm-pkg"; mkdir -p "$NPMPKG/bin"
  cp "$INSTALLER/npm/bin/byodt.mjs" "$NPMPKG/bin/" && cp "$INSTALLER/npm/lib.mjs" "$INSTALLER/npm/package.json" "$NPMPKG/"
  cp "$REL/get-byodt.sh" "$NPMPKG/"
  place; rc=0
  ( cd "$P" && PATH="$work/bin:$work/nonet:$work/tools" python3 -I "$DRIVER" notty 60 -- node "$NPMPKG/bin/byodt.mjs" --yes ) > "$work/out" 2>&1 || rc=$?
  check "the npm package's bin runs the release's own installer, which installs and hands over to setup" \
    '[ "$rc" = 0 ] && downloaded && [ -x "$P/byodt/byodt" ] && grep -qx "DB_ENGINE=memgraph" "$P/byodt/.env"'
  place; rc=0
  ( cd "$P" && PATH="$work/bin:$work/nonet:$work/tools" python3 -I "$DRIVER" notty 60 -- node "$NPMPKG/bin/byodt.mjs" ) > "$work/out" 2>&1 || rc=$?
  check "... and passes on the installer's refusal and exit status" '[ "$rc" = 1 ] && grep -q "no terminal to confirm" "$work/out" && ! downloaded'
else
  echo "skip the npm package's bin: node is not installed"
fi

# --- the rendering -------------------------------------------------------------------------------------------------------
check "the rendered script pins the version, the bundle's hash and the notice's hash on their own lines" \
  'grep -qx "BYODT_VERSION_PIN=$V" "$REL/get-byodt.sh" && grep -qx "BYODT_SHA256_PIN=$(sha_of "$REL/byodt-$V.tar.gz")" "$REL/get-byodt.sh" \
   && grep -qx "BYODT_ACK_SHA256_PIN=$ACK_SHA" "$REL/get-byodt.sh" && sh -n "$REL/get-byodt.sh"'
awk '/^  cat <<.BYODT_ACK_END.$/ { on = 1; next } /^BYODT_ACK_END$/ { on = 0 } on' "$REL/get-byodt.sh" > "$work/embedded.txt"
check "the embedded notice is, byte for byte, what the bundle's byodt notice --all prints" 'cmp -s "$work/embedded.txt" "$REL/notice.txt"'
printf 'BYODT_ACK_END\n' > "$work/bad-notice.txt"
check "render.sh refuses a notice holding the heredoc's end word" \
  '! sh "$INSTALLER/render.sh" "$V" "$(sha_of "$REL/byodt-$V.tar.gz")" "$ACK_SHA" "$work/bad-notice.txt" >/dev/null 2>&1'
check "render.sh refuses a version or hash outside their grammar" \
  '! sh "$INSTALLER/render.sh" "9.9.9;x" "$ACK_SHA" "$ACK_SHA" "$REL/notice.txt" >/dev/null 2>&1 && ! sh "$INSTALLER/render.sh" "$V" "abc" "$ACK_SHA" "$REL/notice.txt" >/dev/null 2>&1'

if [ "$fail" = 0 ]; then echo "PASS byodt-installer"; else echo "FAILED byodt-installer"; exit 1; fi
