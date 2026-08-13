#!/usr/bin/env bash
#
# Populate the console's embed tree before `go build`: the noauth schema (generated for
# this version from the platform schema), the ingest corpus for each bundled data module,
# and the built operator SPA. The sources live elsewhere in the oss/ tree; Go's embed
# cannot reach outside the package directory, so they are copied in here. The embed tree is
# gitignored — this script is a build prerequisite, run in CI and before `docker build`.
#
# Requires: node (for the dependency-free schema generator) and pnpm (via `corepack enable`,
# for the SPA build — a self-contained --ignore-workspace package under ui/).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OSS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EMBED="$SCRIPT_DIR/internal/assets/embed"

# Data modules whose data/*.cypher the console ingests. Add a module here (one line) and
# the runtime walk picks it up with no further code.
DATA_MODULES=(mitre-frameworks)

rm -rf "$EMBED"
mkdir -p "$EMBED"

# 1. Noauth schema, generated for this version from the platform's schema.graphql.
node "$OSS_ROOT/scripts/generate-noauth-schema.js"
cp "$OSS_ROOT/apps/dt-ws/schema/schema-noauth.graphql" "$EMBED/schema-noauth.graphql"

# 2. Ingest corpus per data module — .cypher only. The sibling .sql is a Postgres
#    artifact the console does not ingest, and embedding it would bloat the binary.
for mod in "${DATA_MODULES[@]}"; do
  src="$OSS_ROOT/modules/$mod/data"
  if compgen -G "$src/*.cypher" > /dev/null; then
    mkdir -p "$EMBED/data-modules/$mod/data"
    cp "$src"/*.cypher "$EMBED/data-modules/$mod/data/"
  else
    # A declared data module with no .cypher is a build error, not a warning: the schema
    # embed guard would still let the image build with an empty corpus. Fail loudly.
    echo "ERROR: no .cypher files under $src (data module '$mod' is declared required)" >&2
    exit 1
  fi
done

# 3. The operator SPA (Vue 3 + Tailwind 4), a self-contained package under ui/ with its own
#    lockfile. Built here and copied into the embed tree so the daemon serves it from embed.FS
#    (assets.ConsoleUI). --ignore-workspace keeps it out of the monorepo install; --frozen-lockfile
#    makes CI fail on a lockfile that drifted from package.json rather than silently resolving it.
UI_DIR="$SCRIPT_DIR/ui"
pnpm --dir "$UI_DIR" install --ignore-workspace --frozen-lockfile
pnpm --dir "$UI_DIR" build
if [ ! -f "$UI_DIR/dist/index.html" ]; then
  # The daemon's //go:embed of embed/console-ui fails the Go build if this is absent, but a
  # missing index.html here is the earlier and clearer place to say so.
  echo "ERROR: ui/dist/index.html not produced by the SPA build" >&2
  exit 1
fi
mkdir -p "$EMBED/console-ui"
cp -R "$UI_DIR/dist/." "$EMBED/console-ui/"

echo "Populated $EMBED"
