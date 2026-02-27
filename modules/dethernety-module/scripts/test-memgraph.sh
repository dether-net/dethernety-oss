#!/bin/bash
# Test Memgraph data ingestion with ephemeral container
#
# Usage: ./scripts/test-memgraph.sh
#
# Requires:
# - Docker
# - Exported data in data/ directory (run 'pnpm export' first)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$MODULE_DIR/data"
CONTAINER_NAME="memgraph-dethernety-test-$$"
MG_PORT=7688  # Non-standard port to avoid conflicts
MG_WEB_PORT=3001  # Lab port (optional)

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
echo "Memgraph Data Ingestion Test"
echo "=============================================="

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
    echo -e "${RED}Error: dist/package/data directory not found${NC}"
    echo "Run 'pnpm build' first to generate the data files"
    exit 1
fi

# Check for required files
CYPHER_FILES=$(find "$DATA_DIR" -name "*.cypher" | sort)
CSV_FILES=$(find "$DATA_DIR" -name "*.csv" | sort)

if [ -z "$CYPHER_FILES" ]; then
    echo -e "${RED}Error: No .cypher files found in $DATA_DIR${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Data files found:${NC}"
echo "  Cypher files:"
for f in $CYPHER_FILES; do
    echo "    - $(basename "$f")"
done
echo "  CSV files:"
for f in $CSV_FILES; do
    echo "    - $(basename "$f")"
done

# Start ephemeral Memgraph
echo -e "\n${YELLOW}1. Starting ephemeral Memgraph...${NC}"
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$MG_PORT:7687" \
    -p "$MG_WEB_PORT:3000" \
    -v "$DATA_DIR:/var/lib/memgraph/import/dethernety:ro" \
    memgraph/memgraph-mage:latest \
    --log-level=WARNING \
    > /dev/null

# Wait for Memgraph to be ready
echo -n "   Waiting for Memgraph to be ready"
for i in {1..30}; do
    if echo "RETURN 1;" | docker exec -i "$CONTAINER_NAME" mgconsole --use-ssl=false &> /dev/null; then
        echo -e " ${GREEN}ready${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Check if container is running
if ! docker ps --filter "name=$CONTAINER_NAME" --filter "status=running" -q | grep -q .; then
    echo -e "\n${RED}Error: Memgraph container failed to start${NC}"
    docker logs "$CONTAINER_NAME"
    exit 1
fi

# Execute Cypher files in alphabetical order
echo -e "\n${YELLOW}2. Executing Cypher scripts...${NC}"
for cypher_file in $CYPHER_FILES; do
    filename=$(basename "$cypher_file")
    echo -n "   Executing $filename... "

    # Execute via mgconsole
    if docker exec -i "$CONTAINER_NAME" mgconsole --use-ssl=false < "$cypher_file" > /dev/null 2>&1; then
        echo -e "${GREEN}done${NC}"
    else
        echo -e "${RED}failed${NC}"
        echo "Error output:"
        docker exec -i "$CONTAINER_NAME" mgconsole --use-ssl=false < "$cypher_file"
        exit 1
    fi
done

# Helper function to run a Cypher query and get the count result
run_count_query() {
    local query="$1"
    echo "$query" | docker exec -i "$CONTAINER_NAME" mgconsole --use-ssl=false 2>/dev/null | grep -E "^\| [0-9]+" | awk '{print $2}'
}

# Helper function to run a Cypher query and display results
run_query() {
    local query="$1"
    echo "$query" | docker exec -i "$CONTAINER_NAME" mgconsole --use-ssl=false 2>/dev/null
}

# Verify data was loaded
echo -e "\n${YELLOW}3. Verifying loaded data...${NC}"

# Check DTModule
echo -n "   DTModule: "
MODULE_COUNT=$(run_count_query "MATCH (m:DTModule) RETURN count(m) as count;")
if [ -n "$MODULE_COUNT" ] && [ "$MODULE_COUNT" -ge 1 ]; then
    echo -e "${GREEN}$MODULE_COUNT${NC}"
else
    echo -e "${RED}${MODULE_COUNT:-0} (expected >= 1)${NC}"
    exit 1
fi

# Check each class type
for CLASS_TYPE in DTComponentClass DTControlClass DTDataFlowClass DTSecurityBoundaryClass DTIssueClass DTDataClass; do
    echo -n "   $CLASS_TYPE: "
    COUNT=$(run_count_query "MATCH (c:$CLASS_TYPE) RETURN count(c) as count;")
    if [ -n "$COUNT" ] && [ "$COUNT" -ge 0 ]; then
        echo -e "${GREEN}$COUNT${NC}"
    else
        echo -e "${YELLOW}0${NC}"
    fi
done

# Check relationships
echo -n "   MODULE_PROVIDES_CLASS relationships: "
REL_COUNT=$(run_count_query "MATCH (:DTModule)-[r:MODULE_PROVIDES_CLASS]->() RETURN count(r) as count;")
echo -e "${GREEN}${REL_COUNT:-0}${NC}"

# Sample some data
echo -e "\n${YELLOW}4. Sample data verification...${NC}"
echo "   DTModule details:"
run_query "MATCH (m:DTModule) RETURN m.name, m.version, m.description LIMIT 1;" | grep -v "^+" | head -5

echo -e "\n   Sample DTComponentClass:"
run_query "MATCH (c:DTComponentClass) RETURN c.id, c.name, c.category LIMIT 3;" | grep -v "^+" | head -6

echo -e "\n${GREEN}=============================================="
echo "All tests passed!"
echo "==============================================${NC}"
