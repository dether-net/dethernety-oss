#!/usr/bin/env bash
# Build script for mitre-frameworks module
#
# This script:
# 1. Starts a temporary Memgraph container
# 2. Runs the MITRE ATT&CK, ATLAS and D3FEND ingest
# 3. Exports the data to Cypher files with MERGE statements
# 4. Generates vector embeddings and exports to SQL files (requires OPENAI_API_KEY)
# 5. Generates the Memgraph vector files (05, 09) with the manifest's embedding profile
# 6. Packages everything into a tarball
# 7. Cleans up the container
#
# FRAMEWORKS=atlas regenerates only the ATLAS files (06-09) and leaves the ATT&CK and
# D3FEND files (01-03, 05) untouched; the ingest still loads everything, because the
# ATLAS crosswalk links to ATT&CK nodes. The default, FRAMEWORKS=all, regenerates all.
#
# EMBEDDINGS_ONLY=1 regenerates only the vector files: instead of steps 2-4 it loads the
# committed 01, 02, 06, 03 and 07 (scripts/load_committed_data.py), so the vectors describe
# the node text that ships and no other file changes.
#
# manifest.json's embeddingProfile is the profile the vectors are embedded with and every
# node records as embeddingModel; a new profile goes into the manifest before the build,
# and the packaging step checks the files against it. The legacy profile embeddinggemma
# embeds through Ollama (scripts/embedding_provider.py; EMBEDDING_PROVIDER may only be
# unset or ollama). Any other id is a built-in onnx profile, embedded through the
# platform's embedder package: it needs EMBEDDING_MODEL_DIR (the profile's weights), node,
# and the package built (pnpm --filter @dethernety/embedder... build).

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
EMBEDDER_DIST="$MODULE_DIR/../../packages/embedder/dist/embed-documents.js"

CONTAINER_NAME="memgraph-mitre-build-$$"
MEMGRAPH_PORT=17687
MEMGRAPH_IMAGE="memgraph/memgraph-mage:latest"
FRAMEWORKS="${FRAMEWORKS:-all}"
case "$FRAMEWORKS" in
    all|atlas) ;;
    *) echo "FRAMEWORKS must be 'all' or 'atlas', got '$FRAMEWORKS'" >&2; exit 2 ;;
esac
EMBEDDINGS_ONLY="${EMBEDDINGS_ONLY:-}"
case "$EMBEDDINGS_ONLY" in
    ""|1) ;;
    *) echo "EMBEDDINGS_ONLY must be unset or 1, got '$EMBEDDINGS_ONLY'" >&2; exit 2 ;;
esac
EMBEDDING_PROFILE="$(jq -r '.embeddingProfile // empty' "$MODULE_DIR/manifest.json")"
LEGACY_PROFILE="embeddinggemma"

# The build must produce the manifest's profile, or the packaging step refuses the files
# after they were already replaced. Everything that decides the vectors is checked here,
# before the container starts, so a wrong setting costs nothing.
EMBED_ARGS=()
if [[ -z "$EMBEDDING_PROFILE" ]]; then
    echo "manifest.json names no embeddingProfile" >&2
    exit 2
elif [[ "$EMBEDDING_PROFILE" == "$LEGACY_PROFILE" ]]; then
    # The legacy profile is Ollama's embeddinggemma; any other provider or model writes
    # vectors the manifest does not name.
    case "${EMBEDDING_PROVIDER:-}" in
        ""|ollama) ;;
        *) echo "manifest.json's profile $LEGACY_PROFILE is Ollama's: EMBEDDING_PROVIDER=$EMBEDDING_PROVIDER would write other vectors" >&2; exit 2 ;;
    esac
    if [[ -n "${EMBEDDING_MODEL:-}" && "$EMBEDDING_MODEL" != "$LEGACY_PROFILE" ]]; then
        echo "manifest.json's profile is $LEGACY_PROFILE: EMBEDDING_MODEL=$EMBEDDING_MODEL would write other vectors" >&2
        exit 2
    fi
    # The exporter embeds the legacy profile only through an explicit provider (it never
    # skips): Ollama, so an unreachable one fails the build.
    export EMBEDDING_PROVIDER=ollama
else
    if [[ -n "${EMBEDDING_PROVIDER:-}" ]]; then
        echo "EMBEDDING_PROVIDER and the onnx profile $EMBEDDING_PROFILE are exclusive: unset EMBEDDING_PROVIDER" >&2
        exit 2
    fi
    if [[ -z "${EMBEDDING_MODEL_DIR:-}" ]]; then
        echo "The profile $EMBEDDING_PROFILE needs EMBEDDING_MODEL_DIR: the directory that holds its weights" >&2
        exit 2
    fi
    if ! command -v node >/dev/null; then
        echo "The profile $EMBEDDING_PROFILE embeds through Node: node is not on PATH" >&2
        exit 2
    fi
    if [[ ! -f "$EMBEDDER_DIST" ]]; then
        echo "The embedder package is not built: pnpm --filter @dethernety/embedder... build" >&2
        exit 2
    fi
    EMBED_ARGS=(--profile "$EMBEDDING_PROFILE" --models-dir "$EMBEDDING_MODEL_DIR")
fi

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

    # Remove any stragglers from previous runs that died before cleanup
    # (SIGKILL, terminal crash, system reboot — the EXIT trap never fired).
    local stragglers
    stragglers=$(docker ps -a --filter 'name=^memgraph-mitre-build-' --format '{{.Names}}' || true)
    if [[ -n "$stragglers" ]]; then
        log_warn "Removing straggler container(s) from prior runs: $stragglers"
        echo "$stragglers" | xargs -r docker rm -f >/dev/null
    fi

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

    if [[ "$EMBEDDINGS_ONLY" == 1 ]]; then
        log_info "EMBEDDINGS_ONLY=1: loading the committed node and relationship files..."
        "$MODULE_DIR/.venv/bin/python" "$SCRIPT_DIR/load_committed_data.py" \
            "bolt://localhost:$MEMGRAPH_PORT" "$MODULE_DIR/data"
    else
        # Run ingest with custom port
        log_info "Running MITRE ATT&CK, ATLAS and D3FEND ingest..."
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
                --output-dir "$MODULE_DIR/data" \
                --frameworks "$FRAMEWORKS"
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
        if [[ "$FRAMEWORKS" != "all" ]]; then
            log_info "FRAMEWORKS=$FRAMEWORKS: skipping the ATT&CK/D3FEND pgvector SQL export"
        elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
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
    fi

    # Generate Memgraph HNSW embeddings (05-mitre-embeddings.cypher, 09-atlas-embeddings.cypher).
    # An onnx EMBEDDING_PROFILE embeds through the platform's embedder package; the legacy
    # profile through Ollama (EMBEDDING_PROVIDER=ollama, set above). Any failure fails the
    # build: the exporter never skips.
    #
    # NOTE on step 4 vs step 5 asymmetry: step 4 (pgvector SQL) is shell-gated on
    # OPENAI_API_KEY and uses OpenAI text-embedding-3-small; step 5 (Memgraph cypher)
    # uses the embedding profile — two model families, two embedding spaces, two
    # consumers.
    log_info "Generating MITRE Memgraph embeddings (05 and/or 09, per FRAMEWORKS) with profile $EMBEDDING_PROFILE..."
    (
        cd "$MODULE_DIR"
        export NEO4J_URI="bolt://localhost:$MEMGRAPH_PORT"
        export NEO4J_USERNAME="neo4j"
        export NEO4J_PASSWORD="password"

        .venv/bin/python "$SCRIPT_DIR/export_embeddings_to_cypher.py" \
            --output-dir "$MODULE_DIR/data" \
            --frameworks "$FRAMEWORKS" \
            ${EMBED_ARGS[@]+"${EMBED_ARGS[@]}"}
    ) || {
        log_error "MITRE Memgraph embedding export failed"
        exit 1
    }

    for f in 05-mitre-embeddings.cypher 09-atlas-embeddings.cypher; do
        if [[ -f "$MODULE_DIR/data/$f" ]]; then
            lines=$(wc -l < "$MODULE_DIR/data/$f")
            log_info "  $f: $lines lines"
        else
            # The exporter writes every file it selects or fails, so only a file it did not
            # select can be absent: 05 under FRAMEWORKS=atlas, missing before this run.
            log_warn "  $f absent — FRAMEWORKS=$FRAMEWORKS does not write it and it was not here before; packaging will refuse it"
        fi
    done

    # Package the freshly-regenerated data into the install tarball. Delegating
    # to package.sh keeps a single packaging implementation shared with the
    # default `pnpm build` (package-only) path.
    "$SCRIPT_DIR/package.sh"

    log_info "Build complete!"
}

main "$@"
