#!/usr/bin/env bash
# package.sh — package the mitre-frameworks module from committed data.
#
# Bundles the version-controlled Cypher exports (data/*.cypher) + manifest.json
# into dist/mitre-frameworks-<version>.tar.gz, the artefact module-manager
# installs. This is the default `pnpm build` and is what the demos call.
#
# It does NOT regenerate the data. The Cypher files under data/ are the source
# of truth and live in git; regenerate them with `pnpm build:data`
# (scripts/build-data.sh) only when the framework or generation code changes.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log_info "Packaging mitre-frameworks from committed data in $MODULE_DIR/data"

# The committed Cypher exports are the source of truth. If any are missing,
# the working tree is incomplete — regenerate with `pnpm build:data`.
required=(01-attack-nodes.cypher 02-defend-nodes.cypher 03-relationships.cypher)
missing=0
for f in "${required[@]}"; do
    if [[ ! -f "$MODULE_DIR/data/$f" ]]; then
        log_error "Missing committed data file: data/$f"
        missing=1
    fi
done
if [[ "$missing" -ne 0 ]]; then
    log_error "Committed MITRE data is incomplete. Run 'pnpm build:data' to regenerate it."
    exit 1
fi
if [[ ! -f "$MODULE_DIR/data/05-mitre-embeddings.cypher" ]]; then
    log_warn "data/05-mitre-embeddings.cypher absent — packaging without precomputed embeddings."
fi

# Parse version from manifest
VERSION=$(jq -r '.version' "$MODULE_DIR/manifest.json")
PACKAGE_NAME="mitre-frameworks-${VERSION}.tar.gz"
mkdir -p "$MODULE_DIR/dist"
PACKAGE_PATH="$MODULE_DIR/dist/$PACKAGE_NAME"

# Create tarball (manifest.json + committed data only)
log_info "Creating package: $PACKAGE_NAME"
tar -czf "$PACKAGE_PATH" \
    --exclude='.*' \
    --exclude='scripts' \
    --exclude='dist' \
    --exclude='node_modules' \
    -C "$MODULE_DIR" \
    manifest.json \
    data

PACKAGE_SIZE=$(du -h "$PACKAGE_PATH" | cut -f1)
log_info "Package created: $PACKAGE_PATH ($PACKAGE_SIZE)"

log_info "Package contents:"
tar -tzf "$PACKAGE_PATH"

log_info "Packaging complete!"
