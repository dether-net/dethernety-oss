#!/bin/sh
# render.sh — make a release's get-byodt.sh from get-byodt.sh.in.
#
#   render.sh VERSION BUNDLE-SHA256 ACK-SHA256 NOTICE-TEXT-FILE > get-byodt.sh
#
# VERSION, the two hashes and the repository are written into fixed lines by sed; each is checked first, so none can
# carry a character sed or the shell would read. The notice text, already rendered by the bundle's `byodt notice
# --all`, goes in by awk as the body of a quoted heredoc: printable ASCII only, and no line equal to its end word.
set -eu

[ "$#" = 4 ] || { echo "usage: render.sh VERSION BUNDLE-SHA256 ACK-SHA256 NOTICE-TEXT-FILE" >&2; exit 2; }
version="$1" sha="$2" ack="$3" text="$4"
repo="${BYODT_RELEASE_REPO:-dether-net/dethernety-oss}"
here="$(cd "$(dirname "$0")" && pwd)"
bad() { echo "render.sh: the $1 is not in its expected form" >&2; exit 1; }

# Each value is matched whole by `case`, so a newline in it cannot slip past a line-by-line check.
case "$version" in
  *[!0-9A-Za-z.-]*|'') bad version ;;
esac
printf '%s\n' "$version" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?' || bad version
for h in "$sha" "$ack"; do
  case "$h" in *[!0-9a-f]*) bad hash ;; esac
  [ "${#h}" = 64 ] || bad hash
done
case "$repo" in *[!A-Za-z0-9_./-]*|*/*/*|/*|*/|'') bad repository ;; esac
case "$repo" in */*) ;; *) bad repository ;; esac
[ -r "$text" ] && [ -s "$text" ] || { echo "render.sh: the notice text $text is missing, unreadable or empty" >&2; exit 1; }
[ "$(wc -c < "$text")" -le 16384 ] || { echo "render.sh: the notice text is over 16 KiB" >&2; exit 1; }
if LC_ALL=C grep -q '[^ -~]' "$text"; then echo "render.sh: the notice text holds a character other than printable ASCII" >&2; exit 1; fi
if grep -qx 'BYODT_ACK_END' "$text"; then echo "render.sh: the notice text holds the heredoc's end word" >&2; exit 1; fi

sed -e "s|@VERSION@|$version|g" -e "s|@SHA256@|$sha|g" -e "s|@ACK_SHA256@|$ack|g" -e "s|@REPO@|$repo|g" \
    "$here/get-byodt.sh.in" \
  | NOTICE_FILE="$text" awk '
      $0 == "@ACK_TEXT@" { while ((getline line < ENVIRON["NOTICE_FILE"]) > 0) print line; next }
      { print }'
