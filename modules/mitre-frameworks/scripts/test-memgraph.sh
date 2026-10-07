#!/bin/bash
set -e

# Test script for mitre-frameworks module data ingestion
# Spins up an ephemeral Memgraph container and loads cypher files
# Mimics the management service's cypher parsing logic

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$MODULE_DIR/data"

CONTAINER_NAME="memgraph-mitre-test-$$"
MG_PORT=7689  # Non-standard port to avoid collision

cleanup() {
    echo -e "\n\033[1;33mCleaning up...\033[0m"
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
}
trap cleanup EXIT

echo "=============================================="
echo "Memgraph Data Ingestion Test (mitre-frameworks)"
echo "=============================================="

# Check for cypher files
CYPHER_FILES=$(ls "$DATA_DIR"/*.cypher 2>/dev/null | sort)
if [ -z "$CYPHER_FILES" ]; then
    echo -e "\033[0;31mNo .cypher files found in $DATA_DIR\033[0m"
    exit 1
fi

echo -e "\n\033[1;33mCypher files found:\033[0m"
for f in $CYPHER_FILES; do
    echo "  - $(basename "$f")"
done

# Start Memgraph
echo -e "\n\033[1;33m1. Starting ephemeral Memgraph...\033[0m"
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$MG_PORT:7687" \
    memgraph/memgraph-mage:latest \
    --log-level=WARNING >/dev/null

# Wait for Memgraph to be ready
echo -n "   Waiting for Memgraph to be ready..."
for i in {1..30}; do
    if docker exec "$CONTAINER_NAME" mgconsole --output-format=csv -c "RETURN 1" >/dev/null 2>&1; then
        echo -e " \033[0;32mready\033[0m"
        break
    fi
    sleep 1
    echo -n "."
done

# Create a Python script to parse and execute cypher (mimics management service)
PARSER_SCRIPT=$(mktemp)
cat > "$PARSER_SCRIPT" << 'PYTHON_EOF'
#!/usr/bin/env python3
"""
Parse and execute cypher files using the same logic as the management service.
Handles:
- Semicolon-separated statements
- Single-line comments (//)
- Multi-line comments (/* */)
- Semicolons inside quoted strings
"""

import sys
import re
from neo4j import GraphDatabase

def parse_cypher_statements(content: str) -> list[str]:
    """Parse cypher content into individual statements, respecting quoted strings."""
    statements = []
    current = []
    in_single_quote = False
    in_double_quote = False
    in_multiline_comment = False
    i = 0

    while i < len(content):
        char = content[i]

        # Handle multi-line comments
        if not in_single_quote and not in_double_quote:
            if content[i:i+2] == '/*':
                in_multiline_comment = True
                i += 2
                continue
            if in_multiline_comment:
                if content[i:i+2] == '*/':
                    in_multiline_comment = False
                    i += 2
                    continue
                i += 1
                continue

            # Handle single-line comments
            if content[i:i+2] == '//':
                # Skip to end of line
                while i < len(content) and content[i] != '\n':
                    i += 1
                continue

        # Handle escape sequences in strings
        if char == '\\' and i + 1 < len(content):
            current.append(char)
            current.append(content[i + 1])
            i += 2
            continue

        # Handle quotes
        if char == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
            current.append(char)
            i += 1
            continue

        if char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
            current.append(char)
            i += 1
            continue

        # Handle semicolon (statement separator)
        if char == ';' and not in_single_quote and not in_double_quote:
            stmt = ''.join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
            i += 1
            continue

        current.append(char)
        i += 1

    # Don't forget the last statement if no trailing semicolon
    stmt = ''.join(current).strip()
    if stmt:
        statements.append(stmt)

    return statements


def main():
    if len(sys.argv) < 3:
        print("Usage: parser.py <bolt_uri> <cypher_file>")
        sys.exit(1)

    bolt_uri = sys.argv[1]
    cypher_file = sys.argv[2]

    # Read and parse the file
    with open(cypher_file, 'r') as f:
        content = f.read()

    statements = parse_cypher_statements(content)
    print(f"   Parsed {len(statements)} statements")

    if not statements:
        print("   No statements to execute")
        return

    # Connect to Memgraph
    driver = GraphDatabase.driver(bolt_uri, auth=None)

    try:
        with driver.session() as session:
            for i, stmt in enumerate(statements, 1):
                try:
                    session.run(stmt)
                    if i % 100 == 0:
                        print(f"   Executed {i}/{len(statements)} statements...")
                except Exception as e:
                    print(f"\n   \033[0;31mError executing statement {i}:\033[0m")
                    print(f"   Statement (first 200 chars): {stmt[:200]}...")
                    print(f"   Error: {e}")
                    sys.exit(1)

        print(f"   \033[0;32mAll {len(statements)} statements executed successfully\033[0m")
    finally:
        driver.close()


if __name__ == "__main__":
    main()
PYTHON_EOF

# Use the module's venv which has neo4j installed
PYTHON="$MODULE_DIR/.venv/bin/python"
if [ ! -f "$PYTHON" ]; then
    echo "   Warning: venv not found, using system python3"
    PYTHON="python3"
fi

load_all() {
    for cypher_file in $CYPHER_FILES; do
        filename=$(basename "$cypher_file")
        echo "   Executing $filename..."

        "$PYTHON" "$PARSER_SCRIPT" "bolt://localhost:$MG_PORT" "$cypher_file"
    done
}

# Execute cypher files
echo -e "\n\033[1;33m2. Executing Cypher scripts...\033[0m"
load_all

# Verify loaded data against the counts pinned for the shipped releases.
echo -e "\n\033[1;33m3. Verifying loaded data...\033[0m"
"$PYTHON" "$SCRIPT_DIR/check_loaded_corpus.py" "bolt://localhost:$MG_PORT"

# Load everything again: a pack that is not idempotent (a parallel edge per MERGE,
# a duplicate node) moves the counts, so the same pins must hold.
echo -e "\n\033[1;33m4. Re-executing Cypher scripts (idempotency)...\033[0m"
load_all
echo -e "\n\033[1;33m5. Verifying loaded data after the second load...\033[0m"
"$PYTHON" "$SCRIPT_DIR/check_loaded_corpus.py" "bolt://localhost:$MG_PORT"

rm -f "$PARSER_SCRIPT"

echo -e "\n\033[0;32m=============================================="
echo "Test completed!"
echo "==============================================\033[0m"
