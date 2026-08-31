#!/usr/bin/env python3
"""
Pack invariant: no relationship MERGE may carry properties inside its pattern.

A relationship MERGE matches on the WHOLE pattern, so an embedded property is part of
the edge's identity. The ontolocy_* stamps are export wall-clock and differ on every
run, so a regenerated pack matched nothing and created a PARALLEL edge for every
relationship it had already ingested — doubling the corpus. Nothing below the
application layer can catch that: neither Memgraph nor Neo4j can express an
endpoint-pair relationship-uniqueness constraint, and the console's ingest marker keys
on the corpus content hash, which changes precisely BECAUSE the timestamps changed.

Measured on a throwaway Memgraph: the old pack went 22,895 -> 42,972 edges across one
regenerate-and-re-ingest cycle (surplus 20,077); the fixed pack holds at 22,895, all
123 relationship types at ratio 1.00.

Properties are not banned outright — a real, durable property belongs in a SET after
the MERGE, which is how the node statements have always done it. What is banned is
putting one in the pattern. See export_relationships() in export_to_cypher.py.
"""

import re
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
RELATIONSHIPS = DATA_DIR / "03-relationships.cypher"

# A relationship MERGE whose pattern opens a property map — what must never appear.
MERGE_REL_WITH_PROPS = re.compile(r"^MERGE \((?:\w+)?\)-\[[^\]]*\{")
BANNED_IN_PATTERN = ("ontolocy_created", "ontolocy_merged")


def main() -> int:
    if not RELATIONSHIPS.exists():
        print(f"FAIL: {RELATIONSHIPS} not found")
        return 1

    text = RELATIONSHIPS.read_text()
    offenders = []
    merge_count = 0

    for lineno, line in enumerate(text.splitlines(), start=1):
        if not line.startswith("MERGE ("):
            continue
        merge_count += 1
        if MERGE_REL_WITH_PROPS.match(line):
            offenders.append((lineno, line))

    if offenders:
        print(
            f"FAIL: {len(offenders)} relationship MERGE statement(s) carry properties "
            f"inside the pattern, which makes the pack non-idempotent on re-ingest."
        )
        for lineno, line in offenders[:5]:
            print(f"  {RELATIONSHIPS.name}:{lineno}: {line[:140]}")
        if len(offenders) > 5:
            print(f"  ... and {len(offenders) - 5} more")
        print("Move the properties into a `SET` after the MERGE (see the module docstring).")
        return 1

    if merge_count == 0:
        print(f"FAIL: no relationship MERGE statements found in {RELATIONSHIPS.name} — "
              f"the invariant would pass vacuously")
        return 1

    # Belt and braces: the provenance stamps should be gone from the file entirely.
    lingering = [p for p in BANNED_IN_PATTERN if p in text]
    if lingering:
        print(f"FAIL: export wall-clock stamps still present in {RELATIONSHIPS.name}: "
              f"{', '.join(lingering)}")
        return 1

    print(
        f"pack relationship idempotency ok "
        f"({merge_count} MERGE statements, 0 with properties in the pattern)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
