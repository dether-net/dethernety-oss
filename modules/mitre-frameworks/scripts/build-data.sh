#!/usr/bin/env bash
# Build script for mitre-frameworks module
#
# This script:
# 1. Starts a temporary Memgraph container
# 2. Runs the MITRE ATT&CK and D3FEND ingest
# 3. Exports the data to Cypher files with MERGE statements
# 4. Generates vector embeddings and exports to SQL files (requires OPENAI_API_KEY)
# 5. Packages everything into a tarball
# 6. Cleans up the container

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CONTAINER_NAME="memgraph-mitre-build-$$"
MEMGRAPH_PORT=17687
MEMGRAPH_IMAGE="memgraph/memgraph-mage:latest"

# Cleanup function - runs on exit (success or failure)
cleanup() {
    log_info "Cleaning up..."
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
        log_info "Container $CONTAINER_NAME removed"
    fi
}
trap cleanup EXIT

# Wait for Memgraph to be ready using Python/neo4j driver
wait_for_memgraph() {
    local max_attempts=60
    local attempt=1

    log_info "Waiting for Memgraph to be ready on port $MEMGRAPH_PORT..."

    # Ensure venv exists for the check
    if [[ ! -d "$MODULE_DIR/.venv" ]]; then
        log_info "Creating Python virtual environment for connectivity check..."
        (cd "$MODULE_DIR" && python3 -m venv .venv)
        (cd "$MODULE_DIR" && .venv/bin/pip install -r requirements.txt)
    fi

    while [ $attempt -le $max_attempts ]; do
        if "$MODULE_DIR/.venv/bin/python" -c "
from neo4j import GraphDatabase
try:
    driver = GraphDatabase.driver('bolt://localhost:$MEMGRAPH_PORT', auth=('neo4j', 'password'))
    with driver.session() as session:
        session.run('RETURN 1')
    driver.close()
    exit(0)
except Exception:
    exit(1)
" 2>/dev/null; then
            log_info "Memgraph is ready!"
            return 0
        fi

        echo -n "."
        sleep 1
        attempt=$((attempt + 1))
    done

    echo ""
    log_error "Memgraph failed to start after $max_attempts seconds"
    return 1
}

# Main build process
main() {
    log_info "Building mitre-frameworks module"
    log_info "Module directory: $MODULE_DIR"

    # Create output directories
    mkdir -p "$MODULE_DIR/data"
    mkdir -p "$MODULE_DIR/dist"

    # Start Memgraph container
    log_info "Starting temporary Memgraph container..."
    docker run -d \
        --name "$CONTAINER_NAME" \
        -p "$MEMGRAPH_PORT:7687" \
        "$MEMGRAPH_IMAGE"

    wait_for_memgraph

    # Setup ingest environment
    log_info "Setting up ingest environment..."
    if [[ ! -d "$MODULE_DIR/.venv" ]]; then
        log_info "Creating Python virtual environment..."
        (cd "$MODULE_DIR" && python3 -m venv .venv)
        (cd "$MODULE_DIR" && .venv/bin/pip install -r requirements.txt)
    fi

    # Run ingest with custom port
    log_info "Running MITRE ATT&CK and D3FEND ingest..."
    (
        cd "$MODULE_DIR"
        export NEO4J_URI="bolt://localhost:$MEMGRAPH_PORT"
        export NEO4J_USERNAME="neo4j"
        export NEO4J_PASSWORD="password"
        .venv/bin/python ingest.py
    )

    # Export to Cypher
    log_info "Exporting data to Cypher files..."
    (
        cd "$MODULE_DIR"
        export NEO4J_URI="bolt://localhost:$MEMGRAPH_PORT"
        export NEO4J_USERNAME="neo4j"
        export NEO4J_PASSWORD="password"

        .venv/bin/python "$SCRIPT_DIR/export_to_cypher.py" \
            --output-dir "$MODULE_DIR/data"
    )

    # Verify Cypher export
    log_info "Verifying exported Cypher data..."
    for file in "$MODULE_DIR/data"/*.cypher; do
        if [[ -f "$file" ]]; then
            lines=$(wc -l < "$file")
            log_info "  $(basename "$file"): $lines lines"
        fi
    done

    # Generate vector embeddings (optional - requires OPENAI_API_KEY)
    if [[ -n "${OPENAI_API_KEY:-}" ]]; then
        log_info "Generating vector embeddings..."
        (
            cd "$MODULE_DIR"
            export NEO4J_URI="bolt://localhost:$MEMGRAPH_PORT"
            export NEO4J_USERNAME="neo4j"
            export NEO4J_PASSWORD="password"

            .venv/bin/python "$SCRIPT_DIR/export_embeddings_to_sql.py" \
                --output-dir "$MODULE_DIR/data"
        )

        # Verify SQL export
        log_info "Verifying exported SQL data..."
        for file in "$MODULE_DIR/data"/*.sql; do
            if [[ -f "$file" ]]; then
                lines=$(wc -l < "$file")
                log_info "  $(basename "$file"): $lines lines"
            fi
        done
    else
        log_warn "OPENAI_API_KEY not set - skipping vector embedding generation"
        log_warn "Set OPENAI_API_KEY to generate SQL files for pgvector"
    fi

    # Parse version from manifest
    VERSION=$(jq -r '.version' "$MODULE_DIR/manifest.json")
    PACKAGE_NAME="mitre-frameworks-${VERSION}.tar.gz"
    PACKAGE_PATH="$MODULE_DIR/dist/$PACKAGE_NAME"

    # Create tarball
    log_info "Creating package: $PACKAGE_NAME"
    tar -czf "$PACKAGE_PATH" \
        --exclude='.*' \
        --exclude='scripts' \
        --exclude='dist' \
        --exclude='node_modules' \
        -C "$MODULE_DIR" \
        manifest.json \
        data

    # Show package info
    PACKAGE_SIZE=$(du -h "$PACKAGE_PATH" | cut -f1)
    log_info "Package created: $PACKAGE_PATH ($PACKAGE_SIZE)"

    log_info "Package contents:"
    tar -tzf "$PACKAGE_PATH"

    log_info "Build complete!"
}

main "$@"
