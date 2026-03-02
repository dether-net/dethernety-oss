#!/usr/bin/env bash
# demo.sh — One-command Dethernety demo.
#
# Builds the environment if it doesn't exist, starts Docker Compose,
# waits for services, and installs modules into the running database.
#
# Usage:
#   cd oss/demo
#   ./demo.sh            # first run builds everything, subsequent runs just start
#   ./demo.sh --rebuild  # force a full rebuild
#   ./demo.sh --down     # stop and remove containers
#   ./demo.sh --reset    # stop, remove containers, and wipe data

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OSS_ROOT="$(cd "${DEMO_DIR}/.." && pwd)"
MODULE_MANAGER="${OSS_ROOT}/scripts/module-manager.sh"
COMPOSE_FILE="${DEMO_DIR}/docker-compose.yml"
STATE_FILE="${DEMO_DIR}/installed-modules.json"

# ── colours ──────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

step()  { echo -e "\n${CYAN}${BOLD}==> $*${NC}"; }
log()   { echo -e "${GREEN}[demo]${NC} $*"; }
warn()  { echo -e "${YELLOW}[demo]${NC} $*" >&2; }
die()   { echo -e "${RED}[demo]${NC} $*" >&2; exit 1; }

# ── handle flags ─────────────────────────────────────────────────────────
FORCE_REBUILD=false

case "${1:-}" in
  --down)
    step "Stopping demo"
    docker compose -f "${COMPOSE_FILE}" down
    log "Containers stopped."
    exit 0
    ;;
  --reset)
    step "Resetting demo (removing containers and data)"
    docker compose -f "${COMPOSE_FILE}" down -v
    rm -rf "${DEMO_DIR}/data" "${DEMO_DIR}/modules" "${STATE_FILE}"
    log "Demo data wiped. Run ./demo.sh to start fresh."
    exit 0
    ;;
  --rebuild)
    FORCE_REBUILD=true
    ;;
  --help|-h)
    cat <<EOF
${BOLD}Dethernety Demo${NC}

Usage:
  ./demo.sh              Start the demo (builds on first run)
  ./demo.sh --rebuild    Force a full rebuild
  ./demo.sh --down       Stop and remove containers
  ./demo.sh --reset      Stop, remove containers, and wipe all data

The demo runs Dethernety + Memgraph + OPA without authentication.
Open http://localhost:3003 after startup.
EOF
    exit 0
    ;;
  "")
    ;; # default — start/resume
  *)
    die "Unknown option: $1\nRun './demo.sh --help' for usage."
    ;;
esac

# ── prerequisites ────────────────────────────────────────────────────────
step "Checking prerequisites"

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    die "'$1' is required but not installed."
  fi
}

check_cmd node
check_cmd pnpm
check_cmd docker

NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "${NODE_MAJOR}" -lt 18 ]; then
  die "Node.js 18+ required (found $(node -v))"
fi

# ── build if needed ──────────────────────────────────────────────────────
needs_build() {
  if [ "${FORCE_REBUILD}" = true ]; then
    return 0
  fi
  # No image yet
  if ! docker image inspect dethernety:demo &>/dev/null; then
    return 0
  fi
  # No noauth schema generated
  if [ ! -f "${OSS_ROOT}/apps/dt-ws/schema/schema-noauth.graphql" ]; then
    return 0
  fi
  return 1
}

if needs_build; then
  step "Installing dependencies"
  (cd "${OSS_ROOT}" && pnpm install)

  step "Building workspace packages"
  # Only build the application — modules are built separately by module-manager
  (cd "${OSS_ROOT}" && pnpm turbo build --filter='!dethernety-module' --filter='!mitre-frameworks')

  step "Deploying frontend to backend public directory"
  rm -rf "${OSS_ROOT}/apps/dt-ws/public/assets"
  mkdir -p "${OSS_ROOT}/apps/dt-ws/public"
  cp -r "${OSS_ROOT}/apps/dt-ui/dist/"* "${OSS_ROOT}/apps/dt-ws/public/"

  step "Generating schema-noauth.graphql"
  node "${OSS_ROOT}/scripts/generate-noauth-schema.js"

  step "Building Docker image (dethernety:demo)"
  (cd "${OSS_ROOT}" && docker build \
    -f demo/Dockerfile.demo \
    -t dethernety:demo \
    .)
else
  log "Docker image dethernety:demo already exists (use --rebuild to force)."
fi

# ── prepare directories ──────────────────────────────────────────────────
mkdir -p "${DEMO_DIR}/modules"
mkdir -p "${DEMO_DIR}/data/memgraph_data"
mkdir -p "${DEMO_DIR}/data/memgraph_log"

# ── start docker compose ─────────────────────────────────────────────────
step "Starting services"
docker compose -f "${COMPOSE_FILE}" up -d

# ── wait for services ────────────────────────────────────────────────────
wait_healthy() {
  local container="$1"
  local label="$2"
  local max_wait="${3:-90}"
  local elapsed=0

  step "Waiting for ${label} to be ready"
  while [ "${elapsed}" -lt "${max_wait}" ]; do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "${container}" 2>/dev/null || echo "missing")
    case "${status}" in
      healthy)
        log "${label} is ready."
        return 0
        ;;
      unhealthy)
        die "${label} is unhealthy. Check: docker logs ${container}"
        ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
    printf "."
  done
  echo ""
  die "${label} did not become ready within ${max_wait}s. Check: docker logs ${container}"
}

wait_healthy demo-memgraph "Memgraph" 60
wait_healthy demo-dethernety "Dethernety" 90

# ── install modules (if not already installed) ───────────────────────────
needs_module_install() {
  # No state file → never installed
  if [ ! -f "${STATE_FILE}" ]; then
    return 0
  fi
  # Check if dethernety module is recorded
  if ! grep -q '"dethernety"' "${STATE_FILE}" 2>/dev/null; then
    return 0
  fi
  return 1
}

if needs_module_install; then
  step "Building dethernety-module"
  "${MODULE_MANAGER}" build "${OSS_ROOT}/modules/dethernety-module"

  DETHERNETY_TARBALL="${OSS_ROOT}/modules/dethernety-module/dist/dethernety-1.0.0.tar.gz"
  if [ ! -f "${DETHERNETY_TARBALL}" ]; then
    die "Expected tarball not found: ${DETHERNETY_TARBALL}"
  fi

  step "Installing dethernety-module"
  "${MODULE_MANAGER}" install "${DETHERNETY_TARBALL}" \
    --target "${DEMO_DIR}/modules" \
    --import-dir "${DEMO_DIR}/data/memgraph_data/import" \
    --db-uri bolt://localhost:7687 \
    --db-user dethernety \
    --db-pass demo \
    --state-file "${STATE_FILE}"

  # Optional: mitre-frameworks
  MITRE_DIR="${OSS_ROOT}/modules/mitre-frameworks"
  if [ -d "${MITRE_DIR}" ]; then
    step "Building mitre-frameworks (this may take a few minutes)"
    if "${MODULE_MANAGER}" build "${MITRE_DIR}" 2>/dev/null; then
      MITRE_TARBALL=$(find "${MITRE_DIR}/dist" -name "mitre-frameworks-*.tar.gz" 2>/dev/null | head -1)
      if [ -n "${MITRE_TARBALL}" ]; then
        step "Installing mitre-frameworks"
        "${MODULE_MANAGER}" install "${MITRE_TARBALL}" \
          --target "${DEMO_DIR}/modules" \
          --import-dir "${DEMO_DIR}/data/memgraph_data/import" \
          --db-uri bolt://localhost:7687 \
          --db-user dethernety \
          --db-pass demo \
          --state-file "${STATE_FILE}"
      else
        warn "mitre-frameworks tarball not found after build — skipping."
      fi
    else
      warn "mitre-frameworks build failed (may need Python + venv). Skipping."
      warn "Install later with: ../scripts/module-manager.sh build ../modules/mitre-frameworks"
    fi
  fi
  # Restart dethernety so it picks up the newly installed modules
  step "Restarting Dethernety to load modules"
  docker restart demo-dethernety
  wait_healthy demo-dethernety "Dethernety" 90
else
  log "Modules already installed (use --reset to reinstall)."
fi

# ── done ─────────────────────────────────────────────────────────────────
step "Demo is running!"
echo ""
log "Open ${BOLD}http://localhost:3003${NC} in your browser."
echo ""
log "No login required — authentication is disabled for this demo."
echo ""
log "Commands:"
log "  ${BOLD}./demo.sh --down${NC}    Stop the demo"
log "  ${BOLD}./demo.sh --reset${NC}   Stop and wipe all data"
log "  ${BOLD}./demo.sh --rebuild${NC} Force a full rebuild"
echo ""
