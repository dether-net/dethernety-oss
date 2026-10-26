#!/usr/bin/env python3
"""
Load the committed MITRE node and relationship files into an EMPTY database.

The embeddings-only build (build-data.sh with EMBEDDINGS_ONLY=1) embeds the nodes that
ship, not a fresh ingest: it loads data/01, 02, 06, 03 and 07 as they are committed, then
runs the embeddings export against them. So the vectors describe exactly the node text in
the files beside them, and no file but 05 and 09 changes.

Statements are split the way the module installer splits them (semicolons outside string
literals and comments; the reference is oss/scripts/module-manager/database.ts). An index
on each node key comes first, so the MERGEs do not scan; it is written in the dialect of
the engine at the URI (Memgraph or Neo4j), named on Neo4j the way dt-module names it.

Usage: load_committed_data.py <bolt_uri> [<data dir>]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable, List

# Nodes first, then the relationships between them; 05 and 09 (the vectors) and 08 (the
# crosswalk, which the embedded text does not read) are not loaded.
LOAD_FILES = [
    "01-attack-nodes.cypher",
    "02-defend-nodes.cypher",
    "06-atlas-nodes.cypher",
    "03-relationships.cypher",
    "07-atlas-relationships.cypher",
]

# `(n:Label {key: ` — the label and key each MERGE matches on.
NODE_KEY = re.compile(r"\((?:\w+):(\w+) \{(\w+): ")


def parse_cypher_statements(content: str) -> List[str]:
    """Split on semicolons outside string literals and comments, as the module installer does."""
    statements: List[str] = []
    current: List[str] = []
    in_single = in_double = in_block = False
    i, n = 0, len(content)
    while i < n:
        char = content[i]
        if not in_single and not in_double:
            if in_block:
                if content.startswith("*/", i):
                    in_block = False
                    i += 2
                else:
                    i += 1
                continue
            if content.startswith("/*", i):
                in_block = True
                i += 2
                continue
            if content.startswith("//", i):
                while i < n and content[i] != "\n":
                    i += 1
                continue
        if char == "\\" and i + 1 < n and (in_single or in_double):
            current.append(content[i : i + 2])
            i += 2
            continue
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif char == ";" and not in_single and not in_double:
            stmt = "".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
            i += 1
            continue
        current.append(char)
        i += 1
    stmt = "".join(current).strip()
    if stmt:
        statements.append(stmt)
    return statements


def node_keys(texts: Iterable[str]) -> List[tuple]:
    """Every (label, key) a MERGE in these files matches on, sorted."""
    keys = set()
    for text in texts:
        keys.update(NODE_KEY.findall(text))
    return sorted(keys)


def detect_engine(session) -> str:
    """'memgraph' or 'neo4j', from dbms.components(); anything else is an error."""
    name = str(session.run("CALL dbms.components() YIELD name RETURN name").single()["name"])
    if "memgraph" in name.lower():
        return "memgraph"
    if "neo4j" in name.lower():
        return "neo4j"
    raise ValueError(f"unrecognised graph engine component {name!r}")


def index_statement(engine: str, label: str, key: str) -> str:
    """The node-key index in the engine's dialect (labels and keys come from node_keys)."""
    if engine == "neo4j":
        return f"CREATE INDEX dt_idx__{label}__{key} IF NOT EXISTS FOR (n:{label}) ON (n.{key})"
    if engine == "memgraph":
        return f"CREATE INDEX ON :{label}({key})"
    raise ValueError(f"unknown graph engine {engine!r}")


def load(bolt_uri: str, data_dir: Path) -> int:
    from neo4j import GraphDatabase  # type: ignore[import-untyped]

    texts = {name: (data_dir / name).read_text(encoding="utf-8") for name in LOAD_FILES}
    driver = GraphDatabase.driver(bolt_uri, auth=None)
    try:
        with driver.session() as session:
            if session.run("MATCH (n) RETURN count(n) AS c").single()["c"] != 0:
                print("[error] refusing to load into a non-empty database", file=sys.stderr)
                return 1
            engine = detect_engine(session)
            for label, key in node_keys(texts.values()):
                session.run(index_statement(engine, label, key)).consume()
            for name in LOAD_FILES:
                statements = parse_cypher_statements(texts[name])
                for stmt in statements:
                    session.run(stmt).consume()
                print(f"[info] loaded {name}: {len(statements)} statements")
    finally:
        driver.close()
    return 0


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print(__doc__)
        return 2
    data_dir = Path(sys.argv[2]) if len(sys.argv) == 3 else Path(__file__).resolve().parent.parent / "data"
    return load(sys.argv[1], data_dir)


if __name__ == "__main__":
    sys.exit(main())
