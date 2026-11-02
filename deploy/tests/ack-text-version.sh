#!/usr/bin/env bash
# ack-text-version.sh BASE FILE: when FILE, the third-party notice, differs from its version at the commit BASE, its
# first line's Text-Version must be higher than BASE's, since a raised Text-Version is what asks every deployment to
# confirm the notice again. Run from the repository root, with BASE fetched. Used by the CI workflows.
set -euo pipefail
BASE="$1" F="$2"
if ! git cat-file -e "$BASE:$F" 2>/dev/null; then echo "$F is new"; exit 0; fi
if git diff --quiet "$BASE" HEAD -- "$F"; then echo "$F is unchanged"; exit 0; fi
old=$(git show "$BASE:$F" | sed -n '1s/^Text-Version: \([1-9][0-9]*\)$/\1/p')
new=$(git show "HEAD:$F" | sed -n '1s/^Text-Version: \([1-9][0-9]*\)$/\1/p')
if [ -z "$old" ] || [ -z "$new" ] || [ "$new" -le "$old" ]; then
  echo "::error::$F changed: raise its Text-Version above ${old:-its base value} (it is ${new:-unreadable})"
  exit 1
fi
echo "$F changed, and its Text-Version went from $old to $new"
