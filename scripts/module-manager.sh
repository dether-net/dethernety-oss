#!/usr/bin/env bash
# module-manager.sh — local module management for Dethernety OSS
#
# Wraps the TypeScript core in scripts/module-manager/ and handles
# argument parsing, environment setup, and prerequisite checks.
#
# Usage:
#   ./scripts/module-manager.sh build   <module-path>
#   ./scripts/module-manager.sh install <module.tar.gz> [options]
#   ./scripts/module-manager.sh ingest  <cypher-file-or-dir> [options]
#   ./scripts/module-manager.sh list    [options]
#
# Options:
#   --target <path>       Module installation target (default: custom_modules next to this script)
#   --import-dir <path>   Memgraph CSV import directory (for LOAD CSV)
#   --db-uri <uri>        Bolt connection URI       (default: bolt://localhost:7687)
#   --db-user <user>      Database user              (default: dethernety)
#   --db-pass <pass>      Database password           (default: from env NEO4J_PASSWORD)
#   --state-file <path>   Path to installed-modules.json
#   --help                Show this message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS_CORE="${SCRIPT_DIR}/module-manager/index.ts"
OSS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TSX="${OSS_ROOT}/node_modules/.bin/tsx"

# ── colours (disabled if not a tty) ─────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; NC=''
fi

log()  { echo -e "${GREEN}[module-manager]${NC} $*"; }
warn() { echo -e "${YELLOW}[module-manager]${NC} $*" >&2; }
die()  { echo -e "${RED}[module-manager]${NC} $*" >&2; exit 1; }

# ── prerequisite checks ─────────────────────────────────────────────────
require_cmd() {
  command -v "$1" &>/dev/null || die "Required command '$1' not found. Please install it."
}

check_prerequisites() {
  require_cmd node
  require_cmd pnpm

  # Verify tsx is available (needed to run the TypeScript core)
  if [ ! -x "${TSX}" ]; then
    log "tsx not found — running pnpm install…"
    (cd "${OSS_ROOT}" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
  fi

  if [ ! -x "${TSX}" ]; then
    die "tsx not found at ${TSX}. Run 'pnpm install' in ${OSS_ROOT}."
  fi
}

# ── command: build ───────────────────────────────────────────────────────
cmd_build() {
  local module_path="${1:?Usage: module-manager.sh build <module-path>}"
  module_path="$(cd "${module_path}" && pwd)"

  if [ ! -f "${module_path}/package.json" ]; then
    die "No package.json found in ${module_path}"
  fi

  log "Building module in ${module_path}…"
  (cd "${module_path}" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install && pnpm build)
  log "Build complete."
}

# ── command: install ─────────────────────────────────────────────────────
cmd_install() {
  check_prerequisites

  local archive="${1:?Usage: module-manager.sh install <module.tar.gz> [options]}"
  shift

  # Pass remaining args through to the TS core
  log "Installing module from ${archive}…"
  "${TSX}" "${TS_CORE}" install "${archive}" "$@"
}

# ── command: ingest ──────────────────────────────────────────────────────
cmd_ingest() {
  check_prerequisites

  local target="${1:?Usage: module-manager.sh ingest <cypher-file-or-dir> [options]}"
  shift

  log "Running data ingestion from ${target}…"
  "${TSX}" "${TS_CORE}" ingest "${target}" "$@"
}

# ── command: list ────────────────────────────────────────────────────────
cmd_list() {
  check_prerequisites
  "${TSX}" "${TS_CORE}" list "$@"
}

# ── command: export ──────────────────────────────────────────────────────
# Produce a Studio-importable archive from a module's file-based class data.
cmd_export() {
  check_prerequisites

  local module_path="${1:?Usage: module-manager.sh export <module-path> [--output <path>] [--include-embeddings]}"
  shift

  log "Exporting Studio archive from ${module_path}…"
  "${TSX}" "${TS_CORE}" export "${module_path}" "$@"
}

# ── command: embed ───────────────────────────────────────────────────────
# Generate pre-computed class embeddings for a module.
cmd_embed() {
  check_prerequisites

  local module_path="${1:?Usage: module-manager.sh embed <module-path> --model <name> --url <endpoint> [--api-key <key>] [--batch-size <n>]}"
  shift

  log "Generating embeddings for module at ${module_path}…"
  "${TSX}" "${TS_CORE}" embed "${module_path}" "$@"
}

# ── usage ────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Dethernety Module Manager${NC}

Usage:
  $(basename "$0") build   <module-path>                Build a module from source
  $(basename "$0") install <module.tar.gz> [options]    Install a packaged module
  $(basename "$0") ingest  <cypher-file-or-dir> [opts]  Run Cypher files against Memgraph
  $(basename "$0") list    [options]                     List installed modules
  $(basename "$0") embed   <module-path> [opts]         Generate pre-computed class embeddings
  $(basename "$0") export  <module-path> [opts]         Package module for Studio import

Options:
  --target <path>        Module installation target directory
  --import-dir <path>    Memgraph CSV import directory (for LOAD CSV)
  --db-uri <uri>         Bolt URI       (default: bolt://localhost:7687)
  --db-user <user>       Database user  (default: dethernety)
  --db-pass <pass>       Database password
  --state-file <path>    Path to installed-modules.json
  --model <name>         Embedding model (embed only, required)
  --url <endpoint>       Embedding endpoint URL (embed only, required)
  --api-key <key>        Bearer token for the embedding endpoint (embed only)
  --batch-size <n>       Classes per POST (embed only, default: 128)
  --output <path>        Output archive path (export only)
  --include-embeddings   Keep embeddings/ subdirs in archive (export only)
  --help                 Show this message
EOF
}

# ── main ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  build)   shift; cmd_build "$@" ;;
  install) shift; cmd_install "$@" ;;
  ingest)  shift; cmd_ingest "$@" ;;
  list)    shift; cmd_list "$@" ;;
  embed)   shift; cmd_embed "$@" ;;
  export)  shift; cmd_export "$@" ;;
  --help|-h|help) usage ;;
  *)
    if [ -n "${1:-}" ]; then
      die "Unknown command: $1\nRun '$(basename "$0") --help' for usage."
    fi
    usage
    ;;
esac
