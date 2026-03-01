#!/bin/bash
# Test PGVector integration with ephemeral PostgreSQL container
#
# Usage: ./scripts/test-pgvector.sh
#
# Requires:
# - Docker
# - Python venv with langchain-postgres, langchain-openai
# - OPENAI_API_KEY environment variable (for query embeddings)
# - Pre-generated data/04-mitre-vectors.sql (run 'pnpm build' first)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(dirname "$SCRIPT_DIR")"

# Source .env if it exists (for OPENAI_API_KEY)
if [ -f "$MODULE_DIR/.env" ]; then
    set -a
    source "$MODULE_DIR/.env"
    set +a
fi

CONTAINER_NAME="pgvector-mitre-test-$$"
PG_PORT=5433  # Use non-standard port to avoid conflicts
PG_USER="postgres"
PG_PASS="testpass"
PG_DB="mitre_test"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
}

trap cleanup EXIT

echo "=============================================="
echo "PGVector Integration Test"
echo "=============================================="

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

if [ ! -f "$MODULE_DIR/data/04-mitre-vectors.sql" ]; then
    echo -e "${RED}Error: data/04-mitre-vectors.sql not found${NC}"
    echo "Run 'pnpm build' first to generate the SQL file"
    exit 1
fi

if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}Error: OPENAI_API_KEY environment variable is required${NC}"
    echo "Set it with: export OPENAI_API_KEY='sk-...'"
    exit 1
fi

# Start ephemeral PostgreSQL with pgvector
echo -e "\n${YELLOW}1. Starting ephemeral PostgreSQL with pgvector...${NC}"
docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$PG_USER" \
    -e POSTGRES_PASSWORD="$PG_PASS" \
    -e POSTGRES_DB="$PG_DB" \
    -p "$PG_PORT:5432" \
    pgvector/pgvector:pg17 \
    > /dev/null

# Wait for PostgreSQL to be ready
echo -n "   Waiting for PostgreSQL to be ready"
for i in {1..30}; do
    if docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" -d "$PG_DB" &> /dev/null; then
        echo -e " ${GREEN}ready${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Check if container is running
if ! docker ps --filter "name=$CONTAINER_NAME" --filter "status=running" -q | grep -q .; then
    echo -e "\n${RED}Error: PostgreSQL container failed to start${NC}"
    docker logs "$CONTAINER_NAME"
    exit 1
fi

# Ingest the SQL data
echo -e "\n${YELLOW}2. Ingesting MITRE vector data...${NC}"
docker exec -i "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" < "$MODULE_DIR/data/04-mitre-vectors.sql"

# Verify data was ingested
echo -e "\n${YELLOW}3. Verifying ingested data...${NC}"
docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" -c "
    SELECT c.name, COUNT(e.id) as count
    FROM langchain_pg_collection c
    LEFT JOIN langchain_pg_embedding e ON e.collection_id = c.uuid
    GROUP BY c.name
    ORDER BY c.name;
"

# Run the Python test
echo -e "\n${YELLOW}4. Running Python test...${NC}"
cd "$MODULE_DIR"

# Set up connection string for test
export POSTGRES_URI="postgresql+psycopg://${PG_USER}:${PG_PASS}@localhost:${PG_PORT}/${PG_DB}"

# Run test script
source .venv/bin/activate
python scripts/test_pgvector.py

echo -e "\n${GREEN}=============================================="
echo "All tests passed!"
echo "==============================================${NC}"
