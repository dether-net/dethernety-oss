#!/usr/bin/env python3
"""
Test PGVector vector search against ingested MITRE data.

This script tests:
1. Vector similarity search on ATT&CK techniques, mitigations, and D3FEND
2. Metadata filtering (by tactic)
3. Verifies indexes are created

Run after ingesting data with: psql -f data/04-mitre-vectors.sql
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

# Database configuration
POSTGRES_URI = os.getenv("POSTGRES_URI")
if not POSTGRES_URI:
    print("Error: POSTGRES_URI environment variable is required")
    print("Example: export POSTGRES_URI='postgresql+psycopg://postgres:yourpassword@localhost:5432/dethermine'")
    sys.exit(1)


def main():
    print("=" * 60)
    print("PGVector Test Script - Testing Ingested MITRE Data")
    print("=" * 60)

    # Check for OpenAI API key (needed for query embeddings)
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("\nError: OPENAI_API_KEY environment variable is required")
        print("Set it with: export OPENAI_API_KEY='sk-...'")
        return 1

    import re
    display_uri = re.sub(r'://([^:]+):([^@]+)@', r'://\1:***@', POSTGRES_URI)
    print(f"\nConnecting to: {display_uri}")

    # Import langchain components
    from langchain_openai import OpenAIEmbeddings
    from langchain_postgres import PGVector
    from sqlalchemy import create_engine, text

    # Create engine
    engine = create_engine(POSTGRES_URI, pool_pre_ping=True)

    # Initialize embeddings
    embeddings = OpenAIEmbeddings(max_retries=2)

    # Verify data was ingested
    print("\n1. Verifying ingested data...")
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT c.name, COUNT(e.id) as count
            FROM langchain_pg_collection c
            LEFT JOIN langchain_pg_embedding e ON e.collection_id = c.uuid
            GROUP BY c.name
            ORDER BY c.name
        """))
        collections = list(result)

        if not collections:
            print("   ERROR: No collections found. Run data ingestion first:")
            print("   docker exec -i postgres-dethermine-test psql -U postgres -d dethermine < data/04-mitre-vectors.sql")
            return 1

        print("   Collections found:")
        for name, count in collections:
            print(f"   - {name}: {count} documents")

    # Create vector stores for each collection
    attack_tech_store = PGVector(
        embeddings=embeddings,
        collection_name="mitre_attack_techniques",
        connection=engine,
        use_jsonb=True,
    )

    attack_mit_store = PGVector(
        embeddings=embeddings,
        collection_name="mitre_attack_mitigations",
        connection=engine,
        use_jsonb=True,
    )

    defend_tech_store = PGVector(
        embeddings=embeddings,
        collection_name="mitre_defend_techniques",
        connection=engine,
        use_jsonb=True,
    )

    # Test searches
    print("\n" + "=" * 60)
    print("2. Testing Vector Search")
    print("=" * 60)

    # Test 1: Search ATT&CK techniques
    print("\n--- Test 1: Search 'credential theft authentication bypass' in ATT&CK Techniques ---")
    results = attack_tech_store.similarity_search_with_score(
        "credential theft authentication bypass valid accounts",
        k=5
    )
    if not results:
        print("   ERROR: No results returned")
        return 1
    for doc, score in results:
        print(f"  [{score:.4f}] {doc.metadata.get('attack_id')}: {doc.metadata.get('name')}")
        tactics = doc.metadata.get('tactics', [])
        if tactics:
            tactic_names = [t.get('tactic_name') for t in tactics if t.get('tactic_name')]
            print(f"           Tactics: {', '.join(tactic_names)}")

    # Test 2: Verify tactics array structure
    print("\n--- Test 2: Verify tactics array in metadata ---")
    results = attack_tech_store.similarity_search("valid accounts", k=1)
    if results:
        doc = results[0]
        tactics = doc.metadata.get('tactics', [])
        print(f"   Document: {doc.metadata.get('attack_id')}: {doc.metadata.get('name')}")
        print(f"   Tactics structure: {type(tactics).__name__} with {len(tactics)} items")
        if tactics:
            print(f"   Sample tactic: {tactics[0]}")
    else:
        print("   ERROR: No results for 'valid accounts'")
        return 1

    # Test 3: Search mitigations
    print("\n--- Test 3: Search 'prevent credential theft' in Mitigations ---")
    results = attack_mit_store.similarity_search_with_score(
        "prevent credential theft password attacks multi-factor",
        k=5
    )
    for doc, score in results:
        print(f"  [{score:.4f}] {doc.metadata.get('attack_id')}: {doc.metadata.get('name')}")

    # Test 4: Search D3FEND techniques
    print("\n--- Test 4: Search 'authentication hardening' in D3FEND ---")
    results = defend_tech_store.similarity_search_with_score(
        "authentication hardening credential protection",
        k=5
    )
    for doc, score in results:
        print(f"  [{score:.4f}] {doc.metadata.get('defend_id')}: {doc.metadata.get('name')}")
        print(f"           Tactic: {doc.metadata.get('tactic_name')}")

    # Test 5: Search D3FEND with tactic filter
    print("\n--- Test 5: Search D3FEND with tactic='Harden' filter ---")
    results = defend_tech_store.similarity_search_with_score(
        "password protection credentials",
        k=5,
        filter={"tactic_name": {"$eq": "Harden"}}
    )
    if results:
        for doc, score in results:
            print(f"  [{score:.4f}] {doc.metadata.get('defend_id')}: {doc.metadata.get('name')}")
            print(f"           Tactic: {doc.metadata.get('tactic_name')}")
    else:
        print("   No results with tactic='Harden' filter")

    # Verify indexes
    print("\n" + "=" * 60)
    print("3. Verifying Indexes")
    print("=" * 60)
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'langchain_pg_embedding'
        """))
        indexes = list(result)
        if indexes:
            print("\n   Indexes on langchain_pg_embedding:")
            for idx_name, idx_def in indexes:
                # Check index type
                if "hnsw" in idx_def.lower():
                    print(f"   - {idx_name} (HNSW vector index)")
                elif "gin" in idx_def.lower():
                    print(f"   - {idx_name} (GIN metadata index)")
                else:
                    print(f"   - {idx_name}")
        else:
            print("\n   WARNING: No indexes found")

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
